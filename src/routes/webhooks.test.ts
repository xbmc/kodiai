import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Deduplicator } from "../webhook/dedup.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { RequestTracker, ShutdownManager, WebhookQueueStore, WebhookQueueEntry } from "../lifecycle/types.ts";
import { createWebhookRoutes } from "./webhooks.ts";

const WEBHOOK_SECRET = "github-webhook-secret";

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
    webhookSecret: WEBHOOK_SECRET,
    slackSigningSecret: "slack-signing-secret",
    slackBotToken: "xoxb-test-token",
    slackBotUserId: "U123BOT",
    slackKodiaiChannelId: "C123KODIAI",
    slackDefaultRepo: "xbmc/xbmc",
    slackAssistantModel: "claude-3-5-haiku-latest",
    port: 3000,
    logLevel: "info",
    botAllowList: [],
    slackWebhookRelaySources: [],
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

function signGithubRequest(body: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
}

function createHeaders(body: string, overrides?: Record<string, string | undefined>): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-hub-signature-256": signGithubRequest(body),
    "x-github-delivery": "delivery-123",
    "x-github-event": "pull_request",
    "user-agent": "GitHub-Hookshot/test",
  });

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      headers.delete(key);
    } else {
      headers.set(key, value);
    }
  }

  return headers;
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function createApp(options?: {
  dedupIsDuplicate?: boolean;
  dispatchImpl?: (event: WebhookEvent) => Promise<void>;
  isShuttingDown?: boolean;
}) {
  const dispatchedEvents: WebhookEvent[] = [];
  const queuedEntries: Array<Omit<WebhookQueueEntry, "id" | "queuedAt" | "processedAt" | "status">> = [];
  const trackedJobs: string[] = [];
  const cleanupCalls: string[] = [];
  const cleanupSignal = Promise.withResolvers<string>();

  const dedup: Deduplicator = {
    isDuplicate: () => options?.dedupIsDuplicate ?? false,
  };

  const eventRouter: EventRouter = {
    register: () => undefined,
    dispatch: async (event) => {
      dispatchedEvents.push(event);
      await options?.dispatchImpl?.(event);
    },
  };

  const requestTracker: RequestTracker = {
    trackRequest: () => () => undefined,
    trackJob: () => {
      const jobId = `job-${trackedJobs.length + 1}`;
      trackedJobs.push(jobId);
      return () => {
        cleanupCalls.push(jobId);
        cleanupSignal.resolve(jobId);
      };
    },
    activeCount: () => ({ requests: 0, jobs: trackedJobs.length - cleanupCalls.length, total: trackedJobs.length - cleanupCalls.length }),
    waitForDrain: async () => undefined,
  };

  const webhookQueueStore: WebhookQueueStore = {
    enqueue: async (entry) => {
      queuedEntries.push(entry);
    },
    dequeuePending: async () => [],
    markCompleted: async () => undefined,
    markFailed: async () => undefined,
  };

  const shutdownManager: ShutdownManager = {
    start: () => undefined,
    isShuttingDown: () => options?.isShuttingDown ?? false,
    requestShutdown: () => undefined,
  };

  const app = new Hono();
  app.route(
    "/webhooks",
    createWebhookRoutes({
      config: createTestConfig(),
      logger: createTestLogger(),
      dedup,
      githubApp: {} as GitHubApp,
      eventRouter,
      requestTracker,
      webhookQueueStore,
      shutdownManager,
    }),
  );

  return { app, dispatchedEvents, queuedEntries, trackedJobs, cleanupCalls, cleanupSignal };
}

describe("createWebhookRoutes", () => {
  test("returns 401 before dispatch when the signature is missing", async () => {
    const invalidJson = "{ not valid json";
    const { app, dispatchedEvents, trackedJobs } = createApp();

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(invalidJson, { "x-hub-signature-256": undefined }),
      body: invalidJson,
    });

    expect(response.status).toBe(401);
    expect(dispatchedEvents).toHaveLength(0);
    expect(trackedJobs).toHaveLength(0);
  });

  test("returns 400 before dispatch when the signature is valid but the payload is malformed JSON", async () => {
    const invalidJson = "{ not valid json";
    const { app, dispatchedEvents, trackedJobs } = createApp();

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(invalidJson),
      body: invalidJson,
    });

    expect(response.status).toBe(400);
    expect(dispatchedEvents).toHaveLength(0);
    expect(trackedJobs).toHaveLength(0);
  });

  test("returns 401 before dispatch when the signature is invalid even if the payload is malformed", async () => {
    const invalidJson = "{ not valid json";
    const { app, dispatchedEvents, trackedJobs } = createApp();

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(invalidJson, { "x-hub-signature-256": "sha256=not-valid" }),
      body: invalidJson,
    });

    expect(response.status).toBe(401);
    expect(dispatchedEvents).toHaveLength(0);
    expect(trackedJobs).toHaveLength(0);
  });

  test("short-circuits duplicate deliveries without dispatching", async () => {
    const body = JSON.stringify({ action: "opened", installation: { id: 42 } });
    const { app, dispatchedEvents, trackedJobs, cleanupCalls } = createApp({ dedupIsDuplicate: true });

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(body),
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(dispatchedEvents).toHaveLength(0);
    expect(trackedJobs).toHaveLength(0);
    expect(cleanupCalls).toHaveLength(0);
  });

  test("accepts a signed event, dispatches the constructed webhook event asynchronously, and cleans up tracking after dispatch settles", async () => {
    const body = JSON.stringify({
      action: "opened",
      installation: { id: 42 },
      repository: {
        full_name: "acme/widgets",
        owner: { login: "acme" },
        name: "widgets",
      },
      sender: { login: "octocat" },
      pull_request: { number: 101 },
    });
    const dispatchGate = Promise.withResolvers<void>();
    const { app, dispatchedEvents, trackedJobs, cleanupCalls, cleanupSignal } = createApp({
      dispatchImpl: async () => {
        await dispatchGate.promise;
      },
    });

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(body),
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(trackedJobs).toEqual(["job-1"]);

    await flushMicrotasks();

    expect(dispatchedEvents).toEqual([
      {
        id: "delivery-123",
        name: "pull_request",
        installationId: 42,
        payload: {
          action: "opened",
          installation: { id: 42 },
          repository: {
            full_name: "acme/widgets",
            owner: { login: "acme" },
            name: "widgets",
          },
          sender: { login: "octocat" },
          pull_request: { number: 101 },
        },
      },
    ]);
    expect(cleanupCalls).toHaveLength(0);

    dispatchGate.resolve();
    expect(await cleanupSignal.promise).toBe("job-1");

    expect(cleanupCalls).toEqual(["job-1"]);
  });

  test("keeps the immediate accepted response and cleanup when async dispatch rejects", async () => {
    const body = JSON.stringify({ action: "opened", installation: { id: 7 } });
    const { app, dispatchedEvents, trackedJobs, cleanupCalls } = createApp({
      dispatchImpl: async () => {
        throw new Error("dispatch failed");
      },
    });

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(body),
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(trackedJobs).toEqual(["job-1"]);

    await flushMicrotasks();

    expect(dispatchedEvents).toHaveLength(1);
    expect(cleanupCalls).toEqual(["job-1"]);
  });

  test("queues signed events during shutdown and preserves delivery metadata with the original raw body", async () => {
    const body = '{\n  "action": "opened",\n  "installation": { "id": 77 },\n  "sender": { "login": "octocat" }\n}';
    const { app, dispatchedEvents, queuedEntries, trackedJobs, cleanupCalls } = createApp({ isShuttingDown: true });

    const response = await app.request("http://localhost/webhooks/github", {
      method: "POST",
      headers: createHeaders(body, {
        "x-github-delivery": "delivery-shutdown",
        "x-github-event": "issue_comment",
        "user-agent": undefined,
      }),
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, queued: true });
    expect(dispatchedEvents).toHaveLength(0);
    expect(trackedJobs).toHaveLength(0);
    expect(cleanupCalls).toHaveLength(0);
    expect(queuedEntries).toEqual([
      {
        source: "github",
        deliveryId: "delivery-shutdown",
        eventName: "issue_comment",
        headers: {
          "x-hub-signature-256": signGithubRequest(body),
          "x-github-delivery": "delivery-shutdown",
          "x-github-event": "issue_comment",
          "user-agent": "unknown",
        },
        body,
      },
    ]);
  });
});
