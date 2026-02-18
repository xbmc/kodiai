import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
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
  onAllowedBootstrap?: (payload: SlackV1BootstrapPayload) => Promise<void> | void;
  threadSessionStore?: SlackThreadSessionStore;
}

export function createSlackEventRoutes(deps: SlackEventsRouteDeps): Hono {
  const { config, logger, onAllowedBootstrap } = deps;
  const threadSessionStore = deps.threadSessionStore ?? createSlackThreadSessionStore();
  const app = new Hono();

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

      Promise.resolve().then(async () => {
        const addressed = decision.bootstrap;
        if (decision.reason === "mention_only_bootstrap") {
          threadSessionStore.markThreadStarted({
            channel: addressed.channel,
            threadTs: addressed.threadTs,
          });
        }
        await onAllowedBootstrap?.(addressed);
        logger.info({ ...addressed, reason: decision.reason }, "Slack addressed event accepted for async processing");
      }).catch((error) => {
        logger.error({ error }, "Slack addressed event async processing failed");
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
