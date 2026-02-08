import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { Deduplicator } from "../webhook/dedup.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import { verifyWebhookSignature } from "../webhook/verify.ts";
import { createChildLogger } from "../lib/logger.ts";

interface WebhookRouteDeps {
  config: AppConfig;
  logger: Logger;
  dedup: Deduplicator;
  githubApp: GitHubApp;
}

export function createWebhookRoutes(deps: WebhookRouteDeps): Hono {
  const { config, logger, dedup } = deps;
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

    // Fire-and-forget: process event asynchronously without awaiting.
    // Return 200 immediately to avoid GitHub's 10-second webhook timeout.
    // Plan 03 will replace this stub with the real event router dispatch.
    const childLogger = createChildLogger(logger, { deliveryId, eventName });
    Promise.resolve()
      .then(() => processEvent(childLogger, eventName, payload))
      .catch((err) => childLogger.error({ err }, "Event processing failed"));

    return c.json({ received: true });
  });

  return app;
}

/**
 * Placeholder event processor. Logs the event and returns.
 * Plan 03 will replace this with the real event handler registry dispatch.
 */
async function processEvent(
  logger: Logger,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const action = typeof payload.action === "string" ? payload.action : undefined;
  logger.info(
    { action },
    `Processing webhook event: ${eventName}${action ? `.${action}` : ""}`,
  );
}
