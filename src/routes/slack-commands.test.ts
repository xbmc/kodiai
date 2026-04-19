import { describe, test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import {
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
} from "../contributor/profile-trust.ts";
import type {
  ContributorProfile,
  ContributorProfileStore,
} from "../contributor/types.ts";
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
    slackWebhookRelaySources: [],
    port: 3000,
    logLevel: "info",
    botAllowList: [],
    slackWikiChannelId: "",
    wikiStalenessThresholdDays: 30,
    wikiGithubOwner: "xbmc",
    wikiGithubRepo: "xbmc",
    botUserLogin: "",
    botUserPat: "",
    addonRepos: [],
    mcpInternalBaseUrl: "",
    acaJobImage: "",
    acaResourceGroup: "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  };
}

function makeProfile(
  overrides: Partial<ContributorProfile> = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: "U001",
    displayName: "Octo Cat",
    overallTier: "newcomer",
    overallScore: 0,
    optedOut: false,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    lastScoredAt: null,
    trustMarker: null,
    ...overrides,
  };
}

function createMockProfileStore(
  overrides: Partial<ContributorProfileStore> = {},
): ContributorProfileStore {
  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async (p) =>
      makeProfile({
        githubUsername: p.githubUsername,
        slackUserId: p.slackUserId,
        displayName: p.displayName,
      }),
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => [],
    upsertExpertise: async () => {},
    updateTier: async () => {},
    getOrCreateByGithubUsername: async () =>
      makeProfile({
        slackUserId: null,
        displayName: null,
      }),
    getAllScores: async () => [],
    ...overrides,
  };
}

function signRequest(body: string, timestamp: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(baseString).digest("hex")}`;
}

function createApp(profileStore: ContributorProfileStore = createMockProfileStore()): Hono {
  const app = new Hono();
  app.route(
    "/webhooks/slack/commands",
    createSlackCommandRoutes({
      config: createTestConfig(),
      logger: createTestLogger(),
      profileStore,
    }),
  );
  return app;
}

async function postSignedCommand(app: Hono, body: string): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRequest(body, timestamp);

  return app.request("http://localhost/webhooks/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

describe("createSlackCommandRoutes", () => {
  test("valid signed link request returns the generic continuity copy when contributor signals are not yet trusted", async () => {
    const app = createApp();
    const body =
      "command=%2Fkodiai&text=link+octocat&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest";

    const response = await postSignedCommand(app, body);

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      response_type: string;
      text: string;
    };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toBe(
      "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
    );
  });

  test("valid signed opt-in request returns the generic continuity copy when current contributor signals are still unavailable", async () => {
    const setOptedOutCalls: Array<{ githubUsername: string; optedOut: boolean }> = [];
    const app = createApp(
      createMockProfileStore({
        getBySlackUserId: async () =>
          makeProfile({
            githubUsername: "octocat",
            slackUserId: "U001",
            displayName: "Octo Cat",
            overallTier: "newcomer",
            overallScore: 0,
            optedOut: true,
            lastScoredAt: null,
            trustMarker: null,
          }),
        setOptedOut: async (githubUsername, optedOut) => {
          setOptedOutCalls.push({ githubUsername, optedOut });
        },
      }),
    );
    const body =
      "command=%2Fkodiai&text=profile+opt-in&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest";

    const response = await postSignedCommand(app, body);

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      response_type: string;
      text: string;
    };
    expect(setOptedOutCalls).toHaveLength(1);
    expect(setOptedOutCalls[0]!.githubUsername).toBe("octocat");
    expect(setOptedOutCalls[0]!.optedOut).toBe(false);
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toBe(
      "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
    );
  });

  test("valid signed link request returns active continuity copy when the linked profile is trusted", async () => {
    const app = createApp(
      createMockProfileStore({
        linkIdentity: async (params) =>
          makeProfile({
            githubUsername: params.githubUsername,
            slackUserId: params.slackUserId,
            displayName: params.displayName,
            overallTier: "established",
            overallScore: 0.82,
            lastScoredAt: new Date("2026-04-10T00:00:00.000Z"),
            trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
          }),
      }),
    );
    const body =
      "command=%2Fkodiai&text=link+octocat&user_id=U001&user_name=testuser&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest";

    const response = await postSignedCommand(app, body);

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      response_type: string;
      text: string;
    };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toBe(
      "Linked your Slack account to GitHub user `octocat`. Linked contributor guidance is active for your profile. Use `/kodiai profile` to review your status.",
    );
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
    const body = "command=%2Fkodiai&user_id=U001&user_name=test";

    const response = await postSignedCommand(app, body);

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      response_type: string;
      text: string;
    };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toContain("Unknown command");
  });
});
