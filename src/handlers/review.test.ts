import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createReviewHandler } from "./review.ts";
import { buildReviewOutputMarker } from "./review-idempotency.ts";
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

function createCaptureLogger() {
  const entries: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const capture = (data: unknown, message?: string) => {
    if (typeof data === "string") {
      entries.push({ message: data });
      return;
    }
    entries.push({
      message: message ?? "",
      data: (data ?? {}) as Record<string, unknown>,
    });
  };

  const logger = {
    info: capture,
    warn: capture,
    error: capture,
    debug: capture,
    trace: capture,
    fatal: capture,
    child: () => logger,
  } as unknown as Logger;

  return { logger, entries };
}

async function createWorkspaceFixture() {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();

  await Bun.write(join(dir, "README.md"), "base\n");
  await Bun.write(
    join(dir, ".kodiai.yml"),
    `review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`,
  );

  await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
  await $`git -C ${dir} commit -m "base"`.quiet();
  await $`git -C ${dir} checkout -b feature`.quiet();

  await Bun.write(join(dir, "README.md"), "base\nfeature\n");
  await $`git -C ${dir} add README.md`.quiet();
  await $`git -C ${dir} commit -m "feature"`.quiet();
  await $`git -C ${dir} remote add origin ${dir}`.quiet();

  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function buildReviewRequestedEvent(
  payloadOverrides: Record<string, unknown>,
  eventOverrides: Partial<Pick<WebhookEvent, "id">> = {},
): WebhookEvent {
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
          sha: "abcdef1234567890",
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
    ...eventOverrides,
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

describe("createReviewHandler review_requested idempotency", () => {
  test("replaying the same manual review_requested delivery executes publish path once", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();
    const publishedMarkers = new Set<string>();
    let executeCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: Array.from(publishedMarkers).map((marker, index) => ({
              id: index + 1,
              body: marker,
              user: { login: "kodiai[bot]" },
            })),
          }),
          listReviews: async () => ({ data: [] }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
        initialize: async () => undefined,
        checkConnectivity: async () => true,
        getInstallationToken: async () => "token",
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { reviewOutputKey?: string }) => {
          executeCount++;
          if (context.reviewOutputKey) {
            publishedMarkers.add(buildReviewOutputMarker(context.reviewOutputKey));
          }
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-1",
          };
        },
      } as never,
      logger,
    });

    const event = buildReviewRequestedEvent({
      requested_reviewer: { login: "kodiai[bot]" },
    });
    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(event);
    await handler!(event);

    await workspaceFixture.cleanup();

    expect(executeCount).toBe(1);
    expect(
      entries.filter((entry) => entry.data?.gateResult === "skipped" &&
        entry.data?.skipReason === "already-published").length,
    ).toBe(1);
  });

  test("retry path still idempotently skips duplicate output when ingress dedup is missed", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();
    const publishedMarkers = new Set<string>();
    let executeCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: Array.from(publishedMarkers).map((marker, index) => ({
              id: index + 1,
              body: marker,
              user: { login: "kodiai[bot]" },
            })),
          }),
          listReviews: async () => ({ data: [] }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
        initialize: async () => undefined,
        checkConnectivity: async () => true,
        getInstallationToken: async () => "token",
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { reviewOutputKey?: string }) => {
          executeCount++;
          if (context.reviewOutputKey) {
            publishedMarkers.add(buildReviewOutputMarker(context.reviewOutputKey));
          }
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-2",
          };
        },
      } as never,
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent(
        { requested_reviewer: { login: "kodiai[bot]" } },
        { id: "delivery-retry-001" },
      ),
    );
    await handler!(
      buildReviewRequestedEvent(
        { requested_reviewer: { login: "kodiai[bot]" } },
        { id: "delivery-retry-001" },
      ),
    );

    await workspaceFixture.cleanup();

    expect(executeCount).toBe(1);
    expect(
      entries.some((entry) =>
        entry.message.includes("Skipping review execution because output already published for key")
      ),
    ).toBe(true);
  });
});
