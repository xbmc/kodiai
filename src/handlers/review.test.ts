import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createReviewHandler } from "./review.ts";
import { buildReviewOutputKey, buildReviewOutputMarker } from "./review-idempotency.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, CloneOptions } from "../jobs/types.ts";
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

const noopTelemetryStore = { record: () => {}, purgeOlderThan: () => 0, checkpoint: () => {}, close: () => {} } as never;

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
    recordReview: () => 1,
    recordFindings: () => undefined,
    recordFeedbackReactions: () => undefined,
    listRecentFindingCommentCandidates: () => [],
    recordSuppressionLog: () => undefined,
    recordGlobalPattern: () => undefined,
    getRepoStats: () => ({
      totalReviews: 0,
      totalFindings: 0,
      findingsBySeverity: { critical: 0, major: 0, medium: 0, minor: 0 },
      totalSuppressed: 0,
      avgFindingsPerReview: 0,
      avgConfidence: 0,
      topFiles: [],
    }),
    getRepoTrends: () => [],
    checkAndClaimRun: () => ({
      shouldProcess: true,
      runKey: "run-key",
      reason: "new" as const,
      supersededRunKeys: [],
    }),
    completeRun: () => undefined,
    purgeOldRuns: () => 0,
    getAuthorCache: () => null,
    upsertAuthorCache: () => undefined,
    purgeStaleAuthorCache: () => 0,
    getLastReviewedHeadSha: () => null,
    getPriorReviewFindings: () => [],
    aggregateFeedbackPatterns: () => [],
    clearFeedbackSuppressions: () => 0,
    listFeedbackSuppressions: () => [],
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
        ...createKnowledgeStoreStub(),
        recordReview: (entry: Record<string, unknown>) => {
          recordedReviews.push(entry);
          return 1;
        },
        recordFindings: () => undefined,
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: (entry: Record<string, unknown>) => {
          recordedReviews.push(entry);
          return 99;
        },
        recordFindings: (findings: Record<string, unknown>[]) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: (entries: Record<string, unknown>[]) => {
          recordedSuppressions.push(...entries);
        },
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: () => 1,
        recordFindings: () => undefined,
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: (entry: Record<string, unknown>) => {
          globalWrites.push(entry);
        },
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: () => 1,
        recordFindings: () => undefined,
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: (entry: Record<string, unknown>) => {
          globalWrites.push(entry);
        },
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          debugFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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
        recordReview: (entry: Record<string, unknown>) => {
          recordedReviews.push(entry);
          return 1;
        },
        recordFindings: () => undefined,
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
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

    // Go unchecked error return should be elevated from medium to major
    expect(recordedReviews).toHaveLength(1);
    expect(recordedReviews[0]?.findingsMajor).toBe(1);
    expect(recordedReviews[0]?.findingsMedium).toBe(0);

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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Return a feedback pattern that matches our finding and exceeds thresholds
        aggregateFeedbackPatterns: () => [
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
        clearFeedbackSuppressions: () => 0,
        listFeedbackSuppressions: () => [],
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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        aggregateFeedbackPatterns: () => {
          aggregateCalled = true;
          return [];
        },
        clearFeedbackSuppressions: () => 0,
        listFeedbackSuppressions: () => [],
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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Return a CRITICAL security pattern -- should be protected by safety guard
        aggregateFeedbackPatterns: () => [
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
        clearFeedbackSuppressions: () => 0,
        listFeedbackSuppressions: () => [],
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
        recordReview: () => 1,
        recordFindings: (findings: Array<Record<string, unknown>>) => {
          recordedFindings.push(...findings);
        },
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Throw an error to simulate store failure
        aggregateFeedbackPatterns: () => {
          throw new Error("Database connection lost");
        },
        clearFeedbackSuppressions: () => 0,
        listFeedbackSuppressions: () => [],
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
        recordReview: () => 1,
        recordFindings: () => undefined,
        recordFeedbackReactions: () => undefined,
        listRecentFindingCommentCandidates: () => [],
        recordSuppressionLog: () => undefined,
        recordGlobalPattern: () => undefined,
        getRepoStats: () => ({}) as never,
        getRepoTrends: () => [],
        checkpoint: () => undefined,
        close: () => undefined,
        // Return 2 patterns matching both findings, both suppressible (medium/minor)
        aggregateFeedbackPatterns: () => [
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
        clearFeedbackSuppressions: () => 0,
        listFeedbackSuppressions: () => [],
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
