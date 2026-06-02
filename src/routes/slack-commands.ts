import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { handleKodiaiCommand } from "../slack/slash-command-handler.ts";
import { verifySlackRequest } from "../slack/verify.ts";
import {
  createSlidingWindowRateLimiter,
  requestSourceKey,
  type RateLimitWindowOptions,
} from "../lib/sliding-window-rate-limiter.ts";

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
