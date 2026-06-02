import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { handleKodiaiCommand } from "../slack/slash-command-handler.ts";
import { verifySlackRequest } from "../slack/verify.ts";

interface SlackCommandRouteDeps {
  config: AppConfig;
  logger: Logger;
  profileStore: ContributorProfileStore;
  rateLimit?: SlackCommandRateLimitOptions;
}

type RateLimitWindowOptions = {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
};

type SlackCommandRateLimitOptions = {
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

export function createSlackCommandRoutes(deps: SlackCommandRouteDeps): Hono {
  const { config, logger, profileStore } = deps;
  const app = new Hono();
  const preBodyLimiter = createSlidingWindowRateLimiter(deps.rateLimit?.preBody, {
    max: 60,
    windowMs: 60_000,
    maxKeys: 2_000,
  });
  const verifiedLimiter = createSlidingWindowRateLimiter(deps.rateLimit?.verified, {
    max: 30,
    windowMs: 60_000,
    maxKeys: 5_000,
  });

  app.post("/", async (c) => {
    const sourceKey = requestSourceKey((name) => c.req.header(name));
    if (preBodyLimiter.isLimited(`slack-command:${sourceKey}`)) {
      logger.warn({ sourceKey }, "Slash command request rate-limited before body read");
      return c.text("Rate limited", 429);
    }

    const rawBody = await c.req.text();

    const verification = verifySlackRequest({
      signingSecret: config.slackSigningSecret,
      rawBody,
      timestampHeader: c.req.header("x-slack-request-timestamp"),
      signatureHeader: c.req.header("x-slack-signature"),
    });

    if (!verification.valid) {
      logger.warn(
        { reason: verification.reason },
        "Slash command signature verification failed",
      );
      return c.text("Unauthorized", 401);
    }

    const params = new URLSearchParams(rawBody);
    const text = params.get("text") ?? "";
    const userId = params.get("user_id") ?? "";
    const userName = params.get("user_name") ?? "";
    const teamId = params.get("team_id") ?? "unknown-team";

    if (verifiedLimiter.isLimited(`team:${teamId}:user:${userId || "unknown-user"}`)) {
      logger.warn({ teamId, userId }, "Slash command verified user rate-limited");
      return c.text("Rate limited", 429);
    }

    const result = await handleKodiaiCommand({
      text,
      slackUserId: userId,
      slackUserName: userName,
      profileStore,
      logger,
    });

    if (result.asyncWork) {
      result
        .asyncWork()
        .catch((err) =>
          logger.warn({ err }, "Slash command async work failed"),
        );
    }

    return c.json({
      response_type: result.responseType,
      text: result.text,
    });
  });

  return app;
}
