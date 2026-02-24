import { Hono } from "hono";
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

interface SlackEventsRouteDeps {
  config: AppConfig;
  logger: Logger;
  shutdownManager?: ShutdownManager;
  webhookQueueStore?: WebhookQueueStore;
  requestTracker?: RequestTracker;
  onAllowedBootstrap?: (payload: SlackV1BootstrapPayload) => Promise<void> | void;
  threadSessionStore?: SlackThreadSessionStore;
}

export function createSlackEventRoutes(deps: SlackEventsRouteDeps): Hono {
  const { config, logger, onAllowedBootstrap, shutdownManager, webhookQueueStore, requestTracker } = deps;
  const threadSessionStore = deps.threadSessionStore ?? createSlackThreadSessionStore();
  const recentAddressed = new Map<string, number>();
  const DUPLICATE_WINDOW_MS = 5000;

  // Per-channel sliding window rate limiter
  const RATE_LIMIT_MAX_EVENTS = 30;
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const channelEventTimestamps = new Map<string, number[]>();

  function isChannelRateLimited(channel: string): boolean {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;

    let timestamps = channelEventTimestamps.get(channel);
    if (!timestamps) {
      timestamps = [];
      channelEventTimestamps.set(channel, timestamps);
    }

    // Lazily clean old timestamps
    const validStart = timestamps.findIndex((ts) => ts > cutoff);
    if (validStart > 0) {
      timestamps.splice(0, validStart);
    } else if (validStart === -1) {
      timestamps.length = 0;
    }

    if (timestamps.length >= RATE_LIMIT_MAX_EVENTS) {
      return true;
    }

    timestamps.push(now);
    return false;
  }

  const app = new Hono();

  function isDuplicateAddressedEvent(addressed: SlackV1BootstrapPayload): boolean {
    const now = Date.now();
    const key = `${addressed.channel}:${addressed.threadTs}:${addressed.user}:${addressed.text.trim().toLowerCase()}`;
    const previous = recentAddressed.get(key);

    recentAddressed.set(key, now);

    for (const [entryKey, ts] of recentAddressed) {
      if (now - ts > DUPLICATE_WINDOW_MS) {
        recentAddressed.delete(entryKey);
      }
    }

    return typeof previous === "number" && now - previous <= DUPLICATE_WINDOW_MS;
  }

  app.post("/events", async (c) => {
    const timestampHeader = c.req.header("x-slack-request-timestamp");
    const signatureHeader = c.req.header("x-slack-signature");

    const body = await c.req.text();
    const verification = verifySlackRequest({
      signingSecret: config.slackSigningSecret,
      rawBody: body,
      timestampHeader,
      signatureHeader,
    });

    if (!verification.valid) {
      logger.warn({ reason: verification.reason }, "Rejected Slack event: verification failed");
      return c.text("", 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      logger.warn("Rejected Slack event: invalid JSON payload");
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
      const decision = evaluateSlackV1Rails({
        payload: eventCallback,
        slackBotUserId: config.slackBotUserId,
        slackKodiaiChannelId: config.slackKodiaiChannelId,
        isThreadSessionStarted: ({ channel, threadTs }) => threadSessionStore.isThreadStarted({ channel, threadTs }),
      });

      if (decision.decision === "ignore") {
        logger.info(
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
      if (isChannelRateLimited(channel)) {
        logger.warn(
          { channel, limit: RATE_LIMIT_MAX_EVENTS, windowMs: RATE_LIMIT_WINDOW_MS },
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
            logger.info(
              { ...addressed, reason: "duplicate_bootstrap" },
              "Slack bootstrap ignored as duplicate thread starter",
            );
            return;
          }
        }

        if (isDuplicateAddressedEvent(addressed)) {
          logger.info(
            { ...addressed, reason: "duplicate_addressed_event" },
            "Slack addressed event ignored as duplicate",
          );
          return;
        }

        await onAllowedBootstrap?.(addressed);
        logger.info({ ...addressed, reason: decision.reason }, "Slack addressed event accepted for async processing");
      }).catch((error) => {
        logger.error({ err: error }, "Slack addressed event async processing failed");
      }).finally(() => {
        untrackJob?.();
      });

      return c.json({ ok: true });
    }

    const payloadType =
      typeof payload === "object" && payload !== null && "type" in payload && typeof payload.type === "string"
        ? payload.type
        : "unknown";
    logger.info({ payloadType }, "Slack event ignored: unsupported payload type");
    return c.json({ ok: true });
  });

  return app;
}
