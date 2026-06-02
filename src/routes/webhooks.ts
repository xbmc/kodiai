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
  rateLimit?: WebhookRateLimitOptions;
}

type RateLimitWindowOptions = {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
};

type WebhookRateLimitOptions = {
  preBody?: RateLimitWindowOptions;
  verified?: RateLimitWindowOptions;
};

type RateLimiter = {
  isLimited(key: string): boolean;
};

function createSlidingWindowRateLimiter(
  options: RateLimitWindowOptions | undefined,
  defaults: Required<RateLimitWindowOptions>,
): RateLimiter {
  const max = options?.max ?? defaults.max;
  const windowMs = options?.windowMs ?? defaults.windowMs;
  const maxKeys = options?.maxKeys ?? defaults.maxKeys;
  const timestampsByKey = new Map<string, number[]>();

  function pruneKeys(cutoff: number): void {
    if (timestampsByKey.size <= maxKeys) return;
    for (const [key, timestamps] of timestampsByKey) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1]! <= cutoff) {
        timestampsByKey.delete(key);
      }
      if (timestampsByKey.size <= maxKeys) return;
    }

    for (const key of timestampsByKey.keys()) {
      timestampsByKey.delete(key);
      if (timestampsByKey.size <= maxKeys) return;
    }
  }

  return {
    isLimited(key: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;
      let timestamps = timestampsByKey.get(key);
      if (!timestamps) {
        timestamps = [];
        timestampsByKey.set(key, timestamps);
      }

      const validStart = timestamps.findIndex((timestamp) => timestamp > cutoff);
      if (validStart > 0) {
        timestamps.splice(0, validStart);
      } else if (validStart === -1) {
        timestamps.length = 0;
      }

      if (timestamps.length >= max) {
        pruneKeys(cutoff);
        return true;
      }

      timestamps.push(now);
      pruneKeys(cutoff);
      return false;
    },
  };
}

function requestSourceKey(header: (name: string) => string | undefined): string {
  const forwardedFor = header("x-forwarded-for")?.split(",")[0]?.trim();
  return header("cf-connecting-ip") ?? header("x-real-ip") ?? forwardedFor ?? "unknown";
}

export function createWebhookRoutes(deps: WebhookRouteDeps): Hono {
  const { config, logger, dedup, eventRouter, requestTracker, webhookQueueStore, shutdownManager } = deps;
  const app = new Hono();
  const preBodyLimiter = createSlidingWindowRateLimiter(deps.rateLimit?.preBody, {
    max: 120,
    windowMs: 60_000,
    maxKeys: 2_000,
  });
  const verifiedLimiter = createSlidingWindowRateLimiter(deps.rateLimit?.verified, {
    max: 240,
    windowMs: 60_000,
    maxKeys: 5_000,
  });

  app.post("/github", async (c) => {
    const sourceKey = requestSourceKey((name) => c.req.header(name));
    if (preBodyLimiter.isLimited(`github:${sourceKey}`)) {
      logger.warn({ sourceKey }, "GitHub webhook request rate-limited before body read");
      return c.text("", 429);
    }

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
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch (err) {
      logger.warn({ deliveryId, eventName, err }, "Webhook payload JSON parse failed");
      return c.text("", 400);
    }
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
    const installation = payload.installation as { id: number } | undefined;
    const verifiedSourceKey = installation?.id
      ? `installation:${installation.id}`
      : repositoryName
        ? `repository:${repositoryName}`
        : `event:${eventName}`;

    if (verifiedLimiter.isLimited(verifiedSourceKey)) {
      logger.warn(
        { deliveryId, eventName, verifiedSourceKey },
        "GitHub webhook verified source rate-limited",
      );
      return c.text("", 429);
    }

    // Construct the WebhookEvent
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
