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
}

export function createSlackCommandRoutes(deps: SlackCommandRouteDeps): Hono {
  const { config, logger, profileStore } = deps;
  const app = new Hono();

  app.post("/", async (c) => {
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
