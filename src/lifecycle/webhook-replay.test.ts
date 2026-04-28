import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { SlackV1BootstrapPayload } from "../slack/safety-rails.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import { replayQueuedWebhook } from "./webhook-replay.ts";

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
    githubPrivateKey: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    webhookSecret: "webhook-secret",
    slackSigningSecret: "slack-secret",
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
    botUserPat: "",
    botUserLogin: "",
    addonRepos: [],
    mcpInternalBaseUrl: "",
    acaJobImage: "",
    acaResourceGroup: "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  };
}

describe("replayQueuedWebhook", () => {
  test("replays queued GitHub webhook through the event router", async () => {
    const dispatched: WebhookEvent[] = [];

    await replayQueuedWebhook({
      entry: {
        id: 1,
        source: "github",
        deliveryId: "delivery-1",
        eventName: "issues",
        headers: {},
        body: JSON.stringify({ installation: { id: 123 }, action: "opened" }),
      },
      config: createTestConfig(),
      logger: createTestLogger(),
      dispatchGitHubEvent: async (event) => {
        dispatched.push(event);
      },
      handleSlackBootstrap: async () => undefined,
    });

    expect(dispatched).toEqual([
      {
        id: "delivery-1",
        name: "issues",
        payload: { installation: { id: 123 }, action: "opened" },
        installationId: 123,
      },
    ]);
  });

  test("replays queued Slack event through the same channel and mention safety rails", async () => {
    const processed: SlackV1BootstrapPayload[] = [];

    await replayQueuedWebhook({
      entry: {
        id: 2,
        source: "slack",
        headers: {},
        body: JSON.stringify({
          type: "event_callback",
          event: {
            type: "message",
            channel: "C999OTHER",
            channel_type: "channel",
            ts: "1700000000.000001",
            user: "U123USER",
            text: "<@U123BOT> should not run",
          },
        }),
      },
      config: createTestConfig(),
      logger: createTestLogger(),
      dispatchGitHubEvent: async () => undefined,
      handleSlackBootstrap: async (payload) => {
        processed.push(payload);
      },
    });

    expect(processed).toHaveLength(0);
  });

  test("replays queued Slack mention when it passes safety rails", async () => {
    const processed: SlackV1BootstrapPayload[] = [];

    await replayQueuedWebhook({
      entry: {
        id: 3,
        source: "slack",
        headers: {},
        body: JSON.stringify({
          type: "event_callback",
          event: {
            type: "app_mention",
            channel: "C123KODIAI",
            channel_type: "channel",
            ts: "1700000000.000777",
            user: "U777USER",
            text: "<@U123BOT> run this",
          },
        }),
      },
      config: createTestConfig(),
      logger: createTestLogger(),
      dispatchGitHubEvent: async () => undefined,
      handleSlackBootstrap: async (payload) => {
        processed.push(payload);
      },
    });

    expect(processed).toEqual([
      {
        channel: "C123KODIAI",
        threadTs: "1700000000.000777",
        messageTs: "1700000000.000777",
        user: "U777USER",
        text: "<@U123BOT> run this",
        replyTarget: "thread-only",
      },
    ]);
  });
});
