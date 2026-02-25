import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createReviewHandler } from "./review.ts";
import { buildReviewOutputKey, buildReviewOutputMarker } from "./review-idempotency.ts";
import { createRetriever } from "../knowledge/retrieval.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, CloneOptions } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import { createSearchCache } from "../lib/search-cache.ts";

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

const noopTelemetryStore = {
  record: async () => {},
  recordRetrievalQuality: async () => {},
  recordRateLimitEvent: async () => {},
  recordResilienceEvent: async () => {},
  countRecentTimeouts: async () => 0,
  purgeOlderThan: async () => 0,
  checkpoint: () => {},
  close: () => {},
} as never;

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

function createKnowledgeStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    recordReview: async () => 1,
    recordFindings: async () => undefined,
    recordFeedbackReactions: async () => undefined,
    listRecentFindingCommentCandidates: async () => [],
    recordSuppressionLog: async () => undefined,
    recordGlobalPattern: async () => undefined,
    recordDepBumpMergeHistory: async () => undefined,
    getRepoStats: async () => ({
      totalReviews: 0,
      totalFindings: 0,
      findingsBySeverity: { critical: 0, major: 0, medium: 0, minor: 0 },
      totalSuppressed: 0,
      avgFindingsPerReview: 0,
      avgConfidence: 0,
      topFiles: [],
    }),
    getRepoTrends: async () => [],
    checkAndClaimRun: async () => ({
      shouldProcess: true,
      runKey: "run-key",
      reason: "new" as const,
      supersededRunKeys: [],
    }),
    completeRun: async () => undefined,
    purgeOldRuns: async () => 0,
    getAuthorCache: async () => null,
    upsertAuthorCache: async () => undefined,
    purgeStaleAuthorCache: async () => 0,
    getLastReviewedHeadSha: async () => null,
    getPriorReviewFindings: async () => [],
    aggregateFeedbackPatterns: async () => [],
    clearFeedbackSuppressions: async () => 0,
    listFeedbackSuppressions: async () => [],
    checkpoint: () => undefined,
    close: () => undefined,
    ...overrides,
  };
}

async function createWorkspaceFixture(options: { autoApprove?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();

  await Bun.write(join(dir, "README.md"), "base\n");
  await Bun.write(
    join(dir, ".kodiai.yml"),
    `review:\n  enabled: true\n  autoApprove: ${options.autoApprove ? "true" : "false"}\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`,
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

async function createNoMergeBaseFixture(options: { includePhase27Fields: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-review-no-merge-base-"));

  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();

  await Bun.write(join(dir, "README.md"), "main base\n");
  await $`git -C ${dir} add README.md`.quiet();
  await $`git -C ${dir} commit -m "main base"`.quiet();

  await $`git -C ${dir} checkout --orphan feature`.quiet();
  await $`git -C ${dir} rm -rf .`.quiet().nothrow();

  await $`mkdir -p ${join(dir, "src/api")}`.quiet();
  await $`mkdir -p ${join(dir, "docs")}`.quiet();

  const configWithPhase27 = `review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n  profile: strict\n  pathInstructions:\n    - path: src/api/**\n      instructions: Verify auth checks and error handling for API endpoints.\n`;
  const configWithoutPhase27 = `review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`;

  await Bun.write(
    join(dir, ".kodiai.yml"),
    options.includePhase27Fields ? configWithPhase27 : configWithoutPhase27,
  );
  await Bun.write(
    join(dir, "src/api/phase27-uat-example.ts"),
    "export function run() { return 'ok'; }\n",
  );
  await Bun.write(join(dir, "docs/phase27-note.md"), "notes\n");

  await $`git -C ${dir} add .`.quiet();
  await $`git -C ${dir} commit -m "feature root"`.quiet();
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
      telemetryStore: noopTelemetryStore,
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
      telemetryStore: noopTelemetryStore,
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
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_team: { name: "backend", slug: "backend" },
      }),
    );

    expect(enqueueCount).toBe(0);
  });

  test("accepts team-based rereview requests for ai-review", async () => {
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
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_team: { name: "ai-review", slug: "ai-review" },
      }),
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.installationId).toBe(42);
  });

  test("accepts team-based rereview requests for aireview", async () => {
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
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_team: { name: "aireview", slug: "aireview" },
      }),
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.installationId).toBe(42);
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
      telemetryStore: noopTelemetryStore,
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

describe("createReviewHandler auto profile selection", () => {
  async function runProfileScenario(options: {
    title?: string;
    manualProfile?: "strict" | "balanced" | "minimal";
    additions: number;
    deletions: number;
  }): Promise<{ prompt: string; detailsCommentBody: string }> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const configLines = [
      "review:",
      "  enabled: true",
      "  autoApprove: false",
      "  requestUiRereviewTeamOnOpen: false",
      "  triggers:",
      "    onOpened: true",
      "    onReadyForReview: true",
      "    onReviewRequested: true",
      "  skipAuthors: []",
      "  skipPaths: []",
    ];

    if (options.manualProfile) {
      configLines.push(`  profile: ${options.manualProfile}`);
    }

    await Bun.write(`${workspaceFixture.dir}/.kodiai.yml`, `${configLines.join("\n")}\n`);

    let capturedPrompt = "";
    let detailsCommentBody = "";

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            detailsCommentBody = params.body;
            return { data: {} };
          },
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-auto-profile",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: options.title ?? "Auto profile scenario",
          body: "",
          commits: 0,
          additions: options.additions,
          deletions: options.deletions,
          user: { login: "octocat" },
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "abcdef1234567890",
            ref: "feature",
            repo: {
              full_name: "acme/repo",
              name: "repo",
              owner: { login: "acme" },
            },
          },
          labels: [],
        },
      }),
    );

    await workspaceFixture.cleanup();

    return { prompt: capturedPrompt, detailsCommentBody };
  }

  test("small PRs default to strict profile", async () => {
    const result = await runProfileScenario({ additions: 80, deletions: 20 });

    expect(result.prompt).toContain("Post at most 15 inline comments");
    expect(result.detailsCommentBody).toContain("- Profile: strict (auto, lines changed: 100)");
  });

  test("medium PRs default to balanced profile", async () => {
    const result = await runProfileScenario({ additions: 90, deletions: 20 });

    expect(result.prompt).toContain("Post at most 7 inline comments");
    expect(result.prompt).toContain("Only report findings at these severity levels: critical, major, medium.");
    expect(result.detailsCommentBody).toContain("- Profile: balanced (auto, lines changed: 110)");
  });

  test("large PRs default to minimal profile", async () => {
    const result = await runProfileScenario({ additions: 600, deletions: 20 });

    expect(result.prompt).toContain("Post at most 3 inline comments");
    expect(result.prompt).toContain("Only report findings at these severity levels: critical, major.");
    expect(result.detailsCommentBody).toContain("- Profile: minimal (auto, lines changed: 620)");
  });

  test("manual config profile overrides auto profile", async () => {
    const result = await runProfileScenario({
      manualProfile: "minimal",
      additions: 20,
      deletions: 20,
    });

    expect(result.prompt).toContain("Post at most 3 inline comments");
    expect(result.detailsCommentBody).toContain("- Profile: minimal (manual config)");
  });

  test("keyword profile override supersedes manual and auto", async () => {
    const result = await runProfileScenario({
      title: "[strict-review] tighten auth checks",
      manualProfile: "minimal",
      additions: 700,
      deletions: 200,
    });

    expect(result.prompt).toContain("Post at most 15 inline comments");
    expect(result.detailsCommentBody).toContain("- Profile: strict (keyword override)");
  });
});

describe("createReviewHandler UI rereview team request", () => {
  test("requests uiRereviewTeam on opened when configured", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let requestedTeams: string[] | undefined;

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
          listRequestedReviewers: async () => ({ data: { users: [], teams: [] } }),
          requestReviewers: async (params: { team_reviewers: string[] }) => {
            requestedTeams = params.team_reviewers;
            return { data: {} };
          },
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    // Enable ui rereview in repo config
    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      `review:\n  enabled: true\n  autoApprove: false\n  uiRereviewTeam: ai-review\n  requestUiRereviewTeamOnOpen: true\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`,
    );

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
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.opened");
    expect(handler).toBeDefined();

    await handler!({
      ...buildReviewRequestedEvent({ action: "opened" }),
      name: "pull_request",
      payload: {
        ...buildReviewRequestedEvent({}).payload,
        action: "opened",
      },
    });

    expect(requestedTeams).toEqual(["ai-review"]);

    await workspaceFixture.cleanup();
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
        issues: {
          listComments: async () => ({ data: [] }),
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
      telemetryStore: noopTelemetryStore,
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
        issues: {
          listComments: async () => ({ data: [] }),
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
      telemetryStore: noopTelemetryStore,
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

  test("replaying a clean PR review_requested does not create duplicate approvals", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });
    const { logger } = createCaptureLogger();

    const createdReviews: Array<{ body?: string | null }> = [];
    let executeCount = 0;
    let approveCount = 0;

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({
            data: createdReviews.map((review, index) => ({
              id: index + 1,
              body: review.body ?? null,
            })),
          }),
          createReview: async ({ body }: { body?: string }) => {
            approveCount++;
            createdReviews.push({ body: body ?? null });
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-clean",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    const event = buildReviewRequestedEvent({
      requested_reviewer: { login: "kodiai[bot]" },
    });

    await handler!(event);
    await handler!(event);

    await workspaceFixture.cleanup();

    expect(executeCount).toBe(1);
    expect(approveCount).toBe(1);

    const marker = buildReviewOutputMarker(
      // deterministically built inside handler from these fixture fields
      // (we assert by inclusion instead of exact key string here)
      "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-123:head-abcdef1234567890",
    );

    expect(createdReviews[0]?.body ?? "").toContain("<!-- kodiai:review-output-key:");
    expect(createdReviews[0]?.body ?? "").toContain("kodiai-review-output:v1");
    // Ensure marker format stays stable (no visible text)
    expect(createdReviews[0]?.body ?? "").toContain("-->");
    // Silence unused var lint (marker is illustrative; body checks are the assertion)
    expect(marker).toContain("kodiai:review-output-key");
  });

  test("does not auto-approve when review execution published output", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });

    let approveCount = 0;

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          createReview: async () => {
            approveCount++;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
        execute: async () => {
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-published",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    await workspaceFixture.cleanup();

    expect(approveCount).toBe(0);
  });
});

describe("createReviewHandler fork PR workspace strategy", () => {
  test("fork PRs clone base branch and fetch pull/<n>/head instead of cloning the fork", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const createCalls: CloneOptions[] = [];

    // Expose a PR head ref on the "remote" (origin points to this same repo path)
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet()).text().trim();
    await $`git -C ${workspaceFixture.dir} update-ref refs/pull/101/head ${featureSha}`.quiet();

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
      create: async (_installationId: number, options: CloneOptions) => {
        createCalls.push(options);
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    let executeCount = 0;
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
        execute: async () => {
          executeCount++;
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-fork",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        pull_request: {
          number: 101,
          draft: false,
          title: "Fork PR",
          body: "",
          user: { login: "octocat" },
          base: { ref: "main" },
          head: {
            sha: "abcdef1234567890",
            ref: "feature",
            repo: {
              full_name: "forker/repo",
              name: "repo",
              owner: { login: "forker" },
            },
          },
        },
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(executeCount).toBe(1);

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.owner).toBe("acme");
    expect(createCalls[0]?.repo).toBe("repo");
    expect(createCalls[0]?.ref).toBe("main");

    const branch = (await $`git -C ${workspaceFixture.dir} rev-parse --abbrev-ref HEAD`.quiet())
      .text()
      .trim();
    expect(branch).toBe("pr-review");

    const headSubject = (await $`git -C ${workspaceFixture.dir} show -s --pretty=%s HEAD`.quiet())
      .text()
      .trim();
    expect(headSubject).toBe("feature");

    await workspaceFixture.cleanup();
  });

  test("non-fork PRs still clone the head branch directly (no pull/<n>/head checkout)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const createCalls: CloneOptions[] = [];

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
      create: async (_installationId: number, options: CloneOptions) => {
        createCalls.push(options);
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
        execute: async () => ({
          conclusion: "success",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-nonfork",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.owner).toBe("acme");
    expect(createCalls[0]?.repo).toBe("repo");
    expect(createCalls[0]?.ref).toBe("feature");

    const branch = (await $`git -C ${workspaceFixture.dir} rev-parse --abbrev-ref HEAD`.quiet())
      .text()
      .trim();
    expect(branch).toBe("feature");

    const prReviewRef = await $`git -C ${workspaceFixture.dir} show-ref --verify --quiet refs/heads/pr-review`.nothrow();
    expect(prReviewRef.exitCode).toBe(1);

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler picomatch skipPaths (CONFIG-04)", () => {
  async function createSkipPathsFixture(
    skipPaths: string[],
    changedFiles: Array<{ path: string; content: string }>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-skippaths-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    const skipPathsYaml = skipPaths.map((p) => `    - '${p}'`).join("\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      `review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths:\n${skipPathsYaml}\n`,
    );

    await Bun.write(join(dir, "README.md"), "base\n");
    // Create directories for changed files on main (so they exist)
    for (const f of changedFiles) {
      const dirPath = f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : null;
      if (dirPath) {
        await $`mkdir -p ${join(dir, dirPath)}`.quiet();
      }
      await Bun.write(join(dir, f.path), "placeholder\n");
    }

    await $`git -C ${dir} add .`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();

    // Apply changes on feature branch
    for (const f of changedFiles) {
      await Bun.write(join(dir, f.path), f.content);
    }
    await $`git -C ${dir} add .`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    return {
      dir,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  test("skipPaths: ['docs/**'] skips review when all files are under docs/", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createSkipPathsFixture(
      ["docs/**"],
      [
        { path: "docs/guide.md", content: "updated guide\n" },
        { path: "docs/api.md", content: "updated api\n" },
      ],
    );

    let executorCalled = false;
    const { logger, entries } = createCaptureLogger();

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-skip",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(executorCalled).toBe(false);
    expect(
      entries.some((e) => e.message.includes("All changed files matched skipPaths")),
    ).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("skipPaths: ['*.md'] skips review for nested .md files (backward compat)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createSkipPathsFixture(
      ["*.md"],
      [
        { path: "README.md", content: "updated readme\n" },
        { path: "src/README.md", content: "nested readme\n" },
      ],
    );

    let executorCalled = false;
    const { logger, entries } = createCaptureLogger();

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-skip",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(executorCalled).toBe(false);
    expect(
      entries.some((e) => e.message.includes("All changed files matched skipPaths")),
    ).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("files not matching skipPaths still get reviewed", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createSkipPathsFixture(
      ["docs/**"],
      [
        { path: "docs/guide.md", content: "updated guide\n" },
        { path: "src/index.ts", content: "console.log('hello');\n" },
      ],
    );

    let executorCalled = false;

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-skip",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // src/index.ts doesn't match docs/**, so executor should be called
    expect(executorCalled).toBe(true);

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler retrieval quality telemetry (RET-05)", () => {
  async function createTypeScriptWorkspaceFixture(options: { telemetryEnabled?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-retrieval-quality-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await $`mkdir -p ${join(dir, "src")}`.quiet();
    await Bun.write(join(dir, "src/index.ts"), "export const base = 1;\n");

    const telemetrySection = options.telemetryEnabled === false
      ? "telemetry:\n  enabled: false\n"
      : "";

    await Bun.write(
      join(dir, ".kodiai.yml"),
      `review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n${telemetrySection}`,
    );

    await $`git -C ${dir} add src/index.ts .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();

    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "src/index.ts"), "export const base = 1;\nexport const feature = true;\n");
    await $`git -C ${dir} add src/index.ts`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    return {
      dir,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  test("records retrieval quality metrics from reranked adjusted distances", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createTypeScriptWorkspaceFixture();

    let captured: any = null;
    const telemetryStore = {
      record: () => {},
      recordRetrievalQuality: (entry: any) => {
        captured = entry;
      },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const embeddingProvider = {
      model: "test",
      dimensions: 2,
      generate: async () => ({
        embedding: new Float32Array([0, 1]),
        model: "test",
        dimensions: 2,
      }),
    };

    const isolationLayer = {
      retrieveWithIsolation: async () => {
        const mkRecord = (filePath: string) => ({
          repo: "acme/repo",
          owner: "acme",
          findingId: 1,
          reviewId: 1,
          sourceRepo: "acme/repo",
          findingText: "Example",
          severity: "major",
          category: "correctness",
          filePath,
          outcome: "accepted",
          embeddingModel: "test",
          embeddingDim: 2,
          stale: false,
        });

        return {
          results: [
            { memoryId: 1, distance: 0.2, record: mkRecord("src/example.ts"), sourceRepo: "acme/repo" },
            { memoryId: 2, distance: 0.4, record: mkRecord("src/example.py"), sourceRepo: "acme/repo" },
          ],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 2,
            query: { repo: "acme/repo", topK: 5, threshold: 0.3 },
          },
        };
      },
    };

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore,
      retriever,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    if (!captured) {
      throw new Error("Expected recordRetrievalQuality to be called");
    }

    const entry = captured;
    expect(entry.deliveryId).toBe("delivery-123");
    expect(entry.repo).toBe("acme/repo");
    expect(entry.prNumber).toBe(101);
    expect(entry.eventType).toBe("pull_request");
    expect(entry.topK).toBe(5);
    // < 8 candidates -> percentile fallback (idx=floor(2*0.75)=1)
    // adjusted distances: 0.2*0.85=0.17 (TS match), 0.4*1.0=0.40 (Python: no penalty) -> threshold=0.40
    expect(entry.distanceThreshold).toBeCloseTo(0.40, 6);
    expect(entry.thresholdMethod).toBe("percentile");
    expect(entry.resultCount).toBe(2);
    expect(entry.languageMatchRatio).toBe(0.5);

    // avgDistance uses adjusted distances: (0.2*0.85 + 0.4*1.0) / 2 = 0.285 (no cross-language penalty)
    expect(entry.avgDistance).toBeCloseTo(0.285, 6);

    await workspaceFixture.cleanup();
  });

  test("retriever pipeline applies reranking and telemetry captures final distances", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createTypeScriptWorkspaceFixture();

    let captured: any = null;
    const telemetryStore = {
      record: () => {},
      recordRetrievalQuality: (entry: any) => {
        captured = entry;
      },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const embeddingProvider = {
      model: "test",
      dimensions: 2,
      generate: async () => ({
        embedding: new Float32Array([0, 1]),
        model: "test",
        dimensions: 2,
      }),
    };

    const isolationLayer = {
      retrieveWithIsolation: async () => {
        const mkRecord = (filePath: string) => ({
          repo: "acme/repo",
          owner: "acme",
          findingId: 1,
          reviewId: 1,
          sourceRepo: "acme/repo",
          findingText: "Example",
          severity: "major",
          category: "correctness",
          filePath,
          outcome: "accepted",
          embeddingModel: "test",
          embeddingDim: 2,
          stale: false,
        });

        return {
          results: [
            { memoryId: 1, distance: 0.2, record: mkRecord("src/example.ts"), sourceRepo: "acme/repo" },
            { memoryId: 2, distance: 0.4, record: mkRecord("src/example.py"), sourceRepo: "acme/repo" },
          ],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 2,
            query: { repo: "acme/repo", topK: 5, threshold: 0.3 },
          },
        };
      },
    };

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore,
      retriever,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    if (!captured) {
      throw new Error("Expected recordRetrievalQuality to be called");
    }

    // avgDistance uses adjusted distances from the unified retriever pipeline
    // (0.2*0.85 + 0.4*1.0) / 2 = 0.285 (no cross-language penalty in new policy)
    expect(captured.avgDistance).toBeCloseTo(0.285, 6);

    await workspaceFixture.cleanup();
  });

  test("telemetry.enabled: false suppresses recordRetrievalQuality while still exercising retrieval", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createTypeScriptWorkspaceFixture({ telemetryEnabled: false });

    let retrievalCalls = 0;
    const telemetryStore = {
      record: () => {},
      recordRetrievalQuality: () => {
        retrievalCalls++;
      },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const embeddingProvider = {
      model: "test",
      dimensions: 2,
      generate: async () => ({
        embedding: new Float32Array([0, 1]),
        model: "test",
        dimensions: 2,
      }),
    };

    const isolationLayer = {
      retrieveWithIsolation: async () => ({
        results: [],
        provenance: {
          repoSources: ["acme/repo"],
          sharedPoolUsed: false,
          totalCandidates: 0,
          query: { repo: "acme/repo", topK: 5, threshold: 0.3 },
        },
      }),
    };

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore,
      retriever,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    expect(retrievalCalls).toBe(0);

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler telemetry opt-out (CONFIG-10)", () => {
  test("telemetry.enabled: false suppresses telemetryStore.record", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await Bun.write(join(dir, "README.md"), "base\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: false\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    let recordCalls = 0;
    const telemetryStore = {
      record: () => { recordCalls++; },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: { listReviewComments: async () => ({ data: [] }), listReviews: async () => ({ data: [] }) },
        issues: { listComments: async () => ({ data: [] }) },
        reactions: { createForIssue: async () => ({ data: {} }) },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0.5,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    await rm(dir, { recursive: true, force: true });
    expect(recordCalls).toBe(0);
  });

  test("telemetry.enabled: true (default) calls telemetryStore.record", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await Bun.write(join(dir, "README.md"), "base\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    let recordCalls = 0;
    const telemetryStore = {
      record: () => { recordCalls++; },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: { listReviewComments: async () => ({ data: [] }), listReviews: async () => ({ data: [] }) },
        issues: { listComments: async () => ({ data: [] }) },
        reactions: { createForIssue: async () => ({ data: {} }) },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0.5,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    await rm(dir, { recursive: true, force: true });
    expect(recordCalls).toBe(1);
  });
});

describe("createReviewHandler cost warning (CONFIG-11)", () => {
  test("posts cost warning comment when costWarningUsd threshold exceeded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await Bun.write(join(dir, "README.md"), "base\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: true\n  costWarningUsd: 1.0\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    let costWarningBody: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: { listReviewComments: async () => ({ data: [] }), listReviews: async () => ({ data: [] }) },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            costWarningBody = params.body;
            return { data: {} };
          },
        },
        reactions: { createForIssue: async () => ({ data: {} }) },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 2.5,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    await rm(dir, { recursive: true, force: true });
    expect(costWarningBody).toBeDefined();
    expect(costWarningBody!).toContain("cost warning");
    expect(costWarningBody!).toContain("$2.5000");
    expect(costWarningBody!).toContain("$1.00");
  });

  test("no cost warning when costWarningUsd is 0 (default)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await Bun.write(join(dir, "README.md"), "base\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    const createdCommentBodies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: { listReviewComments: async () => ({ data: [] }), listReviews: async () => ({ data: [] }) },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createdCommentBodies.push(params.body);
            return { data: {} };
          },
        },
        reactions: { createForIssue: async () => ({ data: {} }) },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 50.0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    await rm(dir, { recursive: true, force: true });
    const costWarningBodies = createdCommentBodies.filter((body) => body.includes("Kodiai cost warning"));
    expect(costWarningBodies).toHaveLength(0);
  });

  test("no cost warning when telemetry disabled (even if threshold exceeded)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await Bun.write(join(dir, "README.md"), "base\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: false\n  costWarningUsd: 1.0\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    const createdCommentBodies: string[] = [];
    let recordCalls = 0;

    const telemetryStore = {
      record: () => { recordCalls++; },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: { listReviewComments: async () => ({ data: [] }), listReviews: async () => ({ data: [] }) },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createdCommentBodies.push(params.body);
            return { data: {} };
          },
        },
        reactions: { createForIssue: async () => ({ data: {} }) },
      },
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 5.0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session",
        }),
      } as never,
      telemetryStore,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    await rm(dir, { recursive: true, force: true });
    expect(recordCalls).toBe(0);
    const costWarningBodies = createdCommentBodies.filter((body) => body.includes("Kodiai cost warning"));
    expect(costWarningBodies).toHaveLength(0);
  });
});

describe("createReviewHandler diff collection resilience", () => {
  test("continues review flow when merge-base is unavailable and applies path instructions", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createNoMergeBaseFixture({ includePhase27Fields: true });
    const { logger, entries } = createCaptureLogger();

    let executeCount = 0;
    let capturedPrompt = "";

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          executeCount++;
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-no-merge-base",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(executeCount).toBe(1);
    expect(capturedPrompt).toContain("src/api/phase27-uat-example.ts");
    expect(capturedPrompt).toContain("Path-Specific Review Instructions");
    expect(capturedPrompt).toContain("Verify auth checks and error handling for API endpoints.");

    const diffCollectionLog = entries.find((entry) => entry.data?.gate === "diff-collection");
    expect(diffCollectionLog).toBeDefined();
    expect(diffCollectionLog?.data?.strategy).toBe("fallback-two-dot");

    await workspaceFixture.cleanup();
  });

  test("remains backward compatible when phase 27 review fields are absent", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createNoMergeBaseFixture({ includePhase27Fields: false });

    let executeCount = 0;
    let capturedPrompt = "";

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          executeCount++;
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-back-compat",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(executeCount).toBe(1);
    expect(capturedPrompt).toContain("src/api/phase27-uat-example.ts");
    expect(capturedPrompt).not.toContain("Path-Specific Review Instructions");

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler finding extraction", () => {
  test("extracts structured findings from inline review output", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let exposeInlineFinding = false;
    const recordedReviews: Array<Record<string, unknown>> = [];

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 501,
                  body: [
                    "```yaml",
                    "severity: MAJOR",
                    "category: correctness",
                    "```",
                    "",
                    "**Guard against undefined payload**",
                    "Add a null check before dereferencing.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/handlers/review.ts",
                  line: 777,
                  start_line: 775,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-finding-extraction",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async (entry: Record<string, unknown>) => {
          recordedReviews.push(entry);
          return 1;
        },
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(recordedReviews).toHaveLength(1);
    expect(recordedReviews[0]?.findingsTotal).toBe(1);
    expect(recordedReviews[0]?.findingsMajor).toBe(1);

    await workspaceFixture.cleanup();
  });

  test("persists suppression and confidence metadata for extracted findings", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "  minConfidence: 60",
        "  suppressions:",
        "    - pattern: glob:*legacy shim*",
      ].join("\n") + "\n",
    );

    let exposeInlineFinding = false;
    const recordedReviews: Array<Record<string, unknown>> = [];
    const recordedFindings: Array<Record<string, unknown>> = [];
    const recordedSuppressions: Array<Record<string, unknown>> = [];
    const deletedCommentIds: number[] = [];
    let detailsCommentBody: string | undefined;

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 11,
                  body: [
                    "[CRITICAL] SQL injection in raw query path",
                    "Parameterize user input before query execution.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/db/query.ts",
                  line: 45,
                  start_line: 45,
                },
                {
                  id: 12,
                  body: [
                    "[MINOR] Legacy shim cleanup candidate",
                    "This can be revisited after migration.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/legacy/shim.ts",
                  line: 9,
                  start_line: 8,
                },
                {
                  id: 13,
                  body: [
                    "```yaml",
                    "severity: MINOR",
                    "category: style",
                    "```",
                    "",
                    "**Formatting consistency issue**",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/ui/button.ts",
                  line: 12,
                  start_line: 12,
                },
              ],
            };
          },
          deleteReviewComment: async (params: { comment_id: number }) => {
            deletedCommentIds.push(params.comment_id);
            if (params.comment_id === 13) {
              throw new Error("permission denied");
            }
            return { data: {} };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            detailsCommentBody = params.body;
            return { data: {} };
          },
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-finding-persistence",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async (entry: Record<string, unknown>) => {
          recordedReviews.push(entry);
          return 99;
        },
        recordFindings: async (findings: Record<string, unknown>[]) => {
          recordedFindings.push(...findings);
        },
        recordSuppressionLog: async (entries: Record<string, unknown>[]) => {
          recordedSuppressions.push(...entries);
        },
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(recordedReviews).toHaveLength(1);
    expect(recordedReviews[0]?.suppressionsApplied).toBe(1);

    expect(recordedFindings).toHaveLength(3);
    expect(recordedFindings.every((finding) => finding.reviewId === 99)).toBe(true);

    const suppressedFinding = recordedFindings.find((finding) => finding.suppressed === true);
    expect(suppressedFinding?.suppressionPattern).toBe("glob:*legacy shim*");

    const highConfidenceFinding = recordedFindings.find((finding) => finding.filePath === "src/db/query.ts");
    expect(highConfidenceFinding?.confidence).toBe(90);
    expect(highConfidenceFinding?.commentId).toBe(11);
    expect(highConfidenceFinding?.commentSurface).toBe("pull_request_review_comment");
    expect(typeof highConfidenceFinding?.reviewOutputKey).toBe("string");

    const lowConfidenceFinding = recordedFindings.find((finding) => finding.filePath === "src/ui/button.ts");
    expect(lowConfidenceFinding?.confidence).toBe(45);
    expect(lowConfidenceFinding?.commentId).toBe(13);

    expect(recordedSuppressions).toHaveLength(1);
    expect(recordedSuppressions[0]?.pattern).toBe("glob:*legacy shim*");
    expect(recordedSuppressions[0]?.matchedCount).toBe(1);
    expect(deletedCommentIds).toEqual([12, 13]);

    expect(detailsCommentBody).toContain("<summary>Review Details</summary>");
    expect(detailsCommentBody).toContain("Files reviewed:");
    expect(detailsCommentBody).toMatch(/Lines changed: \+\d+ -\d+/);
    expect(detailsCommentBody).toMatch(/Findings: \d+ critical, \d+ major, \d+ medium, \d+ minor/);
    expect(detailsCommentBody).toMatch(/Review completed: \d{4}-\d{2}-\d{2}T/);
    expect(detailsCommentBody).not.toContain("Lines analyzed:");
    expect(detailsCommentBody).not.toContain("Suppressions applied:");
    expect(detailsCommentBody).not.toContain("Estimated review time saved:");
    expect(detailsCommentBody).not.toContain("Low Confidence Findings");

    await workspaceFixture.cleanup();
  });

  test("publishes Review Details even when execution reports published false", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "  minConfidence: 60",
        "  suppressions:",
        "    - pattern: glob:*legacy shim*",
      ].join("\n") + "\n",
    );

    let exposeInlineFinding = false;
    const deletedCommentIds: number[] = [];
    let listCommentsCalls = 0;
    let createCommentCalls = 0;
    let detailsCommentBody: string | undefined;

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 41,
                  body: [
                    "[MINOR] Legacy shim cleanup candidate",
                    "This can be revisited after migration.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/legacy/shim.ts",
                  line: 9,
                  start_line: 8,
                },
                {
                  id: 42,
                  body: [
                    "```yaml",
                    "severity: MINOR",
                    "category: style",
                    "```",
                    "",
                    "**Formatting consistency issue**",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/ui/button.ts",
                  line: 12,
                  start_line: 12,
                },
                {
                  id: 43,
                  body: [
                    "[CRITICAL] SQL injection in raw query path",
                    "Parameterize user input before query execution.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/db/query.ts",
                  line: 45,
                  start_line: 45,
                },
              ],
            };
          },
          deleteReviewComment: async (params: { comment_id: number }) => {
            deletedCommentIds.push(params.comment_id);
            return { data: {} };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => {
            listCommentsCalls += 1;
            return { data: [] };
          },
          createComment: async (params: { body: string }) => {
            createCommentCalls += 1;
            detailsCommentBody = params.body;
            return { data: {} };
          },
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-details-published-false",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(deletedCommentIds).toEqual([41, 42]);
    expect(listCommentsCalls).toBeGreaterThanOrEqual(1);
    expect(createCommentCalls).toBe(1);
    expect(detailsCommentBody).toContain("<summary>Review Details</summary>");
    expect(detailsCommentBody).toContain("Files reviewed:");
    expect(detailsCommentBody).toMatch(/Lines changed: \+\d+ -\d+/);
    expect(detailsCommentBody).toMatch(/Findings: \d+ critical, \d+ major, \d+ medium, \d+ minor/);
    expect(detailsCommentBody).toMatch(/Review completed: \d{4}-\d{2}-\d{2}T/);
    expect(detailsCommentBody).not.toContain("Suppressions applied:");
    expect(detailsCommentBody).not.toContain("Estimated review time saved:");
    expect(detailsCommentBody).not.toContain("Low Confidence Findings");

    const detailsAttemptLog = entries.find((entry) =>
      entry.data?.gate === "review-details-output" && entry.data?.gateResult === "attempt"
    );
    expect(detailsAttemptLog?.data?.reviewOutputKey).toBe(reviewOutputKey);
    expect(detailsAttemptLog?.data?.owner).toBe("acme");
    expect(detailsAttemptLog?.data?.repo).toBe("repo");
    expect(detailsAttemptLog?.data?.prNumber).toBe(101);

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler global knowledge sharing", () => {
  test("does not write global aggregates when knowledge.shareGlobal is false", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const globalWrites: Array<Record<string, unknown>> = [];

    let exposeInlineFinding = false;

    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "knowledge:",
        "  shareGlobal: false",
      ].join("\n") + "\n",
    );

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 201,
                  body: ["[MAJOR] Validate config branch", marker].join("\n"),
                  path: "src/execution/config.ts",
                  line: 10,
                  start_line: 10,
                },
              ],
            };
          },
          deleteReviewComment: async () => ({ data: {} }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-global-off",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async () => undefined,
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async (entry: Record<string, unknown>) => {
          globalWrites.push(entry);
        },
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(globalWrites).toHaveLength(0);
    await workspaceFixture.cleanup();
  });

  test("writes anonymized global aggregates when knowledge.shareGlobal is true", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const globalWrites: Array<Record<string, unknown>> = [];

    let exposeInlineFinding = false;

    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "knowledge:",
        "  shareGlobal: true",
      ].join("\n") + "\n",
    );

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 301,
                  body: ["[MAJOR] Sanitize query input", marker].join("\n"),
                  path: "src/db/query.ts",
                  line: 25,
                  start_line: 25,
                },
              ],
            };
          },
          deleteReviewComment: async () => ({ data: {} }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-global-on",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async () => undefined,
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async (entry: Record<string, unknown>) => {
          globalWrites.push(entry);
        },
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(globalWrites).toHaveLength(1);
    expect(globalWrites[0]?.severity).toBe("major");
    expect(globalWrites[0]?.category).toBe("correctness");
    expect(globalWrites[0]?.confidenceBand).toBe("high");
    expect(typeof globalWrites[0]?.patternFingerprint).toBe("string");
    expect((globalWrites[0]?.patternFingerprint as string).startsWith("fp-")).toBe(true);
    expect(globalWrites[0]?.count).toBe(1);
    expect(globalWrites[0]?.repo).toBeUndefined();
    expect(globalWrites[0]?.filePath).toBeUndefined();
    expect(globalWrites[0]?.title).toBeUndefined();

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler enforcement integration", () => {
  test("enforcement pipeline elevates C++ null deref from minor to critical", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let exposeInlineFinding = false;
    const recordedFindings: Array<Record<string, unknown>> = [];

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 601,
                  body: [
                    "```yaml",
                    "severity: minor",
                    "category: correctness",
                    "```",
                    "",
                    "**Null pointer dereference risk**",
                    "Potential crash on null access.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/main.cpp",
                  line: 42,
                  start_line: 40,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-enforcement",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // Enforcement should have elevated the C++ null deref from minor to critical
    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.severity).toBe("critical");

    await workspaceFixture.cleanup();
  });

  test("toolingSuppressed findings are treated as suppressed and inline comment deleted", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    // Write a .prettierrc file to enable formatter detection for TypeScript
    await Bun.write(join(workspaceFixture.dir, ".prettierrc"), "{}");
    const { logger: capLogger } = createCaptureLogger();

    let exposeInlineFinding = false;
    const deletedComments: number[] = [];

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 701,
                  body: [
                    "```yaml",
                    "severity: minor",
                    "category: style",
                    "```",
                    "",
                    "**Inconsistent formatting in component**",
                    "Fix indentation.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/app.ts",
                  line: 10,
                  start_line: 8,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
          deleteReviewComment: async (params: { comment_id: number }) => {
            deletedComments.push(params.comment_id);
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-tooling-suppress",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          debugFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
      },
      logger: capLogger,
    });

    const debugFindings: Array<Record<string, unknown>> = [];
    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // A formatting finding in a repo with .prettierrc should be suppressed
    expect(debugFindings).toHaveLength(1);
    expect(debugFindings[0]?.suppressed).toBe(true);
    // And its inline comment should be deleted
    expect(deletedComments).toContain(701);

    await workspaceFixture.cleanup();
  });

  test("enforcement errors do not crash review handler (fail-open)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let exposeInlineFinding = false;
    const recordedFindings: Array<Record<string, unknown>> = [];

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 801,
                  body: [
                    "```yaml",
                    "severity: major",
                    "category: correctness",
                    "```",
                    "",
                    "**Missing error handling**",
                    "Add try-catch.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/handler.ts",
                  line: 20,
                  start_line: 18,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-enforcement-error",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    // Should not throw -- enforcement fail-open preserves findings
    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // The finding should still be recorded (fail-open preserves findings)
    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.severity).toBe("major");

    await workspaceFixture.cleanup();
  });

  test("enforcement is skipped when conclusion is not success", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

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
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "error",
          published: false,
          costUsd: 0,
          numTurns: 0,
          durationMs: 1,
          sessionId: "session-no-findings",
          errorMessage: "Test error",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // When conclusion !== "success", findings should be empty and enforcement should NOT run
    const enforcementLogs = entries.filter(e => e.message === "Language enforcement applied");
    expect(enforcementLogs).toHaveLength(0);

    await workspaceFixture.cleanup();
  });

  test("severity-elevated Go findings use enforced severity in recorded output", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let exposeInlineFinding = false;
    const recordedReviews: Array<Record<string, unknown>> = [];

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }
            return {
              data: [
                {
                  id: 901,
                  body: [
                    "```yaml",
                    "severity: medium",
                    "category: correctness",
                    "```",
                    "",
                    "**Unchecked error return in handler**",
                    "Error return ignored.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "cmd/server/main.go",
                  line: 55,
                  start_line: 53,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-severity-elevation",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async (entry: Record<string, unknown>) => {
          recordedReviews.push(entry);
          return 1;
        },
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // Go unchecked error return should be elevated from medium to major
    expect(recordedReviews).toHaveLength(1);
    expect(recordedReviews[0]?.findingsMajor).toBe(1);
    expect(recordedReviews[0]?.findingsMedium).toBe(0);

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler multi-query retrieval orchestration (RET-07)", () => {
  test("runs exactly three retrieval variants with bounded concurrency and deterministic merged context", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const embedCalls: string[] = [];
    const retrieveCalls: number[] = [];
    let inFlightEmbeds = 0;
    let maxInFlightEmbeds = 0;
    let capturedPrompt = "";

    const embeddingProvider = {
      model: "test",
      dimensions: 1,
      generate: async (query: string) => {
        embedCalls.push(query);
        const variantId = query.includes("files:") ? 2 : query.includes("author:") ? 1 : 3;
        inFlightEmbeds += 1;
        maxInFlightEmbeds = Math.max(maxInFlightEmbeds, inFlightEmbeds);
        await Bun.sleep(variantId === 1 ? 20 : variantId === 2 ? 5 : 10);
        inFlightEmbeds -= 1;
        return {
          embedding: new Float32Array([variantId]),
          model: "test",
          dimensions: 1,
        };
      },
    };

    const isolationLayer = {
      retrieveWithIsolation: async (params: { queryEmbedding: Float32Array }) => {
        const variantId = params.queryEmbedding[0] ?? 0;
        retrieveCalls.push(variantId);

        const mk = (memoryId: number, findingText: string, distance: number) => ({
          memoryId,
          distance,
          sourceRepo: "acme/repo",
          record: {
            id: memoryId,
            repo: "repo",
            owner: "acme",
            findingId: memoryId,
            reviewId: 10 + memoryId,
            sourceRepo: "acme/repo",
            findingText,
            severity: "major",
            category: "correctness",
            filePath: `src/file-${memoryId}.ts`,
            outcome: "accepted",
            embeddingModel: "test",
            embeddingDim: 1,
            stale: false,
          },
        });

        if (variantId === 1) {
          return {
            results: [mk(1, "shared bug", 0.4), mk(2, "intent-only bug", 0.2)],
            provenance: {
              repoSources: ["acme/repo"],
              sharedPoolUsed: false,
              totalCandidates: 2,
              query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
            },
          };
        }

        if (variantId === 2) {
          return {
            results: [mk(1, "shared bug", 0.3)],
            provenance: {
              repoSources: ["acme/repo"],
              sharedPoolUsed: false,
              totalCandidates: 1,
              query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
            },
          };
        }

        return {
          results: [mk(3, "shape-only bug", 0.25)],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 1,
            query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
          },
        };
      },
    };

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-ret07",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      retriever,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    expect(embedCalls).toHaveLength(3);
    expect(embedCalls.some((query) => query.includes("files:"))).toBe(true);
    expect(retrieveCalls).toHaveLength(3);
    expect(maxInFlightEmbeds).toBeLessThanOrEqual(2);

    const sharedIdx = capturedPrompt.indexOf("shared bug");
    const intentOnlyIdx = capturedPrompt.indexOf("intent-only bug");
    const shapeOnlyIdx = capturedPrompt.indexOf("shape-only bug");
    expect(sharedIdx).toBeGreaterThan(-1);
    expect(intentOnlyIdx).toBeGreaterThan(-1);
    expect(shapeOnlyIdx).toBeGreaterThan(-1);

    await workspaceFixture.cleanup();
  });

  test("keeps review execution fail-open when one retrieval variant errors", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let capturedPrompt = "";
    const embeddingProvider = {
      model: "test",
      dimensions: 1,
      generate: async (query: string) => {
        if (query.includes("files:")) {
          throw new Error("file-path variant failed");
        }
        return {
            embedding: new Float32Array([query.includes("author:") ? 1 : 2]),
          model: "test",
          dimensions: 1,
        };
      },
    };

    const isolationLayer = {
      retrieveWithIsolation: async (params: { queryEmbedding: Float32Array }) => {
        const variantId = params.queryEmbedding[0] ?? 0;
        const findingText = variantId === 1 ? "intent variant finding" : "shape variant finding";
        const memoryId = variantId === 1 ? 11 : 12;
        return {
          results: [
            {
              memoryId,
              distance: 0.2,
              sourceRepo: "acme/repo",
              record: {
                id: memoryId,
                repo: "repo",
                owner: "acme",
                findingId: memoryId,
                reviewId: 20 + memoryId,
                sourceRepo: "acme/repo",
                findingText,
                severity: "major",
                category: "correctness",
                filePath: `src/f-${memoryId}.ts`,
                outcome: "accepted",
                embeddingModel: "test",
                embeddingDim: 1,
                stale: false,
              },
            },
          ],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 1,
            query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
          },
        };
      },
    };

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    const failOpenRetriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-ret07-fail-open",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      retriever: failOpenRetriever,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    expect(capturedPrompt).toContain("intent variant finding");
    expect(capturedPrompt).toContain("shape variant finding");

    await workspaceFixture.cleanup();
  });

  test("enriches review retrieval context with snippet anchors and path-only fallback", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let capturedPrompt = "";

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    const anchorRetriever = createRetriever({
      embeddingProvider: {
        model: "test",
        dimensions: 1,
        generate: async () => ({
          embedding: new Float32Array([1]),
          model: "test",
          dimensions: 1,
        }),
      } as never,
      isolationLayer: {
        retrieveWithIsolation: async () => ({
          results: [
            {
              memoryId: 1,
              distance: 0.12,
              sourceRepo: "acme/repo",
              record: {
                id: 1,
                repo: "repo",
                owner: "acme",
                findingId: 1,
                reviewId: 11,
                sourceRepo: "acme/repo",
                findingText: "feature token",
                severity: "major",
                category: "correctness",
                filePath: "README.md",
                outcome: "accepted",
                embeddingModel: "test",
                embeddingDim: 1,
                stale: false,
              },
            },
            {
              memoryId: 2,
              distance: 0.25,
              sourceRepo: "acme/repo",
              record: {
                id: 2,
                repo: "repo",
                owner: "acme",
                findingId: 2,
                reviewId: 12,
                sourceRepo: "acme/repo",
                findingText: "missing file signal",
                severity: "major",
                category: "correctness",
                filePath: "src/missing.ts",
                outcome: "accepted",
                embeddingModel: "test",
                embeddingDim: 1,
                stale: false,
              },
            },
          ],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 2,
            query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
          },
        }),
      } as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-ret08-anchors",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      retriever: anchorRetriever,
      logger: createNoopLogger(),
    });

    await Bun.write(join(workspaceFixture.dir, "README.md"), "base line\nfeature token\n");

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    // Unified cross-corpus context renders source labels (KI-13)
    expect(capturedPrompt).toContain("Knowledge Context");
    expect(capturedPrompt).toContain("feature token");
    expect(capturedPrompt).toContain("missing file signal");

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler feedback-driven suppression", () => {
  // Helper: compute the same FNV-1a fingerprint used by review.ts
  function fingerprintTitle(title: string): string {
    const normalized = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i += 1) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const unsigned = hash >>> 0;
    return `fp-${unsigned.toString(16).padStart(8, "0")}`;
  }

  test("feedback suppression marks matching findings as suppressed", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    // Enable feedback suppression in config
    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "feedback:",
        "  autoSuppress:",
        "    enabled: true",
        "    thresholds:",
        "      minThumbsDown: 3",
        "      minDistinctReactors: 3",
        "      minDistinctPRs: 2",
      ].join("\n") + "\n",
    );

    let exposeInlineFinding = false;
    const recordedFindings: Array<Record<string, unknown>> = [];
    const findingTitle = "Unused import detected";
    const findingFp = fingerprintTitle(findingTitle);

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) return { data: [] };
            return {
              data: [
                {
                  id: 801,
                  body: [
                    "```yaml",
                    "severity: minor",
                    "category: style",
                    "```",
                    "",
                    `**${findingTitle}**`,
                    "Remove unused import.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/utils/helpers.ts",
                  line: 3,
                  start_line: 3,
                },
              ],
            };
          },
          deleteReviewComment: async () => ({ data: {} }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-feedback-suppress",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Return a feedback pattern that matches our finding and exceeds thresholds
        aggregateFeedbackPatterns: async () => [
          {
            fingerprint: findingFp,
            thumbsDownCount: 5,
            thumbsUpCount: 0,
            distinctReactors: 4,
            distinctPRs: 3,
            severity: "minor" as const,
            category: "style" as const,
            sampleTitle: findingTitle,
          },
        ],
        clearFeedbackSuppressions: async () => 0,
        listFeedbackSuppressions: async () => [],
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // Finding should be suppressed via feedback
    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.suppressed).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("feedback suppression skipped when config.feedback.autoSuppress.enabled is false", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    // Default config: feedback.autoSuppress.enabled = false (not set)
    let exposeInlineFinding = false;
    const recordedFindings: Array<Record<string, unknown>> = [];
    let aggregateCalled = false;

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) return { data: [] };
            return {
              data: [
                {
                  id: 802,
                  body: [
                    "```yaml",
                    "severity: minor",
                    "category: style",
                    "```",
                    "",
                    "**Unused import detected**",
                    "Remove unused import.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/utils/helpers.ts",
                  line: 3,
                  start_line: 3,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-feedback-disabled",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        aggregateFeedbackPatterns: async () => {
          aggregateCalled = true;
          return [];
        },
        clearFeedbackSuppressions: async () => 0,
        listFeedbackSuppressions: async () => [],
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // Finding should NOT be suppressed (feedback disabled by default)
    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.suppressed).toBe(false);
    // aggregateFeedbackPatterns should NOT be called when enabled=false
    expect(aggregateCalled).toBe(false);

    await workspaceFixture.cleanup();
  });

  test("CRITICAL findings are not feedback-suppressed", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    // Enable feedback suppression
    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "feedback:",
        "  autoSuppress:",
        "    enabled: true",
        "    thresholds:",
        "      minThumbsDown: 3",
        "      minDistinctReactors: 3",
        "      minDistinctPRs: 2",
      ].join("\n") + "\n",
    );

    let exposeInlineFinding = false;
    const recordedFindings: Array<Record<string, unknown>> = [];
    const findingTitle = "SQL injection risk";
    const findingFp = fingerprintTitle(findingTitle);

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) return { data: [] };
            return {
              data: [
                {
                  id: 803,
                  body: [
                    "```yaml",
                    "severity: critical",
                    "category: security",
                    "```",
                    "",
                    `**${findingTitle}**`,
                    "User input not sanitized.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/db/query.ts",
                  line: 22,
                  start_line: 20,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-feedback-critical",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Return a CRITICAL security pattern -- should be protected by safety guard
        aggregateFeedbackPatterns: async () => [
          {
            fingerprint: findingFp,
            thumbsDownCount: 10,
            thumbsUpCount: 0,
            distinctReactors: 5,
            distinctPRs: 4,
            severity: "critical" as const,
            category: "security" as const,
            sampleTitle: findingTitle,
          },
        ],
        clearFeedbackSuppressions: async () => 0,
        listFeedbackSuppressions: async () => [],
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // CRITICAL finding should NOT be suppressed even with matching feedback pattern
    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.suppressed).toBe(false);

    await workspaceFixture.cleanup();
  });

  test("feedback evaluation failure is fail-open", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    // Enable feedback suppression
    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "feedback:",
        "  autoSuppress:",
        "    enabled: true",
      ].join("\n") + "\n",
    );

    let exposeInlineFinding = false;
    const recordedFindings: Array<Record<string, unknown>> = [];
    const { logger: capLogger, entries: logEntries } = createCaptureLogger();

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) return { data: [] };
            return {
              data: [
                {
                  id: 804,
                  body: [
                    "```yaml",
                    "severity: minor",
                    "category: style",
                    "```",
                    "",
                    "**Unused import detected**",
                    "Remove unused import.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/utils/helpers.ts",
                  line: 3,
                  start_line: 3,
                },
              ],
            };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-feedback-error",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Throw an error to simulate store failure
        aggregateFeedbackPatterns: async () => {
          throw new Error("Database connection lost");
        },
        clearFeedbackSuppressions: async () => 0,
        listFeedbackSuppressions: async () => [],
      },
      logger: capLogger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // Review should complete successfully with no feedback suppressions (fail-open)
    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.suppressed).toBe(false);

    // Should have logged a warning about the failure
    const warningEntry = logEntries.find(e =>
      e.message.includes("Failed to evaluate feedback suppressions"),
    );
    expect(warningEntry).toBeDefined();

    await workspaceFixture.cleanup();
  });

  test("Review Details includes feedback suppression count", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    // Enable feedback suppression
    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "feedback:",
        "  autoSuppress:",
        "    enabled: true",
        "    thresholds:",
        "      minThumbsDown: 3",
        "      minDistinctReactors: 3",
        "      minDistinctPRs: 2",
      ].join("\n") + "\n",
    );

    let exposeInlineFinding = false;
    let detailsCommentBody: string | undefined;
    const findingTitle1 = "Unused import detected";
    const findingTitle2 = "Missing null check in handler";
    const findingFp1 = fingerprintTitle(findingTitle1);
    const findingFp2 = fingerprintTitle(findingTitle2);

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) return { data: [] };
            return {
              data: [
                {
                  id: 805,
                  body: [
                    "```yaml",
                    "severity: minor",
                    "category: style",
                    "```",
                    "",
                    `**${findingTitle1}**`,
                    "Remove unused import.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/utils/helpers.ts",
                  line: 3,
                  start_line: 3,
                },
                {
                  id: 806,
                  body: [
                    "```yaml",
                    "severity: medium",
                    "category: correctness",
                    "```",
                    "",
                    `**${findingTitle2}**`,
                    "Add null check before accessing property.",
                    "",
                    marker,
                  ].join("\n"),
                  path: "src/handlers/api.ts",
                  line: 15,
                  start_line: 14,
                },
              ],
            };
          },
          deleteReviewComment: async () => ({ data: {} }),
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            detailsCommentBody = params.body;
            return { data: {} };
          },
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-feedback-details",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: {
        ...createKnowledgeStoreStub(),
        recordReview: async () => 1,
        recordFindings: async () => undefined,
        recordFeedbackReactions: async () => undefined,
        listRecentFindingCommentCandidates: async () => [],
        recordSuppressionLog: async () => undefined,
        recordGlobalPattern: async () => undefined,
        getRepoStats: async () => ({}) as never,
        getRepoTrends: async () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Return 2 patterns matching both findings, both suppressible (medium/minor)
        aggregateFeedbackPatterns: async () => [
          {
            fingerprint: findingFp1,
            thumbsDownCount: 5,
            thumbsUpCount: 1,
            distinctReactors: 4,
            distinctPRs: 3,
            severity: "minor" as const,
            category: "style" as const,
            sampleTitle: findingTitle1,
          },
          {
            fingerprint: findingFp2,
            thumbsDownCount: 4,
            thumbsUpCount: 0,
            distinctReactors: 3,
            distinctPRs: 2,
            severity: "medium" as const,
            category: "correctness" as const,
            sampleTitle: findingTitle2,
          },
        ],
        clearFeedbackSuppressions: async () => 0,
        listFeedbackSuppressions: async () => [],
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    // Review Details should contain the feedback suppression count
    expect(detailsCommentBody).toBeDefined();
    expect(detailsCommentBody).toContain("2 patterns auto-suppressed by feedback");

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler finding prioritization", () => {
  async function runPrioritizationScenario(options: {
    maxComments: number;
    prioritizationLines?: string[];
    comments: Array<{
      id: number;
      severity: "critical" | "major" | "medium" | "minor";
      category: "security" | "correctness" | "performance" | "style" | "documentation";
      title: string;
      path: string;
    }>;
  }): Promise<{ deletedCommentIds: number[]; detailsCommentBody: string | undefined }> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-prioritization-"));

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    const configLines = [
      "review:",
      "  enabled: true",
      "  autoApprove: false",
      "  requestUiRereviewTeamOnOpen: false",
      "  triggers:",
      "    onOpened: true",
      "    onReadyForReview: true",
      "    onReviewRequested: true",
      "  skipAuthors: []",
      "  skipPaths: []",
      `  maxComments: ${options.maxComments}`,
      ...(options.prioritizationLines ?? []),
    ];

    const uniquePaths = Array.from(new Set(options.comments.map((comment) => comment.path)));

    await Bun.write(join(dir, ".kodiai.yml"), `${configLines.join("\n")}\n`);
    await Bun.write(join(dir, "README.md"), "base\n");

    for (const filePath of uniquePaths) {
      const directory = filePath.includes("/")
        ? filePath.slice(0, filePath.lastIndexOf("/"))
        : "";
      if (directory) {
        await $`mkdir -p ${join(dir, directory)}`.quiet();
      }
      await Bun.write(join(dir, filePath), "base\n");
    }

    await $`git -C ${dir} add .`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();

    for (const filePath of uniquePaths) {
      const lineCount = filePath.includes("auth") ? 200 : 5;
      const content = Array.from({ length: lineCount }, (_, index) => `${filePath}-${index}`).join("\n") + "\n";
      await Bun.write(join(dir, filePath), content);
    }

    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add .`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    let exposeInlineFinding = false;
    let detailsCommentBody: string | undefined;
    const deletedCommentIds: number[] = [];

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

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
        dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!exposeInlineFinding) {
              return { data: [] };
            }

            return {
              data: options.comments.map((comment) => ({
                id: comment.id,
                body: [
                  "```yaml",
                  `severity: ${comment.severity}`,
                  `category: ${comment.category}`,
                  "```",
                  "",
                  `**${comment.title}**`,
                  "Prioritization scenario finding.",
                  "",
                  marker,
                ].join("\n"),
                path: comment.path,
                line: 3,
                start_line: 2,
              })),
            };
          },
          deleteReviewComment: async (params: { comment_id: number }) => {
            deletedCommentIds.push(params.comment_id);
            return { data: {} };
          },
          listReviews: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            detailsCommentBody = params.body;
            return { data: {} };
          },
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-prioritization",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    await rm(dir, { recursive: true, force: true });

    return { deletedCommentIds, detailsCommentBody };
  }

  test("cap overflow keeps top composite-scored findings instead of raw severity order", async () => {
    const result = await runPrioritizationScenario({
      maxComments: 1,
      comments: [
        {
          id: 901,
          severity: "critical",
          category: "style",
          title: "Naming inconsistency",
          path: "docs/changelog.md",
        },
        {
          id: 902,
          severity: "major",
          category: "security",
          title: "Auth token validation gap",
          path: "src/auth/token.ts",
        },
      ],
    });

    expect(result.deletedCommentIds).toEqual([901]);
  });

  test("changing prioritization weights changes selected findings predictably", async () => {
    const severityHeavy = await runPrioritizationScenario({
      maxComments: 1,
      prioritizationLines: [
        "  prioritization:",
        "    severity: 1",
        "    fileRisk: 0",
        "    category: 0",
        "    recurrence: 0",
      ],
      comments: [
        {
          id: 911,
          severity: "critical",
          category: "style",
          title: "Naming inconsistency",
          path: "docs/changelog.md",
        },
        {
          id: 912,
          severity: "major",
          category: "security",
          title: "Auth token validation gap",
          path: "src/auth/token.ts",
        },
      ],
    });

    const fileRiskHeavy = await runPrioritizationScenario({
      maxComments: 1,
      prioritizationLines: [
        "  prioritization:",
        "    severity: 0",
        "    fileRisk: 1",
        "    category: 0",
        "    recurrence: 0",
      ],
      comments: [
        {
          id: 921,
          severity: "critical",
          category: "style",
          title: "Naming inconsistency",
          path: "docs/changelog.md",
        },
        {
          id: 922,
          severity: "major",
          category: "security",
          title: "Auth token validation gap",
          path: "src/auth/token.ts",
        },
      ],
    });

    expect(severityHeavy.deletedCommentIds).toEqual([912]);
    expect(fileRiskHeavy.deletedCommentIds).toEqual([921]);
  });

  test("under-cap runs do not delete findings via prioritization", async () => {
    const result = await runPrioritizationScenario({
      maxComments: 5,
      comments: [
        {
          id: 931,
          severity: "major",
          category: "correctness",
          title: "Missing null guard",
          path: "src/handlers/guard.ts",
        },
        {
          id: 932,
          severity: "minor",
          category: "style",
          title: "Naming inconsistency",
          path: "docs/changelog.md",
        },
      ],
    });

    expect(result.deletedCommentIds).toEqual([]);
  });

  test("Review Details includes prioritization stats when prioritization runs", async () => {
    const result = await runPrioritizationScenario({
      maxComments: 1,
      comments: [
        {
          id: 941,
          severity: "critical",
          category: "style",
          title: "Naming inconsistency",
          path: "docs/changelog.md",
        },
        {
          id: 942,
          severity: "major",
          category: "security",
          title: "Auth token validation gap",
          path: "src/auth/token.ts",
        },
      ],
    });

    expect(result.detailsCommentBody).toContain("Prioritization: scored 2 findings");
    expect(result.detailsCommentBody).toContain("top score");
    expect(result.detailsCommentBody).toContain("threshold score");
  });
});

describe("createReviewHandler dep bump analysis wiring (Phase 57)", () => {
  let previousFetch: typeof globalThis.fetch | undefined;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    previousFetch = globalThis.fetch;

    fetchMock = mock(async (input: any) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("https://registry.npmjs.org/lodash")) {
        return new Response(
          JSON.stringify({ repository: { url: "https://github.com/lodash/lodash" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    });

    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = previousFetch as any;
  });

  async function runDepBumpScenario(params: {
    analyzeImpl: (p: any) => Promise<any>;
  }): Promise<{ prompt: string }> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let capturedPrompt = "";

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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        securityAdvisories: {
          listGlobalAdvisories: async () => ({ data: [] }),
        },
        repos: {
          listReleases: async () => ({
            data: [
              {
                draft: false,
                tag_name: "v4.17.21",
                body: "BREAKING CHANGES:\n- `merge()` removed\n",
              },
            ],
          }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-dep-bump-usage-analysis",
          };
        },
      } as never,
      usageAnalyzer: { analyzePackageUsage: params.analyzeImpl as any },
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Bump lodash from 4.17.20 to 4.17.21",
          body: "",
          commits: 0,
          additions: 10,
          deletions: 0,
          user: { login: "dependabot[bot]" },
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "abcdef1234567890",
            ref: "dependabot/npm_and_yarn/lodash-4.17.21",
            repo: {
              full_name: "acme/repo",
              name: "repo",
              owner: { login: "acme" },
            },
          },
          labels: [{ name: "dependencies" }],
        },
      }),
    );

    await workspaceFixture.cleanup();
    return { prompt: capturedPrompt };
  }

  test("calls usage analyzer when breaking changes exist", async () => {
    const analyzeImpl = mock(async (_params: any) => {
      return {
        evidence: [
          {
            filePath: "src/index.ts",
            line: 1,
            snippet: "import { merge } from 'lodash';",
          },
        ],
        searchTerms: ["lodash", "merge"],
        timedOut: false,
      };
    });

    const result = await runDepBumpScenario({ analyzeImpl });

    expect(analyzeImpl).toHaveBeenCalledTimes(1);
    const call0 = (analyzeImpl as any).mock.calls[0]?.[0];
    expect(call0.packageName).toBe("lodash");
    expect(call0.ecosystem).toBe("npm");
    expect(call0.timeBudgetMs).toBe(3000);
    expect(call0.breakingChangeSnippets.length).toBeGreaterThan(0);

    expect(result.prompt).toContain("Workspace Usage Evidence");
    expect(result.prompt).toContain("`src/index.ts:1`");
  });

  test("usage analysis is fail-open when analyzer throws", async () => {
    const analyzeImpl = mock(async () => {
      throw new Error("boom");
    });

    const result = await runDepBumpScenario({ analyzeImpl });
    expect(result.prompt).not.toContain("Workspace Usage Evidence");
  });
});

describe("createReviewHandler timeout resilience", () => {
  test("full timeout with no output posts partial timeout comment and enqueues a reduced-scope retry", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const createdCommentBodies: string[] = [];
    const enqueuedContexts: Array<{ action?: string; jobType?: string }> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: () => Promise<T>,
        context?: {
          deliveryId?: string;
          eventName?: string;
          action?: string;
          jobType?: string;
          prNumber?: number;
        },
      ) => {
        enqueuedContexts.push({ action: context?.action, jobType: context?.jobType });
        if (context?.action === "review-retry") {
          // Do not execute the retry job in this unit test.
          return undefined as T;
        }
        return fn();
      },
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

    let nextCommentId = 100;
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createdCommentBodies.push(params.body);
            return { data: { id: nextCommentId++ } };
          },
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "timeout",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: () => null,
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout test",
          body: "",
          commits: 0,
          additions: 1,
          deletions: 0,
          user: { login: "octocat" },
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "abcdef1234567890",
            ref: "feature",
            repo: {
              full_name: "acme/repo",
              name: "repo",
              owner: { login: "acme" },
            },
          },
          labels: [],
        },
      }),
    );

    const partial = createdCommentBodies.find((b) => b.includes("**Partial review**"));
    expect(partial).toBeDefined();
    expect(partial!).toContain("timed out after analyzing 0");
    expect(partial!).toContain("Scheduling a reduced-scope retry");

    expect(enqueuedContexts.some((c) => c.action === "review-retry")).toBe(true);

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler author-tier search cache integration", () => {
  async function runAuthorTierScenario(params: {
    eventIds: [string, string];
    triggerConcurrently?: boolean;
    searchCache: {
      get: (key: string) => number | undefined;
      set: (key: string, value: number, ttlMs?: number) => void;
      getOrLoad: (key: string, loader: () => Promise<number>, ttlMs?: number) => Promise<number>;
      purgeExpired: () => number;
    };
    issuesAndPullRequests: (params: { q: string; per_page: number }) => Promise<{ data: { total_count: number } }>;
    telemetryStore?: {
      recordRateLimitEvent?: (entry: Record<string, unknown>) => void;
    };
  }): Promise<number> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixtureA = await createWorkspaceFixture();
    const workspaceFixtureB = await createWorkspaceFixture();
    const workspacePool = [workspaceFixtureA, workspaceFixtureB];

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
      create: async () => {
        const fixture = workspacePool.shift();
        if (!fixture) {
          throw new Error("No workspace fixture available");
        }
        return {
          dir: fixture.dir,
          cleanup: async () => undefined,
        };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: params.issuesAndPullRequests,
        },
      },
    };

    const knowledgeStore = createKnowledgeStoreStub() as never;
    let executeCount = 0;

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executeCount++;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-author-tier-cache",
          };
        },
      } as never,
      telemetryStore: (params.telemetryStore ?? noopTelemetryStore) as never,
      knowledgeStore,
      searchCache: params.searchCache as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    const eventA = buildReviewRequestedEvent(
      {
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Author tier cache scenario",
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
          commits: 0,
          additions: 1,
          deletions: 0,
          author_association: "NONE",
        },
      },
      { id: params.eventIds[0] },
    );

    const eventB = buildReviewRequestedEvent(
      {
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Author tier cache scenario",
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
          commits: 0,
          additions: 1,
          deletions: 0,
          author_association: "NONE",
        },
      },
      { id: params.eventIds[1] },
    );

    if (params.triggerConcurrently) {
      await Promise.all([handler!(eventA), handler!(eventB)]);
    } else {
      await handler!(eventA);
      await handler!(eventB);
    }

    await workspaceFixtureA.cleanup();
    await workspaceFixtureB.cleanup();

    expect(executeCount).toBe(2);
    return executeCount;
  }

  async function runSingleAuthorTierEvent(params: {
    searchCache?: {
      get: (key: string) => number | undefined;
      set: (key: string, value: number, ttlMs?: number) => void;
      getOrLoad: (key: string, loader: () => Promise<number>, ttlMs?: number) => Promise<number>;
      purgeExpired: () => number;
    };
    issuesAndPullRequests: (params: { q: string; per_page: number }) => Promise<{ data: { total_count: number } }>;
    telemetryStore?: {
      recordRateLimitEvent?: (entry: Record<string, unknown>) => void;
    };
    knowledgeStoreOverrides?: Record<string, unknown>;
    configYaml?: string;
    retriever?: ReturnType<typeof createRetriever>;
  }): Promise<{ executeCount: number; prompt: string }> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    let capturedPrompt = "";
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

    await Bun.write(
      join(workspaceFixture.dir, ".kodiai.yml"),
      params.configYaml
        ?? "review:\n  enabled: true\n  autoApprove: false\n  requestUiRereviewTeamOnOpen: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: true\n",
    );

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: params.issuesAndPullRequests,
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
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          executeCount += 1;
          capturedPrompt = context.prompt;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-author-tier-rate-limit",
          };
        },
      } as never,
      telemetryStore: (params.telemetryStore ?? noopTelemetryStore) as never,
      knowledgeStore: createKnowledgeStoreStub(params.knowledgeStoreOverrides) as never,
      searchCache: params.searchCache as never,
      retriever: params.retriever,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Author tier rate-limit scenario",
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
          commits: 0,
          additions: 1,
          deletions: 0,
          author_association: "NONE",
        },
      }),
    );

    await workspaceFixture.cleanup();
    return { executeCount, prompt: capturedPrompt };
  }

  async function runPublishedSummaryDisclosureScenario(params: {
    issuesAndPullRequests: (params: { q: string; per_page: number }) => Promise<{ data: { total_count: number } }>;
  }): Promise<{ executeCount: number; updatedSummaryBody: string | undefined }> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    let executeCount = 0;
    let executeStarted = false;
    let updatedSummaryBody: string | undefined;

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

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);
    const summaryBody = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      "- Reviewed core logic changes.",
      "",
      "</details>",
      "",
      marker,
    ].join("\n");

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: executeStarted
              ? [{ id: 9001, body: summaryBody }]
              : [],
          }),
          createComment: async () => ({ data: {} }),
          updateComment: async (params: { body: string }) => {
            updatedSummaryBody = params.body;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: params.issuesAndPullRequests,
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
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executeCount += 1;
          executeStarted = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-author-tier-summary-disclosure",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub() as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Author tier summary disclosure scenario",
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
          commits: 0,
          additions: 1,
          deletions: 0,
          author_association: "NONE",
        },
      }),
    );

    await workspaceFixture.cleanup();
    return { executeCount, updatedSummaryBody };
  }

  test("reuses cached author-tier lookup for equivalent review events", async () => {
    let searchCallCount = 0;
    const searchCache = createSearchCache<number>({ ttlMs: 60_000 });

    await runAuthorTierScenario({
      eventIds: ["delivery-cache-hit-1", "delivery-cache-hit-2"],
      searchCache,
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        return { data: { total_count: 7 } };
      },
    });

    expect(searchCallCount).toBe(1);
  });

  test("coalesces concurrent equivalent author-tier lookups into one search call", async () => {
    let searchCallCount = 0;
    let releaseSearch!: () => void;
    const searchCache = createSearchCache<number>({ ttlMs: 60_000 });
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });

    const scenarioPromise = runAuthorTierScenario({
      eventIds: ["delivery-cache-concurrent-1", "delivery-cache-concurrent-2"],
      triggerConcurrently: true,
      searchCache,
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        await searchGate;
        return { data: { total_count: 9 } };
      },
    });

    await Bun.sleep(50);
    releaseSearch();
    await scenarioPromise;

    expect(searchCallCount).toBe(1);
  });

  test("falls back to direct lookup when search cache throws", async () => {
    let searchCallCount = 0;
    const brokenCache = {
      get: () => undefined,
      set: () => undefined,
      getOrLoad: async () => {
        throw new Error("cache unavailable");
      },
      purgeExpired: () => 0,
    };

    await runAuthorTierScenario({
      eventIds: ["delivery-cache-fault-1", "delivery-cache-fault-2"],
      searchCache: brokenCache,
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        return { data: { total_count: 11 } };
      },
    });

    expect(searchCallCount).toBe(2);
  });

  test("retries Search API once when author-tier lookup is rate-limited", async () => {
    let searchCallCount = 0;
    const rateLimitEvents: Array<Record<string, unknown>> = [];

    const { executeCount } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        if (searchCallCount === 1) {
          throw {
            status: 403,
            message: "API rate limit exceeded",
            response: {
              headers: {
                "retry-after": "0",
              },
              data: {
                message: "API rate limit exceeded for this endpoint",
              },
            },
          };
        }
        return { data: { total_count: 5 } };
      },
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          rateLimitEvents.push(entry);
        },
      },
    });

    expect(searchCallCount).toBe(2);
    expect(executeCount).toBe(1);
    expect(rateLimitEvents).toHaveLength(1);
    expect(rateLimitEvents[0]?.cacheHitRate).toBe(0);
    expect(rateLimitEvents[0]?.retryAttempts).toBe(1);
    expect(rateLimitEvents[0]?.skippedQueries).toBe(0);
    expect(rateLimitEvents[0]?.degradationPath).toBe("none");
  });

  test("degrades author-tier enrichment after second rate limit and adds partial disclaimer to prompt", async () => {
    let searchCallCount = 0;
    const rateLimitEvents: Array<Record<string, unknown>> = [];

    const { executeCount, prompt } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        throw {
          status: 429,
          message: "secondary rate limit",
          response: {
            headers: {
              "retry-after": "0",
            },
            data: {
              message: "You have exceeded a secondary rate limit",
            },
          },
        };
      },
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          rateLimitEvents.push(entry);
        },
      },
    });

    expect(searchCallCount).toBe(2);
    expect(executeCount).toBe(1);
    expect(prompt).toContain("Analysis is partial due to API limits.");
    const emittedIdentities = new Set(
      rateLimitEvents.map((event) => `${event.deliveryId}:${event.eventType}`),
    );
    expect(rateLimitEvents).toHaveLength(1);
    expect(emittedIdentities.size).toBe(1);
    expect(rateLimitEvents[0]?.deliveryId).toBe("delivery-123");
    expect(rateLimitEvents[0]?.eventType).toBe("pull_request.review_requested");
    expect(rateLimitEvents[0]?.cacheHitRate).toBe(0);
    expect(rateLimitEvents[0]?.retryAttempts).toBe(1);
    expect(rateLimitEvents[0]?.skippedQueries).toBe(1);
    expect(rateLimitEvents[0]?.degradationPath).toBe("search-api-rate-limit");
  });

  test("injects exactly one degraded disclosure sentence into published summary output", async () => {
    const { executeCount, updatedSummaryBody } = await runPublishedSummaryDisclosureScenario({
      issuesAndPullRequests: async () => {
        throw {
          status: 429,
          message: "secondary rate limit",
          response: {
            headers: {
              "retry-after": "0",
            },
            data: {
              message: "You have exceeded a secondary rate limit",
            },
          },
        };
      },
    });

    expect(executeCount).toBe(1);
    expect(updatedSummaryBody).toBeDefined();
    expect(updatedSummaryBody).toContain("Analysis is partial due to API limits.");
    const disclosureCount = (updatedSummaryBody?.match(/Analysis is partial due to API limits\./g) ?? []).length;
    expect(disclosureCount).toBe(1);
  });

  test("does not inject degraded disclosure sentence into non-degraded published summary output", async () => {
    const { executeCount, updatedSummaryBody } = await runPublishedSummaryDisclosureScenario({
      issuesAndPullRequests: async () => ({ data: { total_count: 5 } }),
    });

    expect(executeCount).toBe(1);
    expect(updatedSummaryBody).toBeDefined();
    expect(updatedSummaryBody).not.toContain("Analysis is partial due to API limits.");
  });

  test("continues degraded review execution when telemetry persistence throws", async () => {
    const emittedIdentities: string[] = [];
    const { executeCount, prompt } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        throw {
          status: 429,
          message: "secondary rate limit",
          response: {
            headers: {
              "retry-after": "0",
            },
            data: {
              message: "You have exceeded a secondary rate limit",
            },
          },
        };
      },
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          emittedIdentities.push(`${entry.executionIdentity ?? entry.deliveryId}:${entry.eventType}`);
          throw new Error("telemetry unavailable");
        },
      },
    });

    expect(executeCount).toBe(1);
    expect(prompt).toContain("Analysis is partial due to API limits.");
    expect(emittedIdentities).toHaveLength(1);
    expect(emittedIdentities[0]).toBe("delivery-123:pull_request.review_requested");
  });

  test("degraded review path passes bounded retrieval context without malformed retrieval sections", async () => {
    const { executeCount, prompt } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        throw {
          status: 429,
          message: "secondary rate limit",
          response: {
            headers: {
              "retry-after": "0",
            },
            data: {
              message: "You have exceeded a secondary rate limit",
            },
          },
        };
      },
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "knowledge:",
        "  retrieval:",
        "    enabled: true",
        "    topK: 2",
        "    maxContextChars: 240",
        "telemetry:",
        "  enabled: true",
        "",
      ].join("\n"),
      retriever: createRetriever({
        embeddingProvider: {
          model: "test",
          dimensions: 1,
          generate: async (query: string) => ({
            embedding: new Float32Array([query.includes("files:") ? 2 : 1]),
            model: "test",
            dimensions: 1,
          }),
        } as never,
        isolationLayer: {
          retrieveWithIsolation: async (params: { queryEmbedding: Float32Array }) => {
            const variantId = params.queryEmbedding[0] ?? 0;
            if (variantId === 1) {
              return {
                results: [
                  {
                    memoryId: 1,
                    distance: 0.12,
                    sourceRepo: "acme/repo",
                    record: {
                      id: 1,
                      repo: "repo",
                      owner: "acme",
                      findingId: 1,
                      reviewId: 11,
                      sourceRepo: "acme/repo",
                      findingText: "feature `token`",
                      severity: "major",
                      category: "correctness",
                      filePath: "src/kept.ts",
                      outcome: "accepted",
                      embeddingModel: "test",
                      embeddingDim: 1,
                      stale: false,
                    },
                  },
                ],
                provenance: {
                  repoSources: ["acme/repo"],
                  sharedPoolUsed: false,
                  totalCandidates: 1,
                  query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
                },
              };
            }

            return {
              results: [
                {
                  memoryId: 2,
                  distance: 0.95,
                  sourceRepo: "acme/repo",
                  record: {
                    id: 2,
                    repo: "repo",
                    owner: "acme",
                    findingId: 2,
                    reviewId: 12,
                    sourceRepo: "acme/repo",
                    findingText: "overflow finding ".repeat(40),
                    severity: "major",
                    category: "correctness",
                    filePath: "src/missing.ts",
                    outcome: "accepted",
                    embeddingModel: "test",
                    embeddingDim: 1,
                    stale: false,
                  },
                },
              ],
              provenance: {
                repoSources: ["acme/repo"],
                sharedPoolUsed: false,
                totalCandidates: 1,
                query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
              },
            };
          },
        } as never,
        config: {
          retrieval: { enabled: true, topK: 2, distanceThreshold: 0.3, adaptive: true, maxContextChars: 240 },
          sharing: { enabled: false },
        },
      }),
    });

    expect(executeCount).toBe(1);
    expect(prompt).toContain("## Search API Degradation Context");
    expect(prompt).toContain("Analysis is partial due to API limits.");
    if (prompt.includes("## Similar Prior Findings (Learning Context)")) {
      expect(prompt).toContain("`src/kept.ts` -- feature 'token'");
      expect(prompt).not.toContain("`src/missing.ts`");
      expect(prompt).not.toContain("## Similar Prior Findings (Learning Context)\n\n##");
    } else {
      expect(prompt).not.toContain("## Similar Prior Findings (Learning Context)\n\n##");
    }
  });

  test("continues review execution when rate-limit telemetry write fails", async () => {
    const { executeCount } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => ({ data: { total_count: 5 } }),
      telemetryStore: {
        recordRateLimitEvent: () => {
          throw new Error("telemetry unavailable");
        },
      },
    });

    expect(executeCount).toBe(1);
  });

  test("uses Search cache signal for telemetry when author classification cache is hit", async () => {
    const rateLimitEvents: Array<Record<string, unknown>> = [];

    const { executeCount } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        throw new Error("search should not execute when author classification cache is hit");
      },
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          rateLimitEvents.push(entry);
        },
      },
      knowledgeStoreOverrides: {
        getAuthorCache: () => ({
          tier: "regular",
          prCount: 4,
        }),
      },
    });

    expect(executeCount).toBe(1);
    expect(rateLimitEvents).toHaveLength(1);
    expect(rateLimitEvents[0]?.cacheHitRate).toBe(0);
  });

  test("records telemetry miss then hit across equivalent Search cache reuse", async () => {
    const rateLimitEvents: Array<Record<string, unknown>> = [];
    const searchCache = createSearchCache<number>({ ttlMs: 60_000 });

    await runAuthorTierScenario({
      eventIds: ["delivery-telemetry-search-cache-1", "delivery-telemetry-search-cache-2"],
      searchCache,
      issuesAndPullRequests: async () => ({ data: { total_count: 13 } }),
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          rateLimitEvents.push(entry);
        },
      },
    });

    expect(rateLimitEvents).toHaveLength(2);
    expect(rateLimitEvents[0]?.cacheHitRate).toBe(0);
    expect(rateLimitEvents[1]?.cacheHitRate).toBe(1);
  });

  test("keeps telemetry miss on Search cache fail-open direct lookup", async () => {
    const rateLimitEvents: Array<Record<string, unknown>> = [];
    let searchCallCount = 0;
    const brokenCache = {
      get: () => undefined,
      set: () => undefined,
      getOrLoad: async () => {
        throw new Error("cache unavailable");
      },
      purgeExpired: () => 0,
    };

    const { executeCount } = await runSingleAuthorTierEvent({
      searchCache: brokenCache,
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        return { data: { total_count: 6 } };
      },
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          rateLimitEvents.push(entry);
        },
      },
    });

    expect(searchCallCount).toBe(1);
    expect(executeCount).toBe(1);
    expect(rateLimitEvents).toHaveLength(1);
    expect(rateLimitEvents[0]?.cacheHitRate).toBe(0);
  });
});

describe("createReviewHandler draft PR behavior", () => {
  async function runDraftScenario(options: {
    draft: boolean;
    action: string;
  }) {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  requestUiRereviewTeamOnOpen: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
      ].join("\n") + "\n",
    );

    let capturedPrompt = "";
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
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
          updateComment: async () => ({ data: {} }),
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
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { prompt: string }) => {
          capturedPrompt = context.prompt;
          executeCount++;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-draft-test",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handlerKey = `pull_request.${options.action === "ready_for_review" ? "ready_for_review" : options.action}`;
    const handler = options.action === "review_requested"
      ? handlers.get("pull_request.review_requested")
      : handlers.get(handlerKey);
    expect(handler).toBeDefined();

    const event = buildReviewRequestedEvent({
      ...(options.action === "review_requested" ? { requested_reviewer: { login: "kodiai[bot]" } } : {}),
      action: options.action,
      pull_request: {
        number: 101,
        draft: options.draft,
        title: "Draft PR test",
        body: "",
        commits: 0,
        additions: 50,
        deletions: 10,
        user: { login: "octocat" },
        base: { ref: "main", sha: "mainsha" },
        head: {
          sha: "abcdef1234567890",
          ref: "feature/draft",
          repo: {
            full_name: "acme/repo",
            name: "repo",
            owner: { login: "acme" },
          },
        },
        labels: [],
      },
    });

    await handler!(event);
    await workspaceFixture.cleanup();

    return { prompt: capturedPrompt, executeCount };
  }

  test("reviews draft PRs instead of skipping (draft: true, action: review_requested)", async () => {
    const { executeCount, prompt } = await runDraftScenario({
      draft: true,
      action: "review_requested",
    });
    expect(executeCount).toBe(1);
    expect(prompt).toContain("Draft Review Summary");
  });

  test("ready_for_review uses normal tone even if pr.draft is truthy", async () => {
    const { executeCount, prompt } = await runDraftScenario({
      draft: true,
      action: "ready_for_review",
    });
    expect(executeCount).toBe(1);
    expect(prompt).toContain("<summary>Kodiai Review Summary</summary>");
    expect(prompt).not.toContain("Draft Review Summary");
  });

  test("non-draft PR uses standard review template", async () => {
    const { executeCount, prompt } = await runDraftScenario({
      draft: false,
      action: "review_requested",
    });
    expect(executeCount).toBe(1);
    expect(prompt).toContain("<summary>Kodiai Review Summary</summary>");
    expect(prompt).not.toContain("Draft Review Summary");
  });
});
