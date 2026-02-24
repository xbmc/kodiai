import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { Deduplicator } from "../webhook/dedup.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { RequestTracker, ShutdownManager, WebhookQueueStore } from "../lifecycle/types.ts";
import { verifyWebhookSignature } from "../webhook/verify.ts";
import { createChildLogger } from "../lib/logger.ts";

interface WebhookRouteDeps {
  config: AppConfig;
  logger: Logger;
  dedup: Deduplicator;
  githubApp: GitHubApp;
  eventRouter: EventRouter;
  requestTracker: RequestTracker;
  webhookQueueStore: WebhookQueueStore;
  shutdownManager: ShutdownManager;
}

export function createWebhookRoutes(deps: WebhookRouteDeps): Hono {
  const { config, logger, dedup, eventRouter, requestTracker, webhookQueueStore, shutdownManager } = deps;
  const app = new Hono();

  app.post("/github", async (c) => {
    const signature = c.req.header("x-hub-signature-256");
    const deliveryId = c.req.header("x-github-delivery") ?? "unknown";
    const eventName = c.req.header("x-github-event") ?? "unknown";
    const userAgent = c.req.header("user-agent") ?? "unknown";
    const receivedAt = new Date().toISOString();

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
    const action = typeof payload.action === "string" ? payload.action : undefined;
    const senderLogin =
      typeof (payload.sender as { login?: unknown } | undefined)?.login === "string"
        ? (payload.sender as { login: string }).login
        : undefined;
    const repository = payload.repository as
      | { full_name?: string; owner?: { login?: string }; name?: string }
      | undefined;
    const repositoryName =
      repository?.full_name ??
      (repository?.owner?.login && repository.name
        ? `${repository.owner.login}/${repository.name}`
        : undefined);

    // Construct the WebhookEvent
    const installation = payload.installation as { id: number } | undefined;
    const event: WebhookEvent = {
      id: deliveryId,
      name: eventName,
      payload,
      installationId: installation?.id ?? 0,
    };

    logger.info(
      {
        deliveryId,
        eventName,
        action,
        installationId: event.installationId,
        repository: repositoryName,
        sender: senderLogin,
        receivedAt,
        userAgent,
      },
      "Webhook accepted and queued for dispatch",
    );

    // During shutdown drain: queue webhook to PostgreSQL for replay after restart
    if (shutdownManager.isShuttingDown()) {
      const headersRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries({
        "x-hub-signature-256": signature ?? "",
        "x-github-delivery": deliveryId,
        "x-github-event": eventName,
        "user-agent": userAgent,
      })) {
        headersRecord[key] = value;
      }

      await webhookQueueStore.enqueue({
        source: "github",
        deliveryId,
        eventName,
        headers: headersRecord,
        body,
      });

      return c.json({ received: true, queued: true });
    }

    // Fire-and-fork: dispatch event asynchronously without awaiting.
    // Return 200 immediately to avoid GitHub's 10-second webhook timeout.
    const childLogger = createChildLogger(logger, { deliveryId, eventName });
    const untrackJob = requestTracker.trackJob();
    Promise.resolve()
      .then(() => eventRouter.dispatch(event))
      .catch((err) => childLogger.error({ err, deliveryId }, "Event dispatch failed"))
      .finally(() => untrackJob());

    return c.json({ received: true });
  });

  return app;
}
