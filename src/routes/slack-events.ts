import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import { verifySlackRequest } from "../slack/verify.ts";

interface SlackEventsRouteDeps {
  config: AppConfig;
  logger: Logger;
}

type SlackPayload = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    channel?: string;
    thread_ts?: string;
    ts?: string;
    user?: string;
    bot_id?: string;
    text?: string;
  };
};

export function createSlackEventRoutes(deps: SlackEventsRouteDeps): Hono {
  const { config, logger } = deps;
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

    let payload: SlackPayload;
    try {
      payload = JSON.parse(body) as SlackPayload;
    } catch {
      logger.warn("Rejected Slack event: invalid JSON payload");
      return c.json({ error: "invalid_payload" }, 400);
    }

    if (payload.type === "url_verification" && typeof payload.challenge === "string") {
      return c.text(payload.challenge, 200);
    }

    if (payload.type === "event_callback") {
      Promise.resolve().then(() => {
        logger.info(
          {
            eventType: payload.event?.type,
            channel: payload.event?.channel,
            threadTs: payload.event?.thread_ts,
            ts: payload.event?.ts,
            user: payload.event?.user,
          },
          "Slack event accepted for async processing",
        );
      });
      return c.json({ ok: true });
    }

    logger.info({ payloadType: payload.type ?? "unknown" }, "Slack event ignored: unsupported payload type");
    return c.json({ ok: true });
  });

  return app;
}
