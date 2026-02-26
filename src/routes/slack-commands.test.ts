import { describe, test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { createSlackCommandRoutes } from "./slack-commands.ts";

const SLACK_SIGNING_SECRET = "test-slash-signing-secret";

function createTestLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => createTestLogger(),
  } as unknown as Logger;
}

function createTestConfig(): AppConfig {
  return {
    githubAppId: "12345",
    githubPrivateKey:
      "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    webhookSecret: "webhook-secret",
    slackSigningSecret: SLACK_SIGNING_SECRET,
    slackBotToken: "xoxb-test-token",
    slackBotUserId: "U123BOT",
    slackKodiaiChannelId: "C123KODIAI",
    slackDefaultRepo: "xbmc/xbmc",
    slackAssistantModel: "claude-3-5-haiku-latest",
    port: 3000,
    logLevel: "info",
    botAllowList: [],
  };
}

function createMockProfileStore(): ContributorProfileStore {
  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async (p) => ({
      id: 1,
      githubUsername: p.githubUsername,
      slackUserId: p.slackUserId,
      displayName: p.displayName,
      overallTier: "newcomer" as const,
      overallScore: 0,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScoredAt: null,
    }),
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => [],
    upsertExpertise: async () => {},
    updateTier: async () => {},
    getOrCreateByGithubUsername: async () => ({
      id: 1,
      githubUsername: "",
      slackUserId: null,
      displayName: null,
      overallTier: "newcomer" as const,
      overallScore: 0,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScoredAt: null,
    }),
    getAllScores: async () => [],
  };
}

function signRequest(body: string, timestamp: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(baseString).digest("hex")}`;
}

function createApp(): Hono {
  const app = new Hono();
  app.route(
    "/webhooks/slack/commands",
    createSlackCommandRoutes({
      config: createTestConfig(),
      logger: createTestLogger(),
      profileStore: createMockProfileStore(),
    }),
  );
  return app;
}

describe("createSlackCommandRoutes", () => {
  test("valid signed request dispatches to handler and returns 200", async () => {
    const app = createApp();
    const body =
      "command=%2Fkodiai&text=link+octocat&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signRequest(body, timestamp);

    const response = await app.request(
      "http://localhost/webhooks/slack/commands",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      response_type: string;
      text: string;
    };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toContain("Linked your Slack account");
  });

  test("invalid signature returns 401", async () => {
    const app = createApp();
    const body = "command=%2Fkodiai&text=profile&user_id=U001&user_name=test";
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request(
      "http://localhost/webhooks/slack/commands",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": "v0=invalid",
        },
        body,
      },
    );

    expect(response.status).toBe(401);
  });

  test("missing text param still dispatches (shows help)", async () => {
    const app = createApp();
    const body =
      "command=%2Fkodiai&user_id=U001&user_name=test";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signRequest(body, timestamp);

    const response = await app.request(
      "http://localhost/webhooks/slack/commands",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      response_type: string;
      text: string;
    };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toContain("Unknown command");
  });
});
