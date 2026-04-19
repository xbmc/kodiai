import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import { parseWebhookRelaySourcesEnv } from "../slack/webhook-relay-config.ts";
import type { NormalizedWebhookRelayEvent } from "../slack/webhook-relay.ts";
import { createSlackRelayWebhookRoutes } from "./slack-relay-webhooks.ts";

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
    slackSigningSecret: "slack-signing-secret",
    slackBotToken: "xoxb-test-token",
    slackBotUserId: "U123BOT",
    slackKodiaiChannelId: "C123KODIAI",
    slackDefaultRepo: "xbmc/xbmc",
    slackAssistantModel: "claude-3-5-haiku-latest",
    slackWebhookRelaySources: parseWebhookRelaySourcesEnv(
      JSON.stringify([
        {
          id: "buildkite",
          targetChannel: "C_BUILD_ALERTS",
          auth: {
            type: "header_secret",
            headerName: "x-relay-secret",
            secret: "super-secret",
          },
          filter: {
            eventTypes: ["build.failed", "build.finished"],
            textIncludes: ["failed"],
            textExcludes: ["flaky"],
          },
        },
      ]),
    ),
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

async function readFixture(name: "accepted" | "suppressed") {
  return await Bun.file(new URL(`../../fixtures/slack-webhook-relay/${name}.json`, import.meta.url)).text();
}

function createApp(onAcceptedRelay?: (event: NormalizedWebhookRelayEvent) => void) {
  const app = new Hono();
  app.route(
    "/webhooks/slack/relay",
    createSlackRelayWebhookRoutes({
      config: createTestConfig(),
      logger: createTestLogger(),
      onAcceptedRelay,
    }),
  );
  return app;
}

describe("createSlackRelayWebhookRoutes", () => {
  test("rejects unknown relay sources", async () => {
    const app = createApp();
    const payload = await readFixture("accepted");

    const response = await app.request("http://localhost/webhooks/slack/relay/unknown", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": "super-secret",
      },
      body: payload,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, reason: "unknown_source" });
  });

  test("rejects requests whose source secret is missing or wrong", async () => {
    const app = createApp();
    const payload = await readFixture("accepted");

    const response = await app.request("http://localhost/webhooks/slack/relay/buildkite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": "wrong-secret",
      },
      body: payload,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: "invalid_source_auth" });
  });

  test("returns explicit invalid diagnostics for non-JSON request bodies", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/webhooks/slack/relay/buildkite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": "super-secret",
      },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "invalid_json" });
  });

  test("acknowledges suppressed payloads without calling the accepted callback", async () => {
    const acceptedEvents: NormalizedWebhookRelayEvent[] = [];
    const app = createApp((event) => acceptedEvents.push(event));
    const payload = await readFixture("suppressed");

    const response = await app.request("http://localhost/webhooks/slack/relay/buildkite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": "super-secret",
      },
      body: payload,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      verdict: "suppress",
      reason: "text_excluded_substring",
      sourceId: "buildkite",
      eventType: "build.failed",
      detail: "flaky",
    });
    expect(acceptedEvents).toEqual([]);
  });

  test("accepts verified payloads and forwards the normalized relay event", async () => {
    const acceptedEvents: NormalizedWebhookRelayEvent[] = [];
    const app = createApp((event) => acceptedEvents.push(event));
    const payload = await readFixture("accepted");

    const response = await app.request("http://localhost/webhooks/slack/relay/buildkite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": "super-secret",
      },
      body: payload,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      verdict: "accept",
      sourceId: "buildkite",
      eventType: "build.failed",
      targetChannel: "C_BUILD_ALERTS",
    });
    expect(acceptedEvents).toEqual([
      {
        sourceId: "buildkite",
        targetChannel: "C_BUILD_ALERTS",
        eventType: "build.failed",
        title: "Build failed on main",
        summary: "CI failed for xbmc/xbmc after the latest merge.",
        url: "https://ci.example.test/builds/123",
        text: "Build failed for xbmc/xbmc on main after merge 09f28d7.",
        metadata: {
          pipeline: "main",
          provider: "buildkite",
        },
        filterMetadata: {
          eventTypes: ["build.failed", "build.finished"],
          textIncludes: ["failed"],
          textExcludes: ["flaky"],
        },
      },
    ]);
  });

  test("returns an explicit delivery failure when accepted relay delivery throws", async () => {
    const app = createApp(async () => {
      throw new Error("slack unavailable");
    });
    const payload = await readFixture("accepted");

    const response = await app.request("http://localhost/webhooks/slack/relay/buildkite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": "super-secret",
      },
      body: payload,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      reason: "delivery_failed",
      sourceId: "buildkite",
      eventType: "build.failed",
    });
  });
});
