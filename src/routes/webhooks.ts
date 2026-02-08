import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { Deduplicator } from "../webhook/dedup.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import { verifyWebhookSignature } from "../webhook/verify.ts";
import { createChildLogger } from "../lib/logger.ts";

interface WebhookRouteDeps {
  config: AppConfig;
  logger: Logger;
  dedup: Deduplicator;
  githubApp: GitHubApp;
  eventRouter: EventRouter;
}

export function createWebhookRoutes(deps: WebhookRouteDeps): Hono {
  const { config, logger, dedup, eventRouter } = deps;
  const app = new Hono();

  app.post("/github", async (c) => {
    const signature = c.req.header("x-hub-signature-256");
    const deliveryId = c.req.header("x-github-delivery") ?? "unknown";
    const eventName = c.req.header("x-github-event") ?? "unknown";

    // CRITICAL: Get raw body text BEFORE any JSON parsing.
    // Parsing first can alter whitespace/encoding and break HMAC verification.
    const body = await c.req.text();

    // Verify webhook signature
    if (!signature || !(await verifyWebhookSignature(config.webhookSecret, body, signature))) {
      logger.warn({ deliveryId, eventName }, "Webhook signature verification failed");
      return c.text("", 401);
    }

    // Check for duplicate delivery
    if (dedup.isDuplicate(deliveryId)) {
      logger.info({ deliveryId, eventName }, "Duplicate delivery skipped");
      return c.json({ received: true });
    }

    // Parse payload after verification passes
    const payload = JSON.parse(body) as Record<string, unknown>;

    // Construct the WebhookEvent
    const installation = payload.installation as { id: number } | undefined;
    const event: WebhookEvent = {
      id: deliveryId,
      name: eventName,
      payload,
      installationId: installation?.id ?? 0,
    };

    // Fire-and-fork: dispatch event asynchronously without awaiting.
    // Return 200 immediately to avoid GitHub's 10-second webhook timeout.
    const childLogger = createChildLogger(logger, { deliveryId, eventName });
    Promise.resolve()
      .then(() => eventRouter.dispatch(event))
      .catch((err) => childLogger.error({ err, deliveryId }, "Event dispatch failed"));

    return c.json({ received: true });
  });

  return app;
}
