import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { handleKodiaiCommand } from "../slack/slash-command-handler.ts";
import { verifySlackRequest } from "../slack/verify.ts";
import { tryReadBoundedRequestBody } from "../lib/request-body.ts";
import {
  createNamedRateLimiters,
  requestSourceKey,
  type RateLimitOptions,
} from "../lib/sliding-window-rate-limiter.ts";

type SlackCommandRateLimitWindow = "preBody" | "verified";
const MAX_SLACK_COMMAND_BODY_BYTES = 256 * 1024;

interface SlackCommandRouteDeps {
  config: AppConfig;
  logger: Logger;
  profileStore: ContributorProfileStore;
  rateLimit?: RateLimitOptions<SlackCommandRateLimitWindow>;
}

export function createSlackCommandRoutes(deps: SlackCommandRouteDeps): Hono {
  const { config, logger, profileStore } = deps;
  const app = new Hono();
  const rateLimiters = createNamedRateLimiters(deps.rateLimit, {
    preBody: { max: 60, windowMs: 60_000, maxKeys: 2_000 },
    verified: { max: 30, windowMs: 60_000, maxKeys: 5_000 },
  });

  app.post("/", async (c) => {
    const sourceKey = requestSourceKey((name) => c.req.header(name));
    if (rateLimiters.preBody.isLimited(`slack-command:${sourceKey}`)) {
      logger.warn({ sourceKey }, "Slash command request rate-limited before body read");
      return c.text("Rate limited", 429);
    }

    const bodyResult = await tryReadBoundedRequestBody(c.req.raw, { maxBytes: MAX_SLACK_COMMAND_BODY_BYTES });
    if (!bodyResult.ok) {
      logger.warn({ maxBytes: bodyResult.error.maxBytes }, "Slash command body too large");
      return c.text("Payload too large", 413);
    }
    const rawBody = bodyResult.body;

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

    if (rateLimiters.verified.isLimited(`team:${teamId}:user:${userId || "unknown-user"}`)) {
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
