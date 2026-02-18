import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { SlackV1BootstrapPayload } from "../slack/safety-rails.ts";
import { createSlackEventRoutes } from "./slack-events.ts";

const SLACK_SIGNING_SECRET = "test-signing-secret";

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
    slackSigningSecret: SLACK_SIGNING_SECRET,
    slackBotUserId: "U123BOT",
    slackKodiaiChannelId: "C123KODIAI",
    port: 3000,
    logLevel: "info",
    botAllowList: [],
  };
}

function signSlackRequest(timestamp: string, body: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(baseString).digest("hex")}`;
}

function createHeaders(body: string, timestamp: string, signature?: string): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
  });
  if (signature) {
    headers.set("x-slack-signature", signature);
  }
  return headers;
}

function createApp(onAllowedBootstrap?: (payload: SlackV1BootstrapPayload) => void) {
  const app = new Hono();
  app.route(
    "/webhooks/slack",
    createSlackEventRoutes({
      config: createTestConfig(),
      logger: createTestLogger(),
      onAllowedBootstrap,
    }),
  );
  return app;
}

describe("createSlackEventRoutes", () => {
  test("returns 401 before payload parse when signature is invalid", async () => {
    const app = createApp();
    const invalidJson = "{ this is not valid json";
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(invalidJson, timestamp, "v0=not-valid"),
      body: invalidJson,
    });

    expect(response.status).toBe(401);
  });

  test("returns 401 when timestamp is outside replay window", async () => {
    const app = createApp();
    const payload = JSON.stringify({ type: "event_callback", event: { type: "app_mention" } });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(payload, staleTimestamp, signSlackRequest(staleTimestamp, payload)),
      body: payload,
    });

    expect(response.status).toBe(401);
  });

  test("returns challenge for verified url_verification payload", async () => {
    const app = createApp();
    const payload = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(payload, timestamp, signSlackRequest(timestamp, payload)),
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  test("does not return url_verification challenge for unverified request", async () => {
    const app = createApp();
    const payload = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(payload, timestamp, "v0=invalid"),
      body: payload,
    });

    expect(response.status).toBe(401);
  });

  test("acknowledges blocked event_callback payloads with no downstream side effects", async () => {
    const processed: SlackV1BootstrapPayload[] = [];
    const app = createApp((payload) => processed.push(payload));
    const payload = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel: "C999OTHER",
        channel_type: "channel",
        ts: "1700000000.000001",
        user: "U123USER",
        text: "<@U123BOT> hi",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(payload, timestamp, signSlackRequest(timestamp, payload)),
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(processed).toHaveLength(0);
  });

  test("acknowledges verified mention bootstrap and forwards normalized thread payload", async () => {
    const processed: SlackV1BootstrapPayload[] = [];
    const app = createApp((payload) => processed.push(payload));
    const payload = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel: "C123KODIAI",
        channel_type: "channel",
        ts: "1700000000.000777",
        user: "U777USER",
        text: "<@U123BOT> summarize this thread",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(payload, timestamp, signSlackRequest(timestamp, payload)),
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await Promise.resolve();
    expect(processed).toEqual([
      {
        channel: "C123KODIAI",
        threadTs: "1700000000.000777",
        user: "U777USER",
        text: "<@U123BOT> summarize this thread",
        replyTarget: "thread-only",
      },
    ]);
  });

  test("forwards in-thread follow-up after bootstrap starts thread session", async () => {
    const processed: SlackV1BootstrapPayload[] = [];
    const app = createApp((payload) => processed.push(payload));
    const bootstrapPayload = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel: "C123KODIAI",
        channel_type: "channel",
        ts: "1700000000.000777",
        user: "U777USER",
        text: "<@U123BOT> summarize this thread",
      },
    });
    const followUpPayload = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel: "C123KODIAI",
        channel_type: "channel",
        thread_ts: "1700000000.000777",
        ts: "1700000000.000778",
        user: "U777USER",
        text: "follow-up without mention",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const bootstrapResponse = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(bootstrapPayload, timestamp, signSlackRequest(timestamp, bootstrapPayload)),
      body: bootstrapPayload,
    });

    const followUpResponse = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(followUpPayload, timestamp, signSlackRequest(timestamp, followUpPayload)),
      body: followUpPayload,
    });

    expect(bootstrapResponse.status).toBe(200);
    expect(await bootstrapResponse.json()).toEqual({ ok: true });
    expect(followUpResponse.status).toBe(200);
    expect(await followUpResponse.json()).toEqual({ ok: true });
    await Promise.resolve();
    expect(processed).toEqual([
      {
        channel: "C123KODIAI",
        threadTs: "1700000000.000777",
        user: "U777USER",
        text: "<@U123BOT> summarize this thread",
        replyTarget: "thread-only",
      },
      {
        channel: "C123KODIAI",
        threadTs: "1700000000.000777",
        user: "U777USER",
        text: "follow-up without mention",
        replyTarget: "thread-only",
      },
    ]);
  });

  test("ignores in-thread non-starter follow-up messages", async () => {
    const processed: SlackV1BootstrapPayload[] = [];
    const app = createApp((payload) => processed.push(payload));
    const payload = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel: "C123KODIAI",
        channel_type: "channel",
        thread_ts: "1700000000.000777",
        ts: "1700000000.000778",
        user: "U777USER",
        text: "follow-up without mention",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const response = await app.request("http://localhost/webhooks/slack/events", {
      method: "POST",
      headers: createHeaders(payload, timestamp, signSlackRequest(timestamp, payload)),
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await Promise.resolve();
    expect(processed).toHaveLength(0);
  });
});
