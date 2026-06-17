import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { RequestTracker, ShutdownManager, WebhookQueueStore } from "../lifecycle/types.ts";
import { evaluateSlackV1Rails, type SlackV1BootstrapPayload } from "../slack/safety-rails.ts";
import {
  createSlackThreadSessionStore,
  type SlackThreadSessionStore,
} from "../slack/thread-session-store.ts";
import { toSlackEventCallback, toSlackUrlVerification } from "../slack/types.ts";
import { verifySlackRequest } from "../slack/verify.ts";
import { tryReadBoundedRequestBody } from "../lib/request-body.ts";
import {
  createNamedRateLimiters,
  requestSourceKey,
  type RateLimitOptions,
} from "../lib/sliding-window-rate-limiter.ts";
import { createInMemoryCache } from "../lib/in-memory-cache.ts";

type SlackEventRateLimitWindow = "preBody" | "verified" | "channel";
const MAX_SLACK_EVENT_BODY_BYTES = 1 * 1024 * 1024;

interface SlackEventsRouteDeps {
  config: AppConfig;
  logger: Logger;
  shutdownManager?: ShutdownManager;
  webhookQueueStore?: WebhookQueueStore;
  requestTracker?: RequestTracker;
  onAllowedBootstrap?: (payload: SlackV1BootstrapPayload) => Promise<void> | void;
  threadSessionStore?: SlackThreadSessionStore;
  rateLimit?: RateLimitOptions<SlackEventRateLimitWindow>;
}

export function createSlackEventRoutes(deps: SlackEventsRouteDeps): Hono {
  const { config, logger, onAllowedBootstrap, shutdownManager, webhookQueueStore, requestTracker } = deps;
  const threadSessionStore = deps.threadSessionStore ?? createSlackThreadSessionStore();
  const DUPLICATE_WINDOW_MS = 5000;
  const recentAddressed = createInMemoryCache<string, true>({
    maxSize: 1_000,
    ttlMs: DUPLICATE_WINDOW_MS,
  });
  const rateLimiters = createNamedRateLimiters(deps.rateLimit, {
    preBody: { max: 120, windowMs: 60_000, maxKeys: 2_000 },
    verified: { max: 60, windowMs: 60_000, maxKeys: 5_000 },
    channel: { max: 30, windowMs: 60_000, maxKeys: 100 },
  });

  const app = new Hono();

  function isDuplicateAddressedEvent(addressed: SlackV1BootstrapPayload): boolean {
    const key = `${addressed.channel}:${addressed.threadTs}:${addressed.user}:${addressed.text.trim().toLowerCase()}`;
    const duplicate = recentAddressed.has(key);
    recentAddressed.set(key, true);
    return duplicate;
  }

  app.post("/events", async (c) => {
    const sourceKey = requestSourceKey((name) => c.req.header(name));
    const requestLogger = logger.child({ requestId: randomUUID(), sourceKey });
    if (rateLimiters.preBody.isLimited(`slack-events:${sourceKey}`)) {
      requestLogger.warn("Slack event request rate-limited before body read");
      return c.text("Rate limited", 429);
    }

    const timestampHeader = c.req.header("x-slack-request-timestamp");
    const signatureHeader = c.req.header("x-slack-signature");

    const bodyResult = await tryReadBoundedRequestBody(c.req.raw, { maxBytes: MAX_SLACK_EVENT_BODY_BYTES });
    if (!bodyResult.ok) {
      requestLogger.warn({ maxBytes: bodyResult.error.maxBytes }, "Slack event body too large");
      return c.text("Payload too large", 413);
    }
    const body = bodyResult.body;
    const verification = verifySlackRequest({
      signingSecret: config.slackSigningSecret,
      rawBody: body,
      timestampHeader,
      signatureHeader,
    });

    if (!verification.valid) {
      requestLogger.warn({ reason: verification.reason }, "Rejected Slack event: verification failed");
      return c.text("", 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      requestLogger.warn("Rejected Slack event: invalid JSON payload");
      return c.json({ error: "invalid_payload" }, 400);
    }

    const urlVerification = toSlackUrlVerification(payload);
    if (urlVerification) {
      return c.text(urlVerification.challenge, 200);
    }

    // During shutdown drain: queue Slack event to PostgreSQL for replay after restart
    // URL verification is handled above (always responds), but real events get queued
    if (shutdownManager?.isShuttingDown() && webhookQueueStore) {
      const headersRecord: Record<string, string> = {};
      if (timestampHeader) headersRecord["x-slack-request-timestamp"] = timestampHeader;
      if (signatureHeader) headersRecord["x-slack-signature"] = signatureHeader;

      await webhookQueueStore.enqueue({
        source: "slack",
        headers: headersRecord,
        body,
      });

      return c.json({ ok: true, queued: true });
    }

    const eventCallback = toSlackEventCallback(payload);
    if (eventCallback) {
      const teamId = eventCallback.team_id ?? "unknown-team";
      if (rateLimiters.verified.isLimited(`team:${teamId}`)) {
        requestLogger.warn({ teamId }, "Slack event verified team rate-limited");
        return c.json({ ok: true });
      }

      const decision = evaluateSlackV1Rails({
        payload: eventCallback,
        slackBotUserId: config.slackBotUserId,
        slackKodiaiChannelId: config.slackKodiaiChannelId,
        isThreadSessionStarted: ({ channel, threadTs }) => threadSessionStore.isThreadStarted({ channel, threadTs }),
      });

      if (decision.decision === "ignore") {
        requestLogger.info(
          {
            reason: decision.reason,
            eventType: eventCallback.event.type,
          },
          "Slack event ignored by v1 safety rails",
        );
        return c.json({ ok: true });
      }

      // Per-channel rate limiting
      const channel = decision.bootstrap.channel;
      if (rateLimiters.channel.isLimited(`channel:${channel}`)) {
        requestLogger.warn(
          { channel },
          "Slack event rate-limited for channel",
        );
        return c.json({ ok: true });
      }

      const untrackJob = requestTracker?.trackJob();
      Promise.resolve().then(async () => {
        const addressed = decision.bootstrap;
        if (decision.reason === "mention_only_bootstrap") {
          const started = threadSessionStore.markThreadStarted({
            channel: addressed.channel,
            threadTs: addressed.threadTs,
          });

          if (!started) {
            requestLogger.info(
              { ...addressed, reason: "duplicate_bootstrap" },
              "Slack bootstrap ignored as duplicate thread starter",
            );
            return;
          }
        }

        if (isDuplicateAddressedEvent(addressed)) {
          requestLogger.info(
            { ...addressed, reason: "duplicate_addressed_event" },
            "Slack addressed event ignored as duplicate",
          );
          return;
        }

        await onAllowedBootstrap?.(addressed);
        requestLogger.info({ ...addressed, reason: decision.reason }, "Slack addressed event accepted for async processing");
      }).catch((error) => {
        requestLogger.error({ err: error }, "Slack addressed event async processing failed");
        const headersRecord: Record<string, string> = {};
        if (timestampHeader) headersRecord["x-slack-request-timestamp"] = timestampHeader;
        if (signatureHeader) headersRecord["x-slack-signature"] = signatureHeader;
        webhookQueueStore?.enqueue({
          source: "slack",
          eventName: "event_callback",
          headers: headersRecord,
          body,
        }).catch((enqueueError) => {
          requestLogger.error({ err: enqueueError }, "Failed to queue Slack addressed event after async processing failure");
        });
      }).finally(() => {
        untrackJob?.();
      });

      return c.json({ ok: true });
    }

    const payloadType =
      typeof payload === "object" && payload !== null && "type" in payload && typeof payload.type === "string"
        ? payload.type
        : "unknown";
    requestLogger.info({ payloadType }, "Slack event ignored: unsupported payload type");
    return c.json({ ok: true });
  });

  return app;
}
