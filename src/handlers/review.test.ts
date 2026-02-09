import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createReviewHandler } from "./review.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

function buildReviewRequestedEvent(payloadOverrides: Record<string, unknown>): WebhookEvent {
  return {
    id: "delivery-123",
    name: "pull_request",
    installationId: 42,
    payload: {
      action: "review_requested",
      pull_request: {
        number: 101,
        draft: false,
        title: "Test PR",
        body: "",
        user: { login: "octocat" },
        base: { ref: "main" },
        head: {
          ref: "feature",
          repo: {
            full_name: "acme/repo",
            name: "repo",
            owner: { login: "acme" },
          },
        },
      },
      repository: {
        full_name: "acme/repo",
        name: "repo",
        owner: { login: "acme" },
      },
      ...payloadOverrides,
    },
  };
}

describe("createReviewHandler review_requested gating", () => {
  test("enqueues exactly one review for manual kodiai re-request", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const enqueued: Array<{ installationId: number }> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(installationId: number) => {
        enqueued.push({ installationId });
        return undefined as T;
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager: {} as WorkspaceManager,
      githubApp: { getAppSlug: () => "kodiai" } as GitHubApp,
      executor: {} as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "KoDiAi[BoT]" },
      }),
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.installationId).toBe(42);
  });

  test("skips review_requested for non-kodiai reviewer", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    let enqueueCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>() => {
        enqueueCount++;
        return undefined as T;
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager: {} as WorkspaceManager,
      githubApp: { getAppSlug: () => "kodiai" } as GitHubApp,
      executor: {} as never,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "alice" },
      }),
    );

    expect(enqueueCount).toBe(0);
  });

  test("skips team-only review requests", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    let enqueueCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>() => {
        enqueueCount++;
        return undefined as T;
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager: {} as WorkspaceManager,
      githubApp: { getAppSlug: () => "kodiai" } as GitHubApp,
      executor: {} as never,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_team: { name: "backend" },
      }),
    );

    expect(enqueueCount).toBe(0);
  });

  test("skips malformed reviewer payloads without throwing", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    let enqueueCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>() => {
        enqueueCount++;
        return undefined as T;
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager: {} as WorkspaceManager,
      githubApp: { getAppSlug: () => "kodiai" } as GitHubApp,
      executor: {} as never,
      logger: createNoopLogger(),
    });

    await expect(
      handlers.get("pull_request.review_requested")!(
        buildReviewRequestedEvent({
          requested_reviewer: "not-an-object",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(enqueueCount).toBe(0);
  });
});
