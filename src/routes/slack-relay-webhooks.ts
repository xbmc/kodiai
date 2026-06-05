import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import {
  evaluateWebhookRelayPayload,
  type NormalizedWebhookRelayEvent,
} from "../slack/webhook-relay.ts";
import {
  createRouteRateLimiters,
  requestSourceKey,
  type RouteRateLimitOptions,
} from "./route-rate-limit.ts";

interface SlackRelayWebhookRouteDeps {
  config: AppConfig;
  logger: Logger;
  onAcceptedRelay?: (event: NormalizedWebhookRelayEvent) => Promise<void> | void;
  rateLimit?: RouteRateLimitOptions;
}

function secretsMatch(expected: string, provided: string | undefined): boolean {
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function createSlackRelayWebhookRoutes(deps: SlackRelayWebhookRouteDeps): Hono {
  const { config, logger, onAcceptedRelay } = deps;
  const app = new Hono();
  const rateLimiters = createRouteRateLimiters(deps.rateLimit, {
    preBody: { max: 120, windowMs: 60_000, maxKeys: 2_000 },
    verified: { max: 60, windowMs: 60_000, maxKeys: 1_000 },
  });

  app.post("/:sourceId", async (c) => {
    const sourceId = c.req.param("sourceId");
    const requestSource = requestSourceKey((name) => c.req.header(name));

    if (rateLimiters.preBody.isLimited(`slack-relay:${sourceId}:${requestSource}`)) {
      logger.warn({ sourceId, requestSource }, "Slack relay webhook rate-limited before source auth");
      return c.json({ ok: false, reason: "rate_limited" }, 429);
    }

    const source = (config.slackWebhookRelaySources ?? []).find((candidate) => candidate.id === sourceId);

    if (!source) {
      logger.warn({ sourceId }, "Slack relay webhook rejected: unknown source");
      return c.json({ ok: false, reason: "unknown_source" }, 404);
    }

    const providedSecret = c.req.header(source.auth.headerName);
    if (!secretsMatch(source.auth.secret, providedSecret)) {
      logger.warn({ sourceId }, "Slack relay webhook rejected: invalid source auth");
      return c.json({ ok: false, reason: "invalid_source_auth" }, 401);
    }

    if (rateLimiters.verified.isLimited(`source:${sourceId}`)) {
      logger.warn({ sourceId }, "Slack relay verified source rate-limited");
      return c.json({ ok: false, reason: "rate_limited" }, 429);
    }

    const rawBody = await c.req.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      logger.warn({ sourceId }, "Slack relay webhook rejected: invalid JSON");
      return c.json({ ok: false, reason: "invalid_json" }, 400);
    }

    const result = evaluateWebhookRelayPayload({ source, payload });

    if (result.verdict === "invalid") {
      logger.warn({ sourceId, issues: result.issues }, "Slack relay webhook rejected: malformed payload");
      return c.json({ ok: false, reason: result.reason, issues: result.issues }, 400);
    }

    if (result.verdict === "suppress") {
      logger.info({ sourceId, reason: result.reason, eventType: result.eventType, detail: result.detail }, "Slack relay webhook suppressed by filter");
      return c.json({ ok: true, ...result }, 202);
    }

    try {
      await onAcceptedRelay?.(result.event);
    } catch (error) {
      logger.error({ err: error, sourceId, eventType: result.event.eventType }, "Slack relay delivery failed");
      return c.json({
        ok: false,
        reason: "delivery_failed",
        sourceId: result.event.sourceId,
        eventType: result.event.eventType,
      }, 502);
    }

    logger.info({ sourceId, eventType: result.event.eventType, targetChannel: result.event.targetChannel }, "Slack relay webhook accepted");
    return c.json({
      ok: true,
      verdict: "accept",
      sourceId: result.event.sourceId,
      eventType: result.event.eventType,
      targetChannel: result.event.targetChannel,
    }, 202);
  });

  return app;
}
