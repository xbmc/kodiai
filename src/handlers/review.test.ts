import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { $ } from "bun";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { buildReviewPromptFingerprint, collectDiffContext, createReviewHandler, formatTimeoutErrorDetail, resolveAuthorTierFromSources, REVIEW_WORKSPACE_FETCH_DEPTH } from "./review.ts";
import { buildReviewPlan } from "../review-orchestration/review-plan.ts";
import {
  createDegradedReviewReducerResult,
  type ReviewReducerInput,
  type ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import { createMentionHandler } from "./mention.ts";
import { buildReviewOutputKey, buildReviewOutputMarker, extractReviewOutputKey } from "./review-idempotency.ts";
import { createRetriever } from "../knowledge/retrieval.ts";
import type {
  ContributorProfile,
  ContributorProfileStore,
} from "../contributor/types.ts";
import { CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER } from "../contributor/profile-trust.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, JobQueueContext, JobQueueRunMetadata, WorkspaceManager, CloneOptions } from "../jobs/types.ts";
import { createQueueRunMetadata, getEmptyActiveJobs } from "../jobs/queue.test-helpers.ts";
import { fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import { createSearchCache } from "../lib/search-cache.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { ShadowSpecialistSubflowInput, ShadowSpecialistSubflowResult } from "../specialists/shadow-specialist-subflow.ts";

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
  recordReviewCacheEvent: async () => {},
  recordResilienceEvent: async () => {},
  recordLlmCost: async () => {},
  recordPromptSections: async () => {},
  countRecentTimeouts: async () => 0,
  purgeOlderThan: async () => 0,
  checkpoint: () => {},
  close: () => {},
};

function createCaptureLogger() {
  const entries: Array<{ level?: "info" | "warn" | "error" | "debug" | "trace" | "fatal"; message: string; data?: Record<string, unknown> }> = [];
  const capture = (level: "info" | "warn" | "error" | "debug" | "trace" | "fatal") => (data: unknown, message?: string) => {
    if (typeof data === "string") {
      entries.push({ level, message: data });
      return;
    }
    entries.push({
      level,
      message: message ?? "",
      data: (data ?? {}) as Record<string, unknown>,
    });
  };

  const logger = {
    info: capture("info"),
    warn: capture("warn"),
    error: capture("error"),
    debug: capture("debug"),
    trace: capture("trace"),
    fatal: capture("fatal"),
    child: () => logger,
  } as unknown as Logger;

  return { logger, entries };
}

function extractReviewDetailsBlock(body: string): string {
  const summary = "<summary>Review Details</summary>";
  const summaryIndex = body.indexOf(summary);

  expect(summaryIndex).toBeGreaterThanOrEqual(0);

  const start = body.lastIndexOf("<details>", summaryIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(start).toBeLessThanOrEqual(summaryIndex);

  const end = body.indexOf("</details>", summaryIndex);
  expect(end).toBeGreaterThanOrEqual(0);

  const detailsEnd = end + "</details>".length;
  const markerMatch = body
    .slice(detailsEnd)
    .match(/^\s*(<!--\s*kodiai:review-details:[^>]+-->)/);

  return markerMatch
    ? `${body.slice(start, detailsEnd)}\n\n${markerMatch[1]}`
    : body.slice(start, detailsEnd);
}

describe("createReviewHandler coordinator wiring", () => {
  test("logs when the review handler falls back to a private coordinator", () => {
    const { logger, entries } = createCaptureLogger();

    createReviewHandler({
      eventRouter: {
        register: () => undefined,
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async () => {
          throw new Error("not used");
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => {
          throw new Error("not used");
        },
        cleanupStale: async () => 0,
      } as unknown as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: logger as never,
    });

    const fallbackLog = entries.find(
      (entry) =>
        entry.message ===
        "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );

    expect(fallbackLog?.data?.gate).toBe("review-family-coordinator");
    expect(fallbackLog?.data?.gateResult).toBe("private-fallback");
    expect(fallbackLog?.data?.coordinationScope).toBe("handler-local");
  });
});

describe("createReviewHandler queued-claim cleanup", () => {
  test("releases a pre-enqueue automatic claim when queueing fails", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 2_000;
        return () => ++nowMs;
      })(),
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 101);
    const olderAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-older-auto",
      phase: "claimed",
    });
    coordinator.setPhase(olderAttempt.attemptId, "executor-dispatch");

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async () => {
          throw new Error("queue unavailable");
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {} as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: coordinator,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await expect(
      handler!(
        buildReviewRequestedEvent(
          { requested_reviewer: { login: "kodiai[bot]" } },
          { id: "delivery-new-auto" },
        ),
      ),
    ).rejects.toThrow("queue unavailable");

    expect(coordinator.canPublish(olderAttempt.attemptId)).toBeTrue();
    expect(coordinator.getSnapshot(familyKey)?.attempts.map((attempt) => attempt.attemptId)).toEqual([
      olderAttempt.attemptId,
    ]);
  });

  test("fork pull requests use trusted base config instead of PR-head config", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: false });
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet()).text().trim();

    await $`git -C ${workspaceFixture.dir} checkout feature`.quiet();
    await Bun.write(
      join(workspaceFixture.dir, ".kodiai.yml"),
      [
        "review:",
        "  enabled: false",
        "  autoApprove: false",
        "  triggers:",
        "    onOpened: false",
        "    onReadyForReview: false",
        "    onReviewRequested: false",
        "  skipAuthors: []",
        "  skipPaths: []",
      ].join("\n") + "\n",
    );
    await $`git -C ${workspaceFixture.dir} add .kodiai.yml`.quiet();
    await $`git -C ${workspaceFixture.dir} commit -m "disable review in fork head"`.quiet();
    const disabledConfigFeatureSha = (await $`git -C ${workspaceFixture.dir} rev-parse HEAD`.quiet()).text().trim();
    await $`git -C ${workspaceFixture.dir} update-ref refs/pull/101/head ${disabledConfigFeatureSha}`.quiet();
    await $`git -C ${workspaceFixture.dir} checkout main`.quiet();

    let executeCount = 0;
    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };
    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        reactions: { createForIssue: async () => ({ data: {} }) },
        search: { issuesAndPullRequests: async () => ({ data: { total_count: 0 } }) },
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
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-fork-base-config",
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
          title: "Fork config trust",
          body: "",
          user: { login: "external-contributor" },
          base: { ref: "main", sha: featureSha },
          head: {
            sha: disabledConfigFeatureSha,
            ref: "feature",
            repo: {
              full_name: "external/repo",
              name: "repo",
              owner: { login: "external" },
            },
          },
          labels: [],
        },
      }),
    );

    await workspaceFixture.cleanup();
    expect(executeCount).toBe(1);
  });

  test("older queued automatic review stays suppressed after a newer explicit review finishes first", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet()).text().trim();
    await $`git -C ${workspaceFixture.dir} update-ref refs/pull/101/head ${featureSha}`.quiet();
    await Bun.write(
      join(workspaceFixture.dir, ".kodiai.yml"),
      [
        "review:",
        "  enabled: true",
        "  autoApprove: true",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "mention:",
        "  enabled: true",
      ].join("\n") + "\n",
    );

    const { logger, entries } = createCaptureLogger();
    const queueMetadata = createQueueRunMetadata();
    const automaticQueued = Promise.withResolvers<void>();
    const automaticCaptured = Promise.withResolvers<void>();
    let queuedAutomaticJob:
      | ((metadata: JobQueueRunMetadata) => Promise<unknown>)
      | undefined;
    const createdReviews: Array<{ event: string; body?: string }> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: { jobType?: string },
      ) => {
        if (context?.jobType === "pull-request-review") {
          queuedAutomaticJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          automaticCaptured.resolve();
          await automaticQueued.promise;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options?: CloneOptions) => {
        if (options?.ref) {
          await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        }
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
          createReview: async ({ event, body }: { event: string; body?: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
      },
    };

    const reviewWorkCoordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 4_000;
        return () => ++nowMs;
      })(),
    });

    const githubApp = {
      getAppSlug: () => "kodiai",
      getInstallationOctokit: async () => octokit as never,
      initialize: async () => undefined,
      checkConnectivity: async () => true,
      getInstallationToken: async () => "token",
    } as unknown as GitHubApp;

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp,
      executor: {
        execute: async (_context: { taskType: string }) => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-automatic-review",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator,
      logger: logger as never,
    });

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-explicit-review",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          usedRepoInspectionTools: true,
          toolUseNames: ["Glob", "Read"],
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator,
      logger: logger as never,
    });

    const automaticHandler = handlers.get("pull_request.review_requested");
    const explicitHandler = handlers.get("issue_comment.created");
    expect(automaticHandler).toBeDefined();
    expect(explicitHandler).toBeDefined();

    const automaticPromise = automaticHandler!(
      buildReviewRequestedEvent(
        {
          requested_reviewer: { login: "kodiai[bot]" },
          pull_request: {
            number: 101,
            draft: false,
            title: "Queued automatic review",
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
        },
        { id: "delivery-auto-older" },
      ),
    );

    await automaticCaptured.promise;

    await explicitHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber: 101,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(1);
    expect(createdReviews[0]?.event).toBe("APPROVE");

    const automaticRunResult = await queuedAutomaticJob!(queueMetadata);
    automaticQueued.resolve();
    await automaticPromise;
    void automaticRunResult;

    expect(createdReviews).toHaveLength(1);
    expect(
      entries.some((entry) => entry.message === "Skipping auto-approval because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });
});

function buildContributorProfileFixture(
  overrides: Partial<ContributorProfile> & { overallTier?: string } = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: null,
    displayName: "Octo Cat",
    overallTier: "established",
    overallScore: 0.82,
    optedOut: false,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
    trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
    ...overrides,
  } as ContributorProfile;
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

async function createWorkspaceFixture(options: { autoApprove?: boolean; graphValidationEnabled?: boolean; extraChangedFiles?: number; maxComments?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));

  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();

  await Bun.write(join(dir, "README.md"), "base\n");
  await Bun.write(
    join(dir, ".kodiai.yml"),
    `review:\n  enabled: true\n  autoApprove: ${options.autoApprove ? "true" : "false"}\n  maxComments: ${options.maxComments ?? 10}\n  graphValidation:\n    enabled: ${options.graphValidationEnabled ? "true" : "false"}\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`,
  );

  await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
  await $`git -C ${dir} commit -m "base"`.quiet();
  await $`git -C ${dir} checkout -b feature`.quiet();

  await Bun.write(join(dir, "README.md"), "base\nfeature\n");
  for (let index = 0; index < (options.extraChangedFiles ?? 0); index += 1) {
    await Bun.write(join(dir, `feature-${index}.txt`), `feature ${index}\n`);
  }
  await $`git -C ${dir} add README.md ${Array.from({ length: options.extraChangedFiles ?? 0 }, (_, index) => `feature-${index}.txt`)}`.quiet();
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

  const configWithPhase27 = `review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n  profile: strict\n  pathInstructions:\n    - path: src/api/**\n      instructions: Verify auth checks and error handling for API endpoints.\n`;
  const configWithoutPhase27 = `review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`;

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

function buildPrIssueCommentMentionEvent(params: {
  prNumber: number;
  commentBody: string;
  commentAuthor?: string;
  commentId?: number;
  defaultBranch?: string;
}): WebhookEvent {
  return {
    id: "delivery-pr-issue-comment-mention",
    name: "issue_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        name: "repo",
        owner: { login: "acme" },
        default_branch: params.defaultBranch ?? "main",
      },
      issue: {
        number: params.prNumber,
        pull_request: {
          url: `https://api.github.com/repos/acme/repo/pulls/${params.prNumber}`,
        },
      },
      comment: {
        id: params.commentId ?? 779,
        body: params.commentBody,
        user: { login: params.commentAuthor ?? "alice" },
        created_at: "2025-01-15T12:00:00Z",
      },
    } as unknown as WebhookEvent["payload"],
  };
}

function buildReviewCommentMentionEvent(params: {
  prNumber: number;
  baseRef: string;
  headRef: string;
  headRepoOwner: string;
  headRepoName: string;
  commentBody: string;
  commentAuthor?: string;
  commentId?: number;
  inReplyToId?: number;
}): WebhookEvent {
  return {
    id: "delivery-review-comment-mention",
    name: "pull_request_review_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        name: "repo",
        owner: { login: "acme" },
      },
      pull_request: {
        number: params.prNumber,
        head: {
          ref: params.headRef,
          repo: {
            name: params.headRepoName,
            owner: { login: params.headRepoOwner },
          },
        },
        base: { ref: params.baseRef },
      },
      comment: {
        id: params.commentId ?? 555,
        body: params.commentBody,
        user: { login: params.commentAuthor ?? "alice" },
        created_at: "2025-01-15T12:00:00Z",
        diff_hunk: "@@ -1,1 +1,1\n- old\n+ new",
        path: "README.md",
        line: 1,
        in_reply_to_id: params.inReplyToId,
      },
    },
  };
}

describe("resolveAuthorTierFromSources", () => {
  test("prefers contributor profile tier ahead of cache and fallback", () => {
    expect(
      resolveAuthorTierFromSources({
        contributorTier: "established",
        cachedTier: "first-time",
        fallbackTier: "first-time",
      }),
    ).toEqual({ tier: "established", source: "contributor-profile" });
  });

  test("falls back to cached tier when contributor profile is absent", () => {
    expect(
      resolveAuthorTierFromSources({
        contributorTier: null,
        cachedTier: "regular",
        fallbackTier: "first-time",
      }),
    ).toEqual({ tier: "regular", source: "author-cache" });
  });

  test("cached author tiers are limited to fallback taxonomy values", () => {
    expect(
      resolveAuthorTierFromSources({
        contributorTier: null,
        cachedTier: "core",
        fallbackTier: "first-time",
      }),
    ).toEqual({ tier: "core", source: "author-cache" });
  });

  test("uses fallback tier when neither profile nor cache is available", () => {
    expect(
      resolveAuthorTierFromSources({
        contributorTier: null,
        cachedTier: null,
        fallbackTier: "first-time",
      }),
    ).toEqual({ tier: "first-time", source: "fallback" });
  });
});

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
      getActiveJobs: getEmptyActiveJobs,
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
      getActiveJobs: getEmptyActiveJobs,
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
      getActiveJobs: getEmptyActiveJobs,
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

  test("skips team-only review requests for ai-review", async () => {
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
      getActiveJobs: getEmptyActiveJobs,
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

    expect(enqueued).toHaveLength(0);
  });

  test("skips team-only review requests for aireview", async () => {
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
      getActiveJobs: getEmptyActiveJobs,
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

    expect(enqueued).toHaveLength(0);
  });

  test("logs ai-review and aireview team-only review requests as skipped manual triggers", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const { logger, entries } = createCaptureLogger();
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
      getActiveJobs: getEmptyActiveJobs,
    };

    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager: {} as WorkspaceManager,
      githubApp: { getAppSlug: () => "kodiai" } as GitHubApp,
      executor: {} as never,
      telemetryStore: noopTelemetryStore,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_team: { name: "ai-review", slug: "ai-review" },
      }),
    );

    await handler!(
      buildReviewRequestedEvent({
        requested_team: { name: "aireview", slug: "aireview" },
      }),
    );

    expect(enqueued).toHaveLength(0);

    const skipLogs = entries.filter((entry) =>
      entry.message === "Skipping review_requested event because only a team was requested"
    );

    expect(skipLogs).toHaveLength(2);
    expect(skipLogs.map((entry) => ({
      gate: entry.data?.gate,
      gateResult: entry.data?.gateResult,
      skipReason: entry.data?.skipReason,
      requestedReviewer: entry.data?.requestedReviewer,
      requestedTeam: entry.data?.requestedTeam,
      requestedTeamSlug: entry.data?.requestedTeamSlug,
    }))).toEqual([
      {
        gate: "review_requested_reviewer",
        gateResult: "skipped",
        skipReason: "team-only-request",
        requestedReviewer: null,
        requestedTeam: "ai-review",
        requestedTeamSlug: "ai-review",
      },
      {
        gate: "review_requested_reviewer",
        gateResult: "skipped",
        skipReason: "team-only-request",
        requestedReviewer: null,
        requestedTeam: "aireview",
        requestedTeamSlug: "aireview",
      },
    ]);
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
      getActiveJobs: getEmptyActiveJobs,
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
    contributorTier?: "newcomer" | "developing" | "established" | "senior";
    contributorOptedOut?: boolean;
    contributorProfile?:
      | (Partial<ContributorProfile> & { overallTier?: string })
      | null;
    prAuthor?: string;
    authorAssociation?: string;
    searchPrCount?: number;
    searchError?: unknown;
  }): Promise<{ prompt: string; detailsCommentBody: string }> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const configLines = [
      "review:",
      "  enabled: true",
      "  autoApprove: false",
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        search: {
          issuesAndPullRequests: async () => {
            if (options.searchError) {
              throw options.searchError;
            }
            return { data: { total_count: options.searchPrCount ?? 4 } };
          },
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
      contributorProfileStore:
        options.contributorProfile || options.contributorTier
          ? {
            getByGithubUsername: async (login: string) =>
              login === (options.prAuthor ?? "octocat")
                ? buildContributorProfileFixture({
                  overallTier: options.contributorTier,
                  optedOut: options.contributorOptedOut ?? false,
                  ...(options.contributorProfile ?? {}),
                })
                : null,
            getExpertise: async () => [],
          } as never
          : undefined,
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
          user: { login: options.prAuthor ?? "octocat" },
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
          author_association: options.authorAssociation,
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

  test("profile-backed contributor guidance resolves without knowledgeStore gating", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      contributorTier: "established",
    });

    expect(result.prompt).toContain("The PR author (octocat) is an established contributor.");
    expect(result.prompt).toContain("Keep explanations brief — one sentence on WHY, then the suggestion");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: profile-backed (using linked contributor profile guidance)",
    );
    expect(result.detailsCommentBody).not.toContain("- Author tier:");
  });

  test("linked-unscored stored profiles fail open to coarse fallback instead of profile-backed newcomer guidance", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      contributorProfile: {
        overallTier: "newcomer",
        overallScore: 0,
        lastScoredAt: null,
        trustMarker: null,
      },
      searchPrCount: 4,
    });

    expect(result.prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(result.prompt).toContain("only coarse fallback signals");
    expect(result.prompt).not.toContain("first-time or new contributor to this repository.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
    );
    expect(result.detailsCommentBody).not.toContain("profile-backed");
  });

  test("legacy stored profiles fail open to coarse fallback instead of retained established guidance", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      contributorProfile: {
        overallTier: "established",
        trustMarker: null,
      },
      searchPrCount: 4,
    });

    expect(result.prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(result.prompt).toContain("only coarse fallback signals");
    expect(result.prompt).not.toContain("The PR author (octocat) is an established contributor.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
    );
    expect(result.detailsCommentBody).not.toContain("profile-backed");
  });

  test("stale calibrated stored profiles fail open to coarse fallback instead of retained established guidance", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      contributorProfile: {
        overallTier: "established",
        lastScoredAt: new Date("2025-09-01T00:00:00.000Z"),
      },
      searchPrCount: 4,
    });

    expect(result.prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(result.prompt).toContain("only coarse fallback signals");
    expect(result.prompt).not.toContain("The PR author (octocat) is an established contributor.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
    );
    expect(result.detailsCommentBody).not.toContain("profile-backed");
  });

  test("coarse fallback keeps contract-scoped wording without overclaiming profile-backed certainty", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      searchPrCount: 4,
    });

    expect(result.prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(result.prompt).toContain("only coarse fallback signals");
    expect(result.prompt).not.toContain("developing contributor with growing familiarity in this area.");
    expect(result.prompt).not.toContain("established contributor.");
    expect(result.prompt).not.toContain("core/senior contributor of this repository.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
    );
    expect(result.detailsCommentBody).not.toContain("profile-backed");
    expect(result.detailsCommentBody).not.toContain("- Author tier:");
  });

  test("coarse fallback core signals stay contract-scoped instead of using senior shorthand", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      searchPrCount: 25,
    });

    expect(result.prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(result.prompt).toContain("only coarse fallback signals");
    expect(result.prompt).not.toContain("core/senior contributor of this repository.");
    expect(result.prompt).not.toContain("The author has deep expertise in");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
    );
  });

  test("generic unknown contract keeps prompt behavior neutral when no safe contributor signal exists", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      authorAssociation: "OUTSIDE_COLLABORATOR",
    });

    expect(result.prompt).toContain("Contributor-experience contract: generic-unknown.");
    expect(result.prompt).toContain(
      "No reliable contributor signal is available for the PR author (octocat).",
    );
    expect(result.prompt).not.toContain("first-time or new contributor");
    expect(result.prompt).not.toContain("developing contributor with growing familiarity");
    expect(result.prompt).not.toContain("established contributor.");
    expect(result.prompt).not.toContain("core/senior contributor of this repository.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: generic-unknown (no reliable contributor signal available)",
    );
  });

  test("opted-out contributor profiles stay generic instead of resurrecting profile-backed guidance", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      contributorTier: "established",
      contributorOptedOut: true,
    });

    expect(result.prompt).toContain("Contributor-experience contract: generic-opt-out.");
    expect(result.prompt).toContain(
      "Contributor-specific guidance is disabled by opt-out for the PR author (octocat).",
    );
    expect(result.prompt).not.toContain("first-time or new contributor");
    expect(result.prompt).not.toContain("developing contributor with growing familiarity");
    expect(result.prompt).not.toContain("established contributor.");
    expect(result.prompt).not.toContain("core/senior contributor of this repository.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: generic-opt-out (contributor-specific guidance disabled by opt-out)",
    );
  });

  test("degraded search enrichment falls back to a generic degraded contract instead of legacy regular wording", async () => {
    const result = await runProfileScenario({
      additions: 90,
      deletions: 20,
      authorAssociation: "NONE",
      searchError: {
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
      },
    });

    expect(result.prompt).toContain("## Search API Degradation Context");
    expect(result.prompt).toContain("Contributor-experience contract: generic-degraded.");
    expect(result.prompt).toContain(
      "Fallback contributor signals are unavailable for the PR author (octocat) (search-api-rate-limit).",
    );
    expect(result.prompt).not.toContain("developing contributor with growing familiarity");
    expect(result.prompt).not.toContain("established contributor.");
    expect(result.detailsCommentBody).toContain(
      "- Contributor experience: generic-degraded (fallback signals unavailable: search-api-rate-limit)",
    );
  });

  test("logs stored-profile trust diagnostics when an untrusted linked row is bypassed", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    await Bun.write(
      `${workspaceFixture.dir}/.kodiai.yml`,
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n",
    );

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        search: {
          issuesAndPullRequests: async () => ({
            data: { total_count: 4 },
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
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-stored-profile-log",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      contributorProfileStore: {
        getByGithubUsername: async () =>
          buildContributorProfileFixture({
            overallTier: "newcomer",
            overallScore: 0,
            lastScoredAt: null,
            trustMarker: null,
          }),
        getExpertise: async () => [],
      } as never,
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Stored profile observability scenario",
          body: "",
          commits: 0,
          additions: 90,
          deletions: 20,
          user: { login: "octocat" },
          author_association: "NONE",
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

    const resolvedLog = entries.find((entry) =>
      entry.message === "Author experience classification resolved"
    );
    expect(resolvedLog).toBeDefined();
    expect(resolvedLog?.data?.storedProfileTrustState).toBe("linked-unscored");
    expect(resolvedLog?.data?.storedProfileTrustReason).toBe("never-scored");
    expect(resolvedLog?.data?.storedProfileCalibrationMarker).toBe(null);
    expect(resolvedLog?.data?.storedProfileCalibrationVersion).toBe(null);
    expect(resolvedLog?.data?.storedProfileFallbackPath).toBe(
      "stored-profile-linked-unscored->github-search",
    );
    expect(resolvedLog?.data?.contributorExperienceState).toBe("coarse-fallback");
    expect(resolvedLog?.data?.contributorExperienceSource).toBe("github-search");
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

describe("createReviewHandler open-event reviewer requests", () => {
  test("does not auto-request extra reviewers on opened", async () => {
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

    expect(requestedTeams).toBeUndefined();

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

  test("clean approval keeps Review Details inline in the canonical approval review body without creating an issue comment", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });
    const { logger } = createCaptureLogger();

    const createdReviews: Array<{ body?: string | null }> = [];
    const createdIssueComments: string[] = [];
    let executeCount = 0;
    let approveCount = 0;
    let updatedReviewId: number | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            return { data: { id: createdReviews.length } };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createdIssueComments.push(params.body);
            return { data: { id: createdIssueComments.length } };
          },
          updateComment: async () => ({ data: {} }),
        },
      },
      request: async (
        _route: string,
        params: { review_id: number; body: string },
      ) => {
        updatedReviewId = params.review_id;
        const review = createdReviews[params.review_id - 1];
        if (review) {
          review.body = params.body;
        }
        return { data: {} };
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
          executeCount++;
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-clean",
            executorPhaseTimings: [
              { name: "executor handoff", status: "completed", durationMs: 50 },
              { name: "remote runtime", status: "completed", durationMs: 500 },
            ],
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

    await workspaceFixture.cleanup();

    expect(executeCount).toBe(1);
    expect(approveCount).toBe(1);
    expect(updatedReviewId).toBe(1);

    const expectedReviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const marker = buildReviewOutputMarker(expectedReviewOutputKey);

    const approvalBody = createdReviews[0]?.body ?? "";
    expect(approvalBody).toContain("Decision: APPROVE");
    expect(approvalBody).toContain("Issues: none");
    expect(approvalBody).toContain("Evidence:");
    expect(approvalBody).toContain("- Review prompt covered 1 changed file.");
    expect(approvalBody).toContain("<summary>Review Details</summary>");
    expect(approvalBody).not.toContain("Merge Confidence:");
    expect(extractReviewOutputKey(approvalBody)).toBe(expectedReviewOutputKey);
    expect(approvalBody).toContain(marker);

    const reviewDetailsBlock = extractReviewDetailsBlock(approvalBody);
    expect(reviewDetailsBlock).toContain("<summary>Review Details</summary>");
    expect(reviewDetailsBlock).toContain("- Total wall-clock:");
    expect(reviewDetailsBlock).toContain("- Phase timings:");
    expect(reviewDetailsBlock).toContain("executor handoff: 50ms");
    expect(reviewDetailsBlock).toContain("remote runtime: 500ms");
    expect(reviewDetailsBlock).toContain("publication:");
    expect(extractReviewOutputKey(reviewDetailsBlock)).toBe(expectedReviewOutputKey);
    expect(approvalBody.match(/<summary>Review Details<\/summary>/g) ?? []).toHaveLength(1);
    expect(approvalBody.match(/<!--\s*kodiai:review-details:[^>]+-->/g) ?? []).toHaveLength(1);
    expect(approvalBody.match(/<details>/g) ?? []).toHaveLength(
      (approvalBody.match(/<\/details>/g) ?? []).length,
    );

    expect(createdIssueComments).toHaveLength(0);
  });

  test("clean review posts approval-shaped issue comment when autoApprove is disabled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: false });

    const createdReviews: Array<{ body?: string | null }> = [];
    const createdIssueComments: string[] = [];
    let executeCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listReviews: async () => ({ data: createdReviews.map((review, index) => ({ id: index + 1, body: review.body ?? null })) }),
          createReview: async ({ body }: { body?: string }) => {
            createdReviews.push({ body: body ?? null });
            return { data: { id: createdReviews.length } };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createdIssueComments.push(params.body);
            return { data: { id: createdIssueComments.length, body: params.body } };
          },
          updateComment: async () => ({ data: {} }),
        },
      },
      request: async () => ({ data: {} }),
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
          executeCount++;
          return {
            conclusion: "success",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-clean-comment-only",
            promptSections: [
              {
                deliveryId: "delivery-123",
                repo: "acme/repo",
                taskType: "review",
                promptKind: "review.user-prompt",
                sections: [
                  {
                    sectionName: "review-change-context",
                    sectionPosition: 0,
                    charCount: 40,
                    estimatedTokens: 10,
                    budgetChars: 20,
                    budgetTokens: 5,
                    includedChars: 20,
                    includedTokens: 5,
                    trimmedChars: 20,
                    trimmedTokens: 5,
                    budgetStatus: "trimmed",
                    budgetReason: "section-over-budget",
                  },
                ],
              },
            ],
            executorPhaseTimings: [
              { name: "executor handoff", status: "completed", durationMs: 50 },
              { name: "remote runtime", status: "completed", durationMs: 500 },
            ],
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }));

    await workspaceFixture.cleanup();

    expect(executeCount).toBe(1);
    expect(createdReviews).toHaveLength(0);
    expect(createdIssueComments).toHaveLength(1);
    expect(createdIssueComments[0]).toContain("Decision: APPROVE");
    expect(createdIssueComments[0]).toContain("Issues: none");
    expect(createdIssueComments[0]).toContain("Review scope note: output was scoped by prompt budget limits; Review Details include bounded counts only.");
    expect(createdIssueComments[0]).toContain("Budget behavior: scoped (prompt-budget-limited).");
    expect(createdIssueComments[0]).toContain("<summary>Review Details</summary>");
    expect(createdIssueComments[0]).toContain(buildReviewOutputMarker(buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    })));
  });

  test("published approval review receives Review Details instead of creating a separate issue comment", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });

    let issueCommentCreateCount = 0;
    let updatedReviewId: number | undefined;
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
    const existingApprovalReview = {
      id: 777,
      body: `<details>\n<summary>kodiai response</summary>\n\nDecision: APPROVE\nIssues: none\n\nEvidence:\n- Agent-published clean approval.\n\n</details>\n\n${marker}`,
    };

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listReviews: async () => ({ data: [existingApprovalReview] }),
          createReview: async () => {
            throw new Error("auto-approval should skip when the executor already published output");
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            issueCommentCreateCount += 1;
            return { data: { id: 1 } };
          },
          updateComment: async () => ({ data: {} }),
        },
      },
      request: async (
        route: string,
        params: { review_id: number; body: string },
      ) => {
        expect(route).toBe("PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}");
        updatedReviewId = params.review_id;
        existingApprovalReview.body = params.body;
        return { data: {} };
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-published-approval-details",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
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

    await workspaceFixture.cleanup();

    expect(updatedReviewId).toBe(777);
    expect(issueCommentCreateCount).toBe(0);
    expect(existingApprovalReview.body).toContain("Decision: APPROVE");
    expect(existingApprovalReview.body).toContain("<summary>Review Details</summary>");
    expect(existingApprovalReview.body).toContain("publication:");
  });

  test("auto-approval finalization refreshes the same canonical approval review id when older marker-matching reviews exist", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });

    let approveCount = 0;
    let issueCommentCreateCount = 0;
    let issueCommentUpdateCount = 0;
    let updatedReviewId: number | undefined;
    const createdIssueComments: Array<{ id: number; body: string }> = [];
    const createdReviews: Array<{ id: number; body?: string | null }> = [];

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

    const issueCommentBodiesByCall = [
      [],
      [],
    ] as const;
    let listReviewsCallCount = 0;
    let listCommentsCallCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listReviews: async () => {
            listReviewsCallCount += 1;
            const data = approveCount === 0
              ? []
              : [
                { id: 902, body: `older pull review\n\n${marker}` },
                { id: 951, body: `canonical approval review\n\n${marker}` },
              ];
            return { data };
          },
          listCommits: async () => ({ data: [] }),
          createReview: async ({ body }: { body?: string }) => {
            approveCount += 1;
            const review = { id: 950 + approveCount, body: body ?? null };
            createdReviews.push(review);
            return { data: { id: review.id } };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => {
            const data = issueCommentBodiesByCall[listCommentsCallCount] ?? [];
            listCommentsCallCount += 1;
            return { data };
          },
          createComment: async (params: { body: string }) => {
            issueCommentCreateCount += 1;
            const comment = { id: 901, body: params.body };
            createdIssueComments.push(comment);
            return { data: comment };
          },
          updateComment: async ({ comment_id }: { comment_id: number; body: string }) => {
            issueCommentUpdateCount += 1;
            return { data: { id: comment_id } };
          },
        },
      },
      request: async (
        route: string,
        params: { review_id: number; body: string },
      ) => {
        expect(route).toBe("PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}");
        updatedReviewId = params.review_id;
        const existingReview = createdReviews.find((review) => review.id === params.review_id);
        if (existingReview) {
          existingReview.body = params.body;
        }
        return { data: {} };
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
          sessionId: "session-mixed-surface-finalization",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
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

    await workspaceFixture.cleanup();

    expect(approveCount).toBe(1);
    expect(updatedReviewId).toBe(950 + approveCount);
    expect(issueCommentCreateCount).toBe(0);
    expect(issueCommentUpdateCount).toBe(0);
    expect(createdReviews).toHaveLength(1);
    expect(createdReviews[0]?.body).toContain("Decision: APPROVE");
    expect(createdReviews[0]?.body).toContain("<summary>Review Details</summary>");
    expect(createdReviews[0]?.body).toContain("publication:");
    expect(createdReviews[0]?.body?.match(/<!--\s*kodiai:review-details:[^>]+-->/g) ?? []).toHaveLength(1);
    expect(createdIssueComments).toHaveLength(0);
  });

  test("published-output finalization updates only the canonical issue comment when mixed surfaces exist after an issue-comment idempotency accept", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: false });

    let issueCommentUpdateCount = 0;
    const issueCommentUpdateIds: number[] = [];
    let createReviewCount = 0;
    let updateReviewCount = 0;

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

    const issueCommentBodiesByCall = [
      [{ id: 901, body: `existing issue comment\n\n${marker}` }],
      [{ id: 901, body: `existing issue comment\n\n${marker}` }],
      [
        { id: 900, body: `older issue comment\n\n${marker}` },
        { id: 901, body: `existing issue comment\n\n${marker}` },
      ],
    ] as const;
    const reviewBodiesByCall = [
      [{ id: 902, body: `existing pull review\n\n${marker}` }],
    ] as const;
    let listCommentsCallCount = 0;
    let listReviewsCallCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listReviews: async () => {
            const data = reviewBodiesByCall[listReviewsCallCount] ?? [];
            listReviewsCallCount += 1;
            return { data };
          },
          listCommits: async () => ({ data: [] }),
          createReview: async () => {
            createReviewCount += 1;
            return { data: { id: 950 } };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => {
            const data = issueCommentBodiesByCall[listCommentsCallCount] ?? [];
            listCommentsCallCount += 1;
            return { data };
          },
          createComment: async (params: { body: string }) => ({ data: { id: 901, body: params.body } }),
          updateComment: async ({ comment_id, body }: { comment_id: number; body: string }) => {
            issueCommentUpdateCount += 1;
            issueCommentUpdateIds.push(comment_id);
            expect(body).toContain("<summary>Review Details</summary>");
            return { data: { id: comment_id, body } };
          },
        },
      },
      request: async () => {
        updateReviewCount += 1;
        return { data: {} };
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-issue-comment-mixed-surface-finalization",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
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

    await workspaceFixture.cleanup();

    expect(issueCommentUpdateIds).toEqual([901, 901]);
    expect(issueCommentUpdateCount).toBe(2);
    expect(createReviewCount).toBe(0);
    expect(updateReviewCount).toBe(0);
    expect(listReviewsCallCount).toBe(0);
  });

  test("auto-approve includes dep-bump merge confidence inside the shared approval body", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });

    await Bun.write(
      join(workspaceFixture.dir, "package.json"),
      JSON.stringify({
        name: "review-fixture",
        private: true,
        dependencies: { lodash: "4.17.21" },
      }, null, 2),
    );
    await $`git -C ${workspaceFixture.dir} add package.json`.quiet();
    await $`git -C ${workspaceFixture.dir} commit -m "add dependency bump fixture"`.quiet();

    let approveCount = 0;
    const createdReviews: Array<{ id: number; body?: string }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response("Not Found", { status: 404 })) as unknown as typeof globalThis.fetch;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            data: createdReviews.map((review) => ({ id: review.id, body: review.body ?? "" })),
          }),
          listCommits: async () => ({ data: [] }),
          createReview: async ({ body }: { body?: string }) => {
            approveCount++;
            const id = 700 + approveCount;
            createdReviews.push({ id, body });
            return { data: { id } };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
        securityAdvisories: {
          listGlobalAdvisories: async () => ({ data: [] }),
        },
        repos: {
          listReleases: async () => ({ data: [] }),
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
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-dep-bump-approve",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    try {
      await handler!(
        buildReviewRequestedEvent({
          requested_reviewer: { login: "kodiai[bot]" },
          pull_request: {
            number: 101,
            draft: false,
            title: "Bump lodash from 4.17.20 to 4.17.21",
            body: "",
            commits: 0,
            additions: 20,
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
    } finally {
      globalThis.fetch = previousFetch;
      await workspaceFixture.cleanup();
    }

    expect(approveCount).toBe(1);
    expect(createdReviews[0]?.body ?? "").toContain("Decision: APPROVE");
    expect(createdReviews[0]?.body ?? "").toContain("Issues: none");
    expect(createdReviews[0]?.body ?? "").toContain("Evidence:");
    expect(createdReviews[0]?.body ?? "").toContain("- Review prompt covered 2 changed files.");
    expect(createdReviews[0]?.body ?? "").toContain("Merge Confidence: High");
    expect(extractReviewOutputKey(createdReviews[0]?.body)).toBe(
      buildReviewOutputKey({
        installationId: 42,
        owner: "acme",
        repo: "repo",
        prNumber: 101,
        action: "review_requested",
        deliveryId: "delivery-123",
        headSha: "abcdef1234567890",
      }),
    );
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

  test("suppresses auto-approval when publish rights were superseded by newer same-PR review work", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({ autoApprove: true });
    const { logger, entries } = createCaptureLogger();

    let approveCount = 0;
    const claimedFamilies: Array<Record<string, unknown>> = [];
    const completedAttemptIds: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-superseded-auto-approval",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => {
          claimedFamilies.push(claim);
          return {
            attemptId: "attempt-auto-1",
            familyKey: claim.familyKey,
            source: claim.source,
            lane: claim.lane,
            deliveryId: claim.deliveryId,
            phase: claim.phase,
            claimedAtMs: 100,
            lastProgressAtMs: 100,
          };
        },
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
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
    expect(claimedFamilies).toEqual([
      {
        familyKey: "acme/repo#101",
        source: "automatic-review",
        lane: "review",
        deliveryId: "delivery-123",
        phase: "claimed",
      },
    ]);
    expect(completedAttemptIds).toEqual(["attempt-auto-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping auto-approval because publish rights were superseded"),
    ).toBeTrue();
  });

  test("publishes [depends] deep-review output when publish rights remain uncontested", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger } = createCaptureLogger();

    let summaryCommentCount = 0;
    let inlineReviewCount = 0;
    let executorCalls = 0;
    const completedAttemptIds: string[] = [];
    const releasedAttemptIds: string[] = [];
    const phaseTransitions: string[] = [];
    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 9_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: Parameters<typeof coordinator.canPublish>[0]) => coordinator.canPublish(attemptId),
      setPhase: (
        attemptId: Parameters<typeof coordinator.setPhase>[0],
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => {
        phaseTransitions.push(phase);
        return coordinator.setPhase(attemptId, phase);
      },
      getSnapshot: (familyKey: Parameters<typeof coordinator.getSnapshot>[0]) => coordinator.getSnapshot(familyKey),
      release: (attemptId: Parameters<typeof coordinator.release>[0]) => {
        releasedAttemptIds.push(attemptId);
        coordinator.release(attemptId);
      },
      complete: (attemptId: Parameters<typeof coordinator.complete>[0]) => {
        completedAttemptIds.push(attemptId);
        coordinator.complete(attemptId);
      },
    };

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listFiles: async () => ({
            data: [
              {
                filename: "tools/depends/target/zlib/VERSION",
                status: "modified",
                patch: [
                  "@@ -1,2 +1,2 @@",
                  "-VERSION=1.3.1",
                  "+VERSION=1.3.2",
                ].join("\n"),
              },
              {
                filename: "tools/depends/target/zlib/patches/fix-build.patch",
                status: "removed",
              },
            ],
          }),
          createReview: async () => {
            inlineReviewCount += 1;
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            summaryCommentCount += 1;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        repos: {
          listReleases: async () => ({ data: [] }),
          getContent: async () => {
            throw new Error("cmake modules unavailable in test fixture");
          },
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
          executorCalls += 1;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-should-not-run-for-depends",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "[depends] Bump zlib to 1.3.2",
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
      }),
    );

    await workspaceFixture.cleanup();

    expect(summaryCommentCount).toBe(1);
    expect(inlineReviewCount).toBe(1);
    expect(executorCalls).toBe(0);
    expect(phaseTransitions).toEqual(expect.arrayContaining([
      "workspace-create",
      "load-config",
      "incremental-diff",
      "publish",
    ]));
    expect(completedAttemptIds).toHaveLength(1);
    expect(releasedAttemptIds).toEqual([]);
    expect(coordinator.getSnapshot(buildReviewFamilyKey("acme", "repo", 101))).toBeNull();
  });

  test("suppresses [depends] deep-review publication when publish rights were superseded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    let summaryCommentCount = 0;
    let inlineReviewCount = 0;
    let executorCalls = 0;
    const completedAttemptIds: string[] = [];
    const releasedAttemptIds: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listFiles: async () => ({
            data: [
              {
                filename: "tools/depends/target/zlib/VERSION",
                status: "modified",
                patch: [
                  "@@ -1,2 +1,2 @@",
                  "-VERSION=1.3.1",
                  "+VERSION=1.3.2",
                ].join("\n"),
              },
              {
                filename: "tools/depends/target/zlib/patches/fix-build.patch",
                status: "removed",
              },
            ],
          }),
          createReview: async () => {
            inlineReviewCount += 1;
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            summaryCommentCount += 1;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        repos: {
          listReleases: async () => ({ data: [] }),
          getContent: async () => {
            throw new Error("cmake modules unavailable in test fixture");
          },
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
          executorCalls += 1;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-should-not-run-for-depends",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-depends-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: (attemptId: string) => {
          releasedAttemptIds.push(attemptId);
        },
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "[depends] Bump zlib to 1.3.2",
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
      }),
    );

    await workspaceFixture.cleanup();

    expect(summaryCommentCount).toBe(0);
    expect(inlineReviewCount).toBe(0);
    expect(executorCalls).toBe(0);
    expect(completedAttemptIds).toEqual(["attempt-depends-1"]);
    expect(releasedAttemptIds).toEqual([]);
    expect(
      entries.some((entry) => entry.message === "Skipping [depends] deep review summary comment because publish rights were superseded"),
    ).toBeTrue();
    expect(
      entries.some((entry) => entry.message === "Skipping [depends] deep review inline comments because publish rights were superseded"),
    ).toBeTrue();
  });
});

describe("createReviewHandler fork PR workspace strategy", () => {
  test("fork PRs clone base branch and fetch pull/<n>/head instead of cloning the fork", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const createCalls: CloneOptions[] = [];
    const baseFetchCalls: Parameters<typeof fetchRemoteTrackingBranch>[0][] = [];

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      fetchRemoteTrackingBranchFn: async (options) => {
        baseFetchCalls.push(options);
        await fetchRemoteTrackingBranch(options);
      },
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
    expect(createCalls[0]?.depth).toBe(REVIEW_WORKSPACE_FETCH_DEPTH);

    expect(baseFetchCalls).toHaveLength(1);
    expect(baseFetchCalls[0]?.branch).toBe("main");
    expect(baseFetchCalls[0]?.depth).toBe(REVIEW_WORKSPACE_FETCH_DEPTH);

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      `review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths:\n${skipPathsYaml}\n`,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      `review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n${telemetrySection}`,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: false\n",
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n",
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: true\n  costWarningUsd: 1.0\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    const commentBodies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            commentBodies.push(params.body);
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
    const costWarningBody = commentBodies.find((body) => body.includes("cost warning"));
    expect(costWarningBody).toBeDefined();
    expect(costWarningBody!).toContain("cost warning");
    expect(costWarningBody!).toContain("$2.5000");
    expect(costWarningBody!).toContain("$1.00");
  });

  test("suppresses cost warning comment when publish rights were superseded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-review-handler-"));
    const { logger, entries } = createCaptureLogger();
    const completedAttemptIds: string[] = [];

    await $`git -C ${dir} init --initial-branch=main`.quiet();
    await $`git -C ${dir} config user.email test@example.com`.quiet();
    await $`git -C ${dir} config user.name "Test User"`.quiet();

    await Bun.write(join(dir, "README.md"), "base\n");
    await Bun.write(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: true\n  costWarningUsd: 1.0\n",
    );

    await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
    await $`git -C ${dir} commit -m "base"`.quiet();
    await $`git -C ${dir} checkout -b feature`.quiet();
    await Bun.write(join(dir, "README.md"), "base\nfeature\n");
    await $`git -C ${dir} add README.md`.quiet();
    await $`git -C ${dir} commit -m "feature"`.quiet();
    await $`git -C ${dir} remote add origin ${dir}`.quiet();

    let createCommentCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          createComment: async () => {
            createCommentCalls += 1;
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
          sessionId: "session-cost-warning-superseded",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-cost-warning-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    await rm(dir, { recursive: true, force: true });
    expect(createCommentCalls).toBe(0);
    expect(completedAttemptIds).toEqual(["attempt-cost-warning-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping cost warning comment because publish rights were superseded"),
    ).toBeTrue();
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
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n",
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: false\n  costWarningUsd: 1.0\n",
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
  test("keeps base branch fetch depth aligned with PR workspace depth", () => {
    expect(REVIEW_WORKSPACE_FETCH_DEPTH).toBe(50);
  });

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

    const diffCollectionLog = entries.find((entry) =>
      entry.message === "Collected diff context for review"
    );
    expect(diffCollectionLog).toBeDefined();
    expect(diffCollectionLog?.data?.strategy).toBe("fallback-two-dot");

    await workspaceFixture.cleanup();
  });

  test("uses a production-safe default timeout for merge-base recovery fetches", async () => {
    const workspaceFixture = await createNoMergeBaseFixture({ includePhase27Fields: true });
    const { logger } = createCaptureLogger();
    const observedTimeouts: number[] = [];

    try {
      await collectDiffContext({
        workspaceDir: workspaceFixture.dir,
        baseRef: "main",
        maxFilesForFullDiff: 200,
        logger,
        baseLog: { deliveryId: "delivery-123", prNumber: 101 },
        runGitCommand: async (_args, timeoutMs) => {
          observedTimeouts.push(timeoutMs);
          return {
            exitCode: 124,
            stdout: "",
            stderr: "timed out",
            timedOut: true,
          };
        },
        fallbackFileProvider: async () => ["src/api/phase27-uat-example.ts"],
      });

      expect(observedTimeouts.at(0)).toBe(30_000);
    } finally {
      await workspaceFixture.cleanup();
    }
  });

  test("degrades to GitHub file list when merge-base recovery times out", async () => {
    const workspaceFixture = await createNoMergeBaseFixture({ includePhase27Fields: true });
    const { logger, entries } = createCaptureLogger();

    try {
      const result = await collectDiffContext({
        workspaceDir: workspaceFixture.dir,
        baseRef: "main",
        maxFilesForFullDiff: 200,
        logger,
        baseLog: { deliveryId: "delivery-123", prNumber: 101 },
        runGitCommand: async () => ({
          exitCode: 124,
          stdout: "",
          stderr: "timed out",
          timedOut: true,
        }),
        fallbackFileProvider: async () => [
          "src/api/phase27-uat-example.ts",
          "docs/phase27-note.md",
        ],
      });

      expect(result.strategy).toBe("github-file-list-fallback");
      expect(result.changedFiles).toEqual([
        "src/api/phase27-uat-example.ts",
        "docs/phase27-note.md",
      ]);
      expect(result.numstatLines).toEqual([]);
      expect(result.diffContent).toBeUndefined();

      const fallbackLog = entries.find((entry) =>
        entry.message === "Diff collection degraded to GitHub file-list fallback"
      );
      expect(fallbackLog).toBeDefined();
      expect(fallbackLog?.data?.stage).toBe("merge-base-recovery");
      expect(fallbackLog?.data?.strategy).toBe("github-file-list-fallback");
    } finally {
      await workspaceFixture.cleanup();
    }
  });

  test("uses GitHub file list when triple-dot and two-dot name-only diffs both fail", async () => {
    const workspaceFixture = await createWorkspaceFixture();
    await $`git -C ${workspaceFixture.dir} update-ref refs/remotes/origin/main main`.quiet();
    const { logger, entries } = createCaptureLogger();
    const commands: string[] = [];

    try {
      const result = await collectDiffContext({
        workspaceDir: workspaceFixture.dir,
        baseRef: "main",
        maxFilesForFullDiff: 200,
        logger,
        baseLog: { deliveryId: "delivery-123", prNumber: 101 },
        runGitCommand: async (args) => {
          commands.push(args.join(" "));
          if (args.join(" ") === "diff origin/main...HEAD --name-only") {
            return { exitCode: 128, stdout: "", stderr: "no merge base", timedOut: false };
          }
          if (args.join(" ") === "diff origin/main..HEAD --name-only") {
            return { exitCode: 128, stdout: "", stderr: "bad revision", timedOut: false };
          }
          throw new Error(`unexpected git command: ${args.join(" ")}`);
        },
        fallbackFileProvider: async () => ["README.md"],
      });

      expect(commands).toContain("diff origin/main...HEAD --name-only");
      expect(commands).toContain("diff origin/main..HEAD --name-only");
      expect(result.strategy).toBe("github-file-list-fallback");
      expect(result.changedFiles).toEqual(["README.md"]);

      const fallbackLog = entries.find((entry) =>
        entry.message === "Diff collection degraded to GitHub file-list fallback"
      );
      expect(fallbackLog?.data?.stage).toBe("name-only");
      expect(fallbackLog?.data?.reason).toBe("diff-failed-origin/main..HEAD-name-only");
    } finally {
      await workspaceFixture.cleanup();
    }
  });

  test("uses GitHub PR file metadata when merge-base recovery times out", async () => {
    const workspaceFixture = await createNoMergeBaseFixture({ includePhase27Fields: true });
    const { logger } = createCaptureLogger();

    try {
      const result = await collectDiffContext({
        workspaceDir: workspaceFixture.dir,
        baseRef: "main",
        maxFilesForFullDiff: 200,
        logger,
        baseLog: { deliveryId: "delivery-123", prNumber: 101 },
        runGitCommand: async () => ({
          exitCode: 124,
          stdout: "",
          stderr: "timed out",
          timedOut: true,
        }),
        fallbackDiffProvider: async () => [
          {
            filename: "src/api/phase27-uat-example.ts",
            status: "renamed",
            previousFilename: "src/api/old-phase27-uat-example.ts",
            additions: 7,
            deletions: 2,
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
          {
            filename: "docs/phase27-note.md",
            status: "added",
            additions: 1,
            deletions: 0,
          },
        ],
      });

      expect(result.strategy).toBe("github-pr-files-fallback");
      expect(result.changedFiles).toEqual([
        "src/api/phase27-uat-example.ts",
        "docs/phase27-note.md",
      ]);
      expect(result.numstatLines).toEqual([
        "7\t2\tsrc/api/phase27-uat-example.ts",
        "1\t0\tdocs/phase27-note.md",
      ]);
      expect(result.diffContent).toContain("diff --git a/src/api/old-phase27-uat-example.ts b/src/api/phase27-uat-example.ts");
      expect(result.diffContent).toContain("--- a/src/api/old-phase27-uat-example.ts");
      expect(result.diffContent).toContain("+++ b/src/api/phase27-uat-example.ts");
      expect(result.diffContent).toContain("@@ -1 +1 @@");
    } finally {
      await workspaceFixture.cleanup();
    }
  });

  test("continues review flow when diff collection degrades to file-list fallback", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let executeCount = 0;
    let capturedPrompt = "";

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            sessionId: "session-diff-fallback",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      diffContextCollector: async () => ({
        changedFiles: ["README.md"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 1,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    try {
      await handler!(
        buildReviewRequestedEvent({
          requested_reviewer: { login: "kodiai[bot]" },
        }),
      );

      expect(executeCount).toBe(1);
      expect(capturedPrompt).toContain("README.md");
    } finally {
      await workspaceFixture.cleanup();
    }
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
    const { logger, entries } = createCaptureLogger();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      logger,
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
    expect(detailsCommentBody).toContain(`<!-- kodiai:review-details:${reviewOutputKey} -->`);
    expect((detailsCommentBody?.match(/Review finding lifecycle:/g) ?? [])).toHaveLength(1);
    expect(detailsCommentBody).toContain("Review finding lifecycle: status=normalized");
    expect(detailsCommentBody).toContain("correlation=repo:y,pull:y,reviewOutputKey:y,deliveryId:y,commit:y");
    expect(detailsCommentBody).toContain("redaction=privateOnly:y,rawPrompts:n,rawModelOutput:n,candidateBodies:n,toolPayloads:n,secretLike:n,diffs:n,unboundedArrays:n");
    expect(detailsCommentBody).not.toContain("RAW_PROMPT_CANARY");
    expect(detailsCommentBody).not.toContain("RAW_MODEL_OUTPUT_CANARY");
    expect(detailsCommentBody).not.toContain("CANDIDATE_BODY_CANARY");
    expect(detailsCommentBody).not.toContain("TOOL_PAYLOAD_CANARY");
    expect(detailsCommentBody).not.toContain("diff --git");

    const lifecycleLog = entries.find((entry) => entry.data?.gate === "review-finding-lifecycle");
    expect(lifecycleLog?.data).toMatchObject({
      reviewOutputKey,
      deliveryId: "delivery-123",
      source: "automatic-review",
      trigger: "pull_request",
      normalizedStatus: "normalized",
    });
    expect(lifecycleLog?.data?.counts).toMatchObject({ input: 3, recorded: 3, rejected: 0 });
    expect(lifecycleLog?.data?.redaction).toMatchObject({
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      diffsIncluded: false,
    });
    expect(JSON.stringify(lifecycleLog?.data)).not.toContain("RAW_PROMPT_CANARY");
    expect(JSON.stringify(lifecycleLog?.data)).not.toContain("diff --git");
    expect(detailsCommentBody).not.toContain("Lines analyzed:");
    expect(detailsCommentBody).not.toContain("Suppressions applied:");
    expect(detailsCommentBody).not.toContain("Estimated review time saved:");
    expect(detailsCommentBody).not.toContain("Low Confidence Findings");

    await workspaceFixture.cleanup();
  });

  test("skips destructive inline deletion when the injected review reducer throws", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

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
    let exposeInlineFinding = false;
    const deletedCommentIds: number[] = [];
    const recordedFindings: Array<Record<string, unknown>> = [];
    let detailsCommentBody: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir: workspaceFixture.dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: exposeInlineFinding
              ? [
                  {
                    id: 71,
                    body: [`[MINOR] Finding that would be filtered`, "Details.", "", marker].join("\n"),
                    path: "README.md",
                    line: 2,
                    start_line: 2,
                  },
                ]
              : [],
          }),
          deleteReviewComment: async (params: { comment_id: number }) => {
            deletedCommentIds.push(params.comment_id);
            return { data: {} };
          },
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            detailsCommentBody = params.body;
            return { data: { id: 901 } };
          },
          updateComment: async () => ({ data: {} }),
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
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-reducer-throw",
            inputTokens: 0,
            outputTokens: 0,
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        recordReview: async () => 123,
        recordFindings: async (findings: Record<string, unknown>[]) => {
          recordedFindings.push(...findings);
        },
      }) as never,
      reviewReducer: async () => {
        throw new Error("malformed reducer state");
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }));
    await workspaceFixture.cleanup();

    expect(recordedFindings).toHaveLength(1);
    expect(recordedFindings[0]?.title).toBe("Finding that would be filtered");
    expect(deletedCommentIds).toEqual([]);
    expect(detailsCommentBody).toContain("Review reducer: degraded");
    expect(detailsCommentBody).toContain("reason=reducer-exception");
  });

  test("review-comment idempotency accept still publishes Review Details when no canonical issue comment exists yet", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

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

    let exposeInlineFinding = false;
    let detailsCommentBody: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) =>
        fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            data: exposeInlineFinding
              ? [{ id: 41, body: `**Inline finding**\n\n${marker}`, path: "src/a.ts", line: 1, start_line: 1 }]
              : [],
          }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            detailsCommentBody = params.body;
            return { data: { id: 901 } };
          },
          updateComment: async () => ({ data: {} }),
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
        execute: async () => {
          exposeInlineFinding = true;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-review-comment-idempotency-accept",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "end_turn",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }));

    expect(detailsCommentBody).toContain("<summary>Review Details</summary>");

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) =>
        fn(
          createQueueRunMetadata({
            queuedAtMs: 1_000,
            startedAtMs: 900,
            waitMs: -100,
          }),
        ),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            executorPhaseTimings: [
              { name: "executor handoff", status: "completed", durationMs: 50 },
              { name: "remote runtime", status: "completed", durationMs: 500 },
            ],
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
    expect(detailsCommentBody).toContain("- Total wall-clock:");
    expect(detailsCommentBody).toContain("- Phase timings:");
    expect(detailsCommentBody).toContain("queue wait: unavailable");
    expect(detailsCommentBody).toContain("workspace preparation:");
    expect(detailsCommentBody).toContain("retrieval/context assembly:");
    expect(detailsCommentBody).toContain("executor handoff: 50ms");
    expect(detailsCommentBody).toContain("remote runtime: 500ms");
    expect(detailsCommentBody).toContain("publication:");
    expect(detailsCommentBody).toContain("degraded:");
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

  test("suppresses canonical Review Details merge when publish rights were superseded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    let updatedSummaryBody: string | undefined;
    let createCommentCalls = 0;
    let updateCommentCalls = 0;
    let issueCommentListCalls = 0;
    const completedAttemptIds: string[] = [];

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const summaryBody = [
      "<details>",
      "<summary>Review summary</summary>",
      "",
      "No inline findings were published.",
      "",
      "</details>",
      "",
      buildReviewOutputMarker(reviewOutputKey),
    ].join("\n");

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => {
            issueCommentListCalls += 1;
            return issueCommentListCalls === 1
              ? { data: [] }
              : { data: [{ id: 77, body: summaryBody }] };
          },
          createComment: async () => {
            createCommentCalls += 1;
            return { data: { id: 88 } };
          },
          updateComment: async (params: { body: string }) => {
            updateCommentCalls += 1;
            updatedSummaryBody = params.body;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-review-details-append-superseded",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-review-details-append-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(updatedSummaryBody).toBeUndefined();
    expect(createCommentCalls).toBe(0);
    expect(completedAttemptIds).toEqual(["attempt-review-details-append-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping canonical Review Details merge because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("suppresses standalone Review Details publication when publish rights were superseded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    let createCommentCalls = 0;
    let updateCommentCalls = 0;
    const completedAttemptIds: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          createComment: async () => {
            createCommentCalls += 1;
            return { data: { id: 188 } };
          },
          updateComment: async () => {
            updateCommentCalls += 1;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          sessionId: "session-review-details-standalone-superseded",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-review-details-standalone-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(createCommentCalls).toBe(0);
    expect(updateCommentCalls).toBe(0);
    expect(completedAttemptIds).toEqual(["attempt-review-details-standalone-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping clean review publication because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("rechecks canonical Review Details merge publish rights after summary lookup", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    let updatedSummaryBody: string | undefined;
    let createCommentCalls = 0;
    let issueCommentListCalls = 0;
    let allowPublish = true;
    const completedAttemptIds: string[] = [];

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const summaryBody = [
      "<details>",
      "<summary>Review summary</summary>",
      "",
      "No inline findings were published.",
      "",
      "</details>",
      "",
      buildReviewOutputMarker(reviewOutputKey),
    ].join("\n");

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => {
            issueCommentListCalls += 1;
            if (issueCommentListCalls === 2) {
              allowPublish = false;
            }
            return issueCommentListCalls === 1
              ? { data: [] }
              : { data: [{ id: 77, body: summaryBody }] };
          },
          createComment: async () => {
            createCommentCalls += 1;
            return { data: { id: 88 } };
          },
          updateComment: async (params: { body: string }) => {
            updatedSummaryBody = params.body;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-review-details-append-recheck",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-review-details-append-recheck-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => allowPublish,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(issueCommentListCalls).toBeGreaterThanOrEqual(2);
    expect(updatedSummaryBody).toBeUndefined();
    expect(createCommentCalls).toBe(0);
    expect(completedAttemptIds).toEqual(["attempt-review-details-append-recheck-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping canonical Review Details merge because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("rechecks standalone Review Details publish rights after comment lookup", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    let createCommentCalls = 0;
    let updateCommentCalls = 0;
    let listCommentsCalls = 0;
    let allowPublish = true;
    const completedAttemptIds: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => {
            listCommentsCalls += 1;
            allowPublish = false;
            return { data: [] };
          },
          createComment: async () => {
            createCommentCalls += 1;
            return { data: { id: 188 } };
          },
          updateComment: async () => {
            updateCommentCalls += 1;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          sessionId: "session-review-details-standalone-recheck",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-review-details-standalone-recheck-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => allowPublish,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(listCommentsCalls).toBeGreaterThanOrEqual(1);
    expect(createCommentCalls).toBe(0);
    expect(updateCommentCalls).toBe(0);
    expect(completedAttemptIds).toEqual(["attempt-review-details-standalone-recheck-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping clean review publication because publish rights were superseded"),
    ).toBeTrue();

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
    let generateCallCount = 0;

    const embeddingProvider = {
      model: "test",
      dimensions: 1,
      generate: async (query: string) => {
        embedCalls.push(query);
        generateCallCount += 1;
        const variantId = query.includes("files:")
          ? 2
          : generateCallCount === 1
            ? 1
            : 3;
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

    expect(embedCalls).toHaveLength(2);
    expect(embedCalls.some((query) => query.includes("files:"))).toBe(true);
    expect(retrieveCalls).toHaveLength(2);
    expect(maxInFlightEmbeds).toBeLessThanOrEqual(2);

    const sharedIdx = capturedPrompt.indexOf("shared bug");
    const intentOnlyIdx = capturedPrompt.indexOf("intent-only bug");
    const shapeOnlyIdx = capturedPrompt.indexOf("shape-only bug");
    expect(sharedIdx).toBeGreaterThan(-1);
    expect(intentOnlyIdx).toBeGreaterThan(-1);
    expect(shapeOnlyIdx).toBe(-1);

    await workspaceFixture.cleanup();
  });

  test("keeps review execution fail-open when one retrieval variant errors", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let capturedPrompt = "";
    let successfulEmbedCount = 0;
    const embeddingProvider = {
      model: "test",
      dimensions: 1,
      generate: async (query: string) => {
        if (query.includes("files:")) {
          throw new Error("file-path variant failed");
        }
        successfulEmbedCount += 1;
        return {
            embedding: new Float32Array([successfulEmbedCount]),
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
    expect(capturedPrompt).not.toContain("shape variant finding");

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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

    expect(result.detailsCommentBody).toContain("Comment cap saturated: published 1/2 prioritized findings; 1 lower-priority finding omitted from inline publication");
    expect(result.detailsCommentBody).toContain("Prioritization: scored 2 findings");
    expect(result.detailsCommentBody).toContain("top score");
    expect(result.detailsCommentBody).toContain("threshold score");
  });
});

describe("createReviewHandler usageLimit and token wiring", () => {
  test("Review Details includes usage percentage and token counts when executor returns usageLimit", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let detailsCommentBody: string | undefined;

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        execute: async () => ({
          conclusion: "success",
          published: true,
          costUsd: 0.0042,
          inputTokens: 2000,
          outputTokens: 1000,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-usage-wiring",
          promptSections: [
            {
              deliveryId: "delivery-123",
              repo: "acme/repo",
              taskType: "review",
              promptKind: "review.user-prompt",
              sections: [
                {
                  sectionName: "review-change-context",
                  sectionPosition: 0,
                  charCount: 40,
                  estimatedTokens: 10,
                  budgetChars: 20,
                  budgetTokens: 5,
                  includedChars: 20,
                  includedTokens: 5,
                  trimmedChars: 20,
                  trimmedTokens: 5,
                  budgetStatus: "trimmed",
                  budgetReason: "section-over-budget",
                },
              ],
            },
          ],
          usageLimit: {
            utilization: 0.8,
            rateLimitType: "seven_day",
            resetsAt: 9999,
          },
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub(),
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    await workspaceFixture.cleanup();

    expect(detailsCommentBody).toBeDefined();
    expect(detailsCommentBody).toContain("20% of seven_day limit remaining");
    expect(detailsCommentBody).toContain("in /");
    expect(detailsCommentBody).toContain("Budget behavior: scoped (prompt-budget-limited).");
    expect(detailsCommentBody).toContain("Prompt budget: 1 sections, 1 trimmed, 0 bypassed, 5 trimmed tokens.");
    expect(detailsCommentBody).toContain("Cache behavior: 1 observations");
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

describe("createReviewHandler enqueue routing", () => {
  test("automatic review requests enqueue onto the review lane with a stable PR key", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const enqueuedContexts: Array<{ lane?: string; key?: string }> = [];

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          _fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: JobQueueContext,
        ) => {
          enqueuedContexts.push({ lane: context?.lane, key: context?.key });
          return undefined as T;
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      },
      workspaceManager: {} as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
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

    expect(enqueuedContexts).toEqual([
      { lane: "review", key: "acme/repo#101" },
    ]);
  });
});

describe("createReviewHandler timeout resilience", () => {
  test("full timeout with no structured evidence stays a hard failure but still enqueues a reduced-scope retry", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const createdCommentBodies: string[] = [];
    const enqueuedContexts: Array<{ action?: string; jobType?: string; lane?: string; key?: string }> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          deliveryId?: string;
          eventName?: string;
          action?: string;
          jobType?: string;
          prNumber?: number;
          lane?: string;
          key?: string;
        },
      ) => {
        enqueuedContexts.push({
          action: context?.action,
          jobType: context?.jobType,
          lane: context?.lane,
          key: context?.key,
        });
        if (context?.action === "review-retry") {
          // Do not execute the retry job in this unit test.
          return undefined as T;
        }
        return fn(
          createQueueRunMetadata({
            queuedAtMs: 1_000,
            startedAtMs: 900,
            waitMs: -100,
          }),
        );
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

    const boundedComment = createdCommentBodies.find((b) => b.includes("**Bounded first-pass review**"));
    expect(boundedComment).toBeUndefined();

    const reviewDetails = createdCommentBodies.find((b) => b.includes("<summary>Review Details</summary>"));
    expect(reviewDetails).toBeUndefined();
    expect(createdCommentBodies.length).toBeGreaterThan(0);

    const retryContext = enqueuedContexts.find((context) => context.action === "review-retry");
    expect(retryContext).toEqual({
      action: "review-retry",
      jobType: "pull-request-review-retry",
      lane: "review",
      key: "acme/repo#101",
    });

    await workspaceFixture.cleanup();
  });

  test("timeout publication uses checkpoint-backed analyzed progress and retry state", async () => {
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
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
          jobType?: string;
        },
      ) => {
        enqueuedContexts.push({ action: context?.action, jobType: context?.jobType });
        if (context?.action === "review-retry") {
          return undefined as T;
        }
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const issueComments = new Map<number, string>();
    let nextCommentId = 130;
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            createdCommentBodies.push(params.body);
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-timeout-checkpoint-truth",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 2,
          summaryDraft: "Found two issues before timeout.",
          totalFiles: 3,
        }),
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
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
          title: "Timeout checkpoint truthfulness",
          body: "",
          commits: 0,
          additions: 3,
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

    const partial = Array.from(issueComments.values()).find((body) => body.includes("**Bounded first-pass review**"));
    expect(partial).toBeDefined();
    expect(partial!).toContain("stopped at timeout after covering 1 of 3 files from checkpoint evidence");
    expect(partial!).toContain("follow-up review is pending (timeout budget: remote runtime 505s + infra overhead 180s = total 685s).");
    expect(partial!).toContain("Found two issues before timeout.");
    expect(partial!).toContain("Scheduling a reduced-scope retry.");
    expect(partial!).toContain(buildReviewOutputMarker(buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    })));
    expect(partial!).toContain("<summary>Review Details</summary>");
    expect(partial!).toContain("- Analyzed progress before timeout: 1/3 changed files");
    expect(partial!).toContain("- Findings captured before timeout: 2 total");
    expect(partial!).not.toContain("29617560m");
    expect(partial!).toContain("- Phase timings:");
    expect(partial!).toContain("queue wait: 250ms");
    expect(partial!).not.toContain("- Files reviewed: 3");

    const reviewDetails = Array.from(issueComments.values()).find((body) =>
      body.includes("<summary>Review Details</summary>") && body !== partial
    );
    expect(reviewDetails).toBeUndefined();

    expect(enqueuedContexts.find((context) => context.action === "review-retry")).toEqual({
      action: "review-retry",
      jobType: "pull-request-review-retry",
    });

    await workspaceFixture.cleanup();
  });

  test("timeout publication omits split timeout budget when dynamic scaling is disabled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    await Bun.write(
      join(workspaceFixture.dir, ".kodiai.yml"),
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "timeoutSeconds: 600",
        "timeout:",
        "  dynamicScaling: false",
        "",
      ].join("\n"),
    );

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: { action?: string },
      ) => {
        if (context?.action === "review-retry") {
          return undefined as T;
        }
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const issueComments = new Map<number, string>();
    let nextCommentId = 130;
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
      },
    };

    let dynamicTimeoutSeconds: number | undefined | null = null;
    createReviewHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (params: { dynamicTimeoutSeconds?: number }) => {
          dynamicTimeoutSeconds = params.dynamicTimeoutSeconds;
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-static-budget",
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
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 2,
          summaryDraft: "Found two issues before timeout.",
          totalFiles: 3,
        }),
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
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
          title: "Timeout checkpoint static budget",
          body: "",
          commits: 0,
          additions: 3,
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

    const partial = Array.from(issueComments.values()).find((body) => body.includes("**Bounded first-pass review**"));
    expect(dynamicTimeoutSeconds).toBeUndefined();
    expect(partial).toBeDefined();
    expect(partial!).toContain("follow-up review is pending (600s timeout).");
    expect(partial!).not.toContain("timeout budget: remote runtime");
    expect(partial!).not.toContain("- Timeout budget:");

    await workspaceFixture.cleanup();
  });

  test("suppresses timeout Review Details publication when publish rights are lost after bounded first-pass output", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const createdCommentBodies: string[] = [];
    const completedAttemptIds: string[] = [];
    const canPublishResults = [true, false];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          return undefined as T;
        }
        return fn(
          createQueueRunMetadata({
            queuedAtMs: 1_000,
            startedAtMs: 900,
            waitMs: -100,
          }),
        );
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    let nextCommentId = 200;
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
        execute: async () => ({
          conclusion: "error",
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-timeout-review-details-superseded",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 1,
          summaryDraft: "Found one issue before timeout.",
          totalFiles: 1,
        }),
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-timeout-details-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => canPublishResults.shift() ?? false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout review details suppression",
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

    const partial = createdCommentBodies.find((body) => body.includes("**Bounded first-pass review**"));
    const reviewDetails = createdCommentBodies.find((body) => body.includes("<summary>Review Details</summary>"));

    expect(partial).toBeDefined();
    expect(reviewDetails).toBeUndefined();
    expect(completedAttemptIds).toEqual(["attempt-timeout-details-1"]);
    expect(
      entries.some((entry) => entry.message === "Skipping timeout canonical Review Details merge because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("timeout canonical Review Details merge refreshes the same bounded partial comment when older marker-matching comments exist", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

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

    const issueComments = new Map<number, string>([
      [700, `older timeout comment\n\n${marker}`],
    ]);
    let nextCommentId = 701;
    let timeoutPartialCommentId: number | undefined;
    let timeoutCanonicalUpdateId: number | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: { action?: string },
      ) => {
        if (context?.action === "review-retry") {
          return undefined as T;
        }
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            if (params.body.includes("**Bounded first-pass review**")) {
              timeoutPartialCommentId = id;
            }
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            if (params.body.includes("<summary>Review Details</summary>")) {
              timeoutCanonicalUpdateId = params.comment_id;
            }
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-timeout-review-details-canonical-id",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 1,
          summaryDraft: "Found one issue before timeout.",
          totalFiles: 1,
        }),
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
          title: "Timeout canonical id pinning",
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

    expect(timeoutPartialCommentId).toBeDefined();
    expect(timeoutCanonicalUpdateId).toBe(timeoutPartialCommentId);
    expect(timeoutCanonicalUpdateId).not.toBe(700);

    await workspaceFixture.cleanup();
  });

  test("falls back to standalone Review Details when timeout canonical comment rebuild fails", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const issueComments = new Map<number, string>();
    let nextCommentId = 700;
    let failCanonicalUpdate = true;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          return undefined as T;
        }
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            if (failCanonicalUpdate) {
              failCanonicalUpdate = false;
              throw new Error("timeout canonical update failed");
            }
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-timeout-review-details-fallback",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 1,
          summaryDraft: "Found one issue before timeout.",
          totalFiles: 1,
        }),
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout review details fallback",
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

    const timeoutSummary = Array.from(issueComments.values()).find((body) =>
      body.includes("**Bounded first-pass review**")
    );
    const standaloneReviewDetails = Array.from(issueComments.values()).find((body) =>
      body.includes("<summary>Review Details</summary>") && body !== timeoutSummary
    );

    expect(timeoutSummary).toBeDefined();
    expect(timeoutSummary).not.toContain("<summary>Review Details</summary>");
    expect(standaloneReviewDetails).toBeDefined();
    expect(standaloneReviewDetails).toContain("<summary>Review Details</summary>");
    expect(
      entries.some((entry) => entry.data?.gate === "review-details-output" && entry.data?.gateResult === "degraded-fallback"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("queued retry keeps publish rights after the parent attempt unwinds", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger } = createCaptureLogger();

    const createdCommentBodies: string[] = [];
    const completedAttemptIds: string[] = [];
    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["README.md"],
      summaryDraft: "Retry found one issue.",
    });

    let updatedCommentBody: string | undefined;
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 300;
    let executeCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 10_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: string) => coordinator.canPublish(attemptId),
      setPhase: (
        attemptId: string,
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => coordinator.setPhase(attemptId, phase),
      getSnapshot: (familyKey: string) => coordinator.getSnapshot(familyKey),
      release: (attemptId: string) => coordinator.release(attemptId),
      complete: (attemptId: string) => {
        completedAttemptIds.push(attemptId);
        coordinator.complete(attemptId);
      },
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
            createdCommentBodies.push(params.body);
            return { data: { id: nextCommentId++ } };
          },
          updateComment: async (params: { body: string }) => {
            updatedCommentBody = params.body;
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          executeCount += 1;
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-followup",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-retry-root",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
          });
        },
        getCheckpoint: async (key: string) => checkpointState.get(key) ?? null,
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
      }) as never,
      reviewWorkCoordinator: reviewWorkCoordinator as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry merge success",
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

    expect(queuedRetryJob).toBeDefined();
    expect(completedAttemptIds).toEqual(["review-work-1"]);

    await queuedRetryJob!(queueMetadata);

    expect(executeCount).toBe(2);
    expect(createdCommentBodies.some((body) => body.includes("**Bounded first-pass review**"))).toBeFalse();
    expect(updatedCommentBody).toBeUndefined();
    expect(completedAttemptIds).toEqual(["review-work-1", "review-work-2"]);

    await workspaceFixture.cleanup();
  });

  test("max-turns continuation publishes one final completed review instead of a bounded first-pass", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 0,
      filesReviewed: ["README.md"],
      summaryDraft: "Reviewed README before max-turns.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 0,
      filesReviewed: ["src/a.ts", "src/b.ts"],
      summaryDraft: "Completed the remaining files without findings.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 610;
    const issueComments = new Map<number, string>();
    const { logger, entries } = createCaptureLogger();

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({
                data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
              }),
              createComment: async (params: { body: string }) => {
                const id = nextCommentId++;
                issueComments.set(id, params.body);
                return { data: { id } };
              },
              updateComment: async (params: { comment_id: number; body: string }) => {
                issueComments.set(params.comment_id, params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-max-turns-retry-complete",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "failure",
            published: false,
            stopReason: "max_turns",
            failureSubtype: "error_max_turns",
            costUsd: 0,
            numTurns: 25,
            durationMs: 1,
            sessionId: "session-max-turns-root-complete",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    expect(queuedRetryJob).toBeDefined();
    expect(Array.from(issueComments.values()).join("\n")).not.toContain("Bounded first-pass review");
    expect(Array.from(issueComments.values()).join("\n")).not.toContain("follow-up review is pending");

    await queuedRetryJob!(createQueueRunMetadata());

    expect(entries.some((entry) => entry.message === "Retry complete -- published final review comment with merged results")).toBeTrue();
    const finalComment = Array.from(issueComments.values()).join("\n");
    expect(finalComment).toContain("**Review complete**");
    expect(finalComment).toContain("Coverage: 3 of 3 changed files reviewed.");
    expect(finalComment).not.toContain("Bounded first-pass review");
    expect(finalComment).not.toContain("follow-up review is pending");
    expect(finalComment).not.toContain("- Bounded first-pass:");
    expect(finalComment).toContain(buildReviewOutputMarker(reviewOutputKey));

    await workspaceFixture.cleanup();
  });

  test("retry merge updates the bounded comment and Review Details with merged coverage", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 2,
      filesReviewed: ["README.md"],
      summaryDraft: "Found two issues before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["src/a.ts"],
      summaryDraft: "Retry found one more issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 600;
    const issueComments = new Map<number, string>();
    const { logger, entries } = createCaptureLogger();
    let exposeContinuationReviewComments = false;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            data: exposeContinuationReviewComments
              ? [
                  {
                    id: 9001,
                    path: "README.md",
                    body: [
                      "```yaml",
                      "severity: major",
                      "category: correctness",
                      "```",
                      "**Carry forward timeout finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                  {
                    id: 9002,
                    path: "src/a.ts",
                    body: [
                      "```yaml",
                      "severity: medium",
                      "category: correctness",
                      "```",
                      "**New continuation finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                ]
              : [],
          }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            exposeContinuationReviewComments = true;
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-merge-success",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-root-merge-success",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
          {
            filePath: "src/b.ts",
            title: "Resolved timeout finding",
            titleFingerprint: "fp-c56af86d",
            severity: "medium",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 502,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry merge details parity",
          body: "",
          commits: 0,
          additions: 3,
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

    expect(queuedRetryJob).toBeDefined();

    const initialPartialComment = Array.from(issueComments.values()).find((body) =>
      body.includes("**Bounded first-pass review**")
    );
    const initialReviewDetails = Array.from(issueComments.values()).find((body) =>
      body.includes("<summary>Review Details</summary>")
    );
    expect(initialPartialComment).toContain("stopped at timeout after covering 1 of 3 files from checkpoint evidence");
    expect(initialPartialComment).toContain(buildReviewOutputMarker(reviewOutputKey));
    expect(initialReviewDetails).toBe(initialPartialComment);
    expect(initialReviewDetails).toContain("- Covered scope: 1/3 changed files");
    expect(initialReviewDetails).toContain("- Continuation state: follow-up review pending for remaining scope");

    await queuedRetryJob!(queueMetadata);

    // Debug aid if this contract regresses again: logger entries show whether the merge path or publish-rights gate fired.
    expect(entries.some((entry) => entry.message === "Retry complete -- updated partial review comment with merged results")).toBeTrue();

    const mergedPartialComment = issueComments.get(600);

    expect(mergedPartialComment).toBeDefined();
    expect(mergedPartialComment).toContain("Retry complete -- analyzed 2 of 3 files total after a reduced-scope follow-up.");
    expect(mergedPartialComment).toContain("Continuation revisions: 2 new findings, 0 still-open findings, and 2 resolved or revised findings.");
    expect(mergedPartialComment).toContain("stopped at timeout after covering 2 of 3 files from checkpoint evidence");
    expect(mergedPartialComment).toContain(buildReviewOutputMarker(reviewOutputKey));
    expect(mergedPartialComment).toContain("<summary>Review Details</summary>");
    expect(mergedPartialComment).toContain("- Covered scope: 2/3 changed files");
    expect(mergedPartialComment).toContain("- Remaining scope: 1/3 changed files");
    expect(mergedPartialComment).toContain("- Continuation state: follow-up review pending for remaining scope");
    expect(issueComments.get(601)).toBeUndefined();

    await workspaceFixture.cleanup();
  });

  test("retry merge leaves the canonical comment unchanged when continuation has no meaningful delta", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["README.md"],
      summaryDraft: "Found one issue before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 0,
      filesReviewed: ["README.md"],
      summaryDraft: "Retry confirmed the same issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 700;
    const issueComments = new Map<number, string>();
    const { logger, entries } = createCaptureLogger();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-no-delta",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-root-no-delta",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry merge no delta",
          body: "",
          commits: 0,
          additions: 3,
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

    expect(queuedRetryJob).toBeDefined();

    const initialCanonicalComment = issueComments.get(700);
    expect(initialCanonicalComment).toBeDefined();

    await queuedRetryJob!(queueMetadata);

    expect(issueComments.get(700)).toBe(initialCanonicalComment);
    expect(issueComments.size).toBe(1);
    expect(entries.some((entry) => entry.message === "Retry produced no additional results -- keeping original partial review")).toBeTrue();
    expect(issueComments.get(700)).not.toContain("Continuation revisions:");

    await workspaceFixture.cleanup();
  });

  test("suppresses retry partial review merge when newer review work supersedes the queued retry", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const createdCommentBodies: string[] = [];
    const completedAttemptIds: string[] = [];
    const canonicalWrites: Record<string, unknown>[] = [];
    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["README.md"],
      summaryDraft: "Retry found one issue.",
    });

    let updatedCommentBody: string | undefined;
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 350;
    let executeCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 12_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: string) => coordinator.canPublish(attemptId),
      setPhase: (
        attemptId: string,
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => coordinator.setPhase(attemptId, phase),
      getSnapshot: (familyKey: string) => coordinator.getSnapshot(familyKey),
      release: (attemptId: string) => coordinator.release(attemptId),
      complete: (attemptId: string) => {
        completedAttemptIds.push(attemptId);
        coordinator.complete(attemptId);
      },
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
            createdCommentBodies.push(params.body);
            return { data: { id: nextCommentId++ } };
          },
          updateComment: async (params: { body: string }) => {
            updatedCommentBody = params.body;
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          executeCount += 1;
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-followup-superseded",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-retry-root-superseded",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
          });
        },
        getCheckpoint: async (key: string) => checkpointState.get(key) ?? null,
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      reviewWorkCoordinator: reviewWorkCoordinator as never,
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry merge suppression",
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

    expect(queuedRetryJob).toBeDefined();
    expect(completedAttemptIds).toEqual(["review-work-1"]);

    const supersedingExplicitAttempt = reviewWorkCoordinator.claim({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-456",
      phase: "claimed",
    });
    reviewWorkCoordinator.setPhase(supersedingExplicitAttempt.attemptId, "executor-dispatch");
    reviewWorkCoordinator.complete(supersedingExplicitAttempt.attemptId);

    await queuedRetryJob!(queueMetadata);

    expect(executeCount).toBe(2);
    expect(createdCommentBodies.some((body) => body.includes("**Bounded first-pass review**"))).toBeFalse();
    expect(updatedCommentBody).toBeUndefined();
    expect(completedAttemptIds).toEqual(["review-work-1", "review-work-3", "review-work-2"]);
    expect(
      entries.some((entry) => entry.message === "Retry settlement skipped because the base checkpoint was missing"),
    ).toBeTrue();
    expect(canonicalWrites.at(-1)).toMatchObject({
      authoritativeAttemptId: "review-work-2",
      authoritativeOutcome: "quiet-settled",
      finalStopReason: "settled-without-update",
      projectionStatus: "canonical",
    });

    await workspaceFixture.cleanup();
  });

  test("suppresses retry partial review merge on the canonical comment when newer review work wins publish rights", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["README.md"],
      summaryDraft: "Found one issue before timeout.",
      totalFiles: 2,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["src/a.ts"],
      summaryDraft: "Retry found another issue.",
      totalFiles: 2,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 800;
    const issueComments = new Map<number, string>();
    const updatedCommentBodies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 14_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: string) => coordinator.canPublish(attemptId),
      setPhase: (
        attemptId: string,
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => coordinator.setPhase(attemptId, phase),
      getSnapshot: (familyKey: string) => coordinator.getSnapshot(familyKey),
      release: (attemptId: string) => coordinator.release(attemptId),
      complete: (attemptId: string) => coordinator.complete(attemptId),
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            updatedCommentBodies.push(params.body);
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-summary-superseded",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-root-summary-superseded",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      reviewWorkCoordinator: reviewWorkCoordinator as never,
      logger: logger as never,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry summary suppression on canonical comment",
          body: "",
          commits: 0,
          additions: 2,
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

    expect(queuedRetryJob).toBeDefined();
    const initialCanonicalComment = issueComments.get(800);
    expect(initialCanonicalComment).toContain("**Bounded first-pass review**");
    const updateCountBeforeRetry = updatedCommentBodies.length;

    const supersedingExplicitAttempt = reviewWorkCoordinator.claim({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-789",
      phase: "claimed",
    });
    reviewWorkCoordinator.setPhase(supersedingExplicitAttempt.attemptId, "executor-dispatch");

    await queuedRetryJob!(queueMetadata);

    expect(issueComments.get(800)).toBe(initialCanonicalComment);
    expect(updatedCommentBodies).toHaveLength(updateCountBeforeRetry);
    expect(
      entries.some((entry) => entry.message === "Skipping retry partial review merge because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("retry merge updates the same canonical comment with merged Review Details in a single upsert", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 2,
      filesReviewed: ["README.md"],
      summaryDraft: "Found two issues before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["src/a.ts"],
      summaryDraft: "Retry found one more issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 900;
    const issueComments = new Map<number, string>([
      [899, `older marker match\n\n${buildReviewOutputMarker(reviewOutputKey)}`],
    ]);
    const updatedCommentBodies: string[] = [];
    const updatedCommentIds: number[] = [];
    let exposeContinuationReviewComments = false;
    let allowRetryPublish = true;
    let retryExecutionStarted = false;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({
        dir: workspaceFixture.dir,
        cleanup: async () => undefined,
      }),
      cleanupStale: async () => 0,
    };

    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 16_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: string) => {
        if (!coordinator.canPublish(attemptId)) {
          return false;
        }
        if (attemptId === "review-work-2") {
          return allowRetryPublish;
        }
        return true;
      },
      setPhase: (
        attemptId: string,
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => coordinator.setPhase(attemptId, phase),
      getSnapshot: (familyKey: string) => coordinator.getSnapshot(familyKey),
      release: (attemptId: string) => coordinator.release(attemptId),
      complete: (attemptId: string) => coordinator.complete(attemptId),
    };

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: exposeContinuationReviewComments
              ? [
                  {
                    id: 9101,
                    path: "README.md",
                    body: [
                      "```yaml",
                      "severity: major",
                      "category: correctness",
                      "```",
                      "**Carry forward timeout finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                  {
                    id: 9102,
                    path: "src/a.ts",
                    body: [
                      "```yaml",
                      "severity: medium",
                      "category: correctness",
                      "```",
                      "**New continuation finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                ]
              : [],
          }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            updatedCommentBodies.push(params.body);
            updatedCommentIds.push(params.comment_id);
            issueComments.set(params.comment_id, params.body);
            if (retryExecutionStarted) {
              allowRetryPublish = false;
            }
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            retryExecutionStarted = true;
            exposeContinuationReviewComments = true;
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-details-superseded",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-root-details-superseded",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
          {
            filePath: "src/b.ts",
            title: "Resolved timeout finding",
            titleFingerprint: "fp-c56af86d",
            severity: "medium",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 502,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      reviewWorkCoordinator: reviewWorkCoordinator as never,
      logger: logger as never,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry details suppression after summary merge",
          body: "",
          commits: 0,
          additions: 3,
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

    expect(queuedRetryJob).toBeDefined();
    const initialCanonicalComment = issueComments.get(900);
    expect(initialCanonicalComment).toContain("<summary>Review Details</summary>");
    const updateCountBeforeRetry = updatedCommentBodies.length;

    await queuedRetryJob!(queueMetadata);

    expect(updatedCommentBodies).toHaveLength(updateCountBeforeRetry + 1);
    expect(updatedCommentIds.at(-1)).toBe(900);
    expect(issueComments.get(900)).toBe(updatedCommentBodies.at(-1));
    expect(issueComments.get(900)).toContain("Retry complete -- analyzed 2 of 3 files total after a reduced-scope follow-up.");
    expect(issueComments.get(900)).toContain("<summary>Review Details</summary>");
    expect(issueComments.get(899)).toBe(`older marker match\n\n${buildReviewOutputMarker(reviewOutputKey)}`);
    expect(issueComments.get(901)).toBeUndefined();

    await workspaceFixture.cleanup();
  });

  test("retry merge falls back to standalone Review Details when canonical comment refresh fails", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();
    const canonicalWrites: Array<Record<string, unknown>> = [];

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 2,
      filesReviewed: ["README.md"],
      summaryDraft: "Found two issues before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["src/a.ts"],
      summaryDraft: "Retry found one more issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 980;
    const issueComments = new Map<number, string>();
    let failCanonicalUpdate = false;
    let exposeContinuationReviewComments = false;
    let retryExecutionStarted = false;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            data: exposeContinuationReviewComments
              ? [
                  {
                    id: 9801,
                    path: "README.md",
                    body: [
                      "```yaml",
                      "severity: major",
                      "category: correctness",
                      "```",
                      "**Carry forward timeout finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                  {
                    id: 9802,
                    path: "src/a.ts",
                    body: [
                      "```yaml",
                      "severity: medium",
                      "category: correctness",
                      "```",
                      "**New continuation finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                ]
              : [],
          }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            if (failCanonicalUpdate) {
              failCanonicalUpdate = false;
              throw new Error("retry canonical update failed");
            }
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            retryExecutionStarted = true;
            exposeContinuationReviewComments = true;
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-details-fallback",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-root-details-fallback",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
          {
            filePath: "src/b.ts",
            title: "Resolved timeout finding",
            titleFingerprint: "fp-c56af86d",
            severity: "medium",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 502,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: claim.deliveryId === "delivery-123-retry-1" ? "review-work-2" : "review-work-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "automatic-review",
          lane: claim.lane as "review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => true,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: () => undefined,
      } as never,
      logger: logger as never,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry details fallback after summary merge",
          body: "",
          commits: 0,
          additions: 3,
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

    expect(queuedRetryJob).toBeDefined();
    const initialCanonicalComment = issueComments.get(980);
    expect(initialCanonicalComment).toContain("<summary>Review Details</summary>");

    failCanonicalUpdate = true;
    await queuedRetryJob!(queueMetadata);

    const standaloneReviewDetails = Array.from(issueComments.values()).find((body) =>
      body.includes("<summary>Review Details</summary>") && !body.includes("Retry complete -- analyzed 2 of 3 files total after a reduced-scope follow-up.")
    );
    expect(standaloneReviewDetails).toContain("<summary>Review Details</summary>");
    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "degraded",
      supersededByAttemptId: null,
    });
    expect(
      entries.some((entry) => entry.message === "Retry complete -- updated partial review comment with merged results; Review Details published via degraded fallback comment" && entry.data?.projectionStatus === "degraded"),
    ).toBeTrue();
    expect(
      entries.some((entry) => entry.data?.gate === "review-details-output" && entry.data?.gateResult === "degraded-fallback"),
    ).toBeTrue();
    expect(retryExecutionStarted).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("retry no-delta settlement stays a public no-op on the canonical comment", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["README.md"],
      summaryDraft: "Found one issue before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 0,
      filesReviewed: ["README.md"],
      summaryDraft: "Retry confirmed the same issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 950;
    const issueComments = new Map<number, string>();
    let updateCommentCalls = 0;
    let exposeContinuationReviewComments = false;
    const { logger, entries } = createCaptureLogger();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: {
          action?: string;
        },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
            data: exposeContinuationReviewComments
              ? [
                  {
                    id: 9501,
                    path: "README.md",
                    body: [
                      "```yaml",
                      "severity: major",
                      "category: correctness",
                      "```",
                      "**Carry forward timeout finding**",
                      "",
                      buildReviewOutputMarker(reviewOutputKey),
                    ].join("\n"),
                  },
                ]
              : [],
          }),
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
        },
        issues: {
          listComments: async () => ({
            data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
          }),
          createComment: async (params: { body: string }) => {
            const id = nextCommentId++;
            issueComments.set(id, params.body);
            return { data: { id } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            updateCommentCalls += 1;
            issueComments.set(params.comment_id, params.body);
            return { data: {} };
          },
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
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            exposeContinuationReviewComments = true;
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-timeout-retry-no-delta-public-noop",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-timeout-root-no-delta-public-noop",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Timeout retry no delta remains quiet",
          body: "",
          commits: 0,
          additions: 3,
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

    expect(queuedRetryJob).toBeDefined();
    const initialCanonicalComment = issueComments.get(950);
    expect(initialCanonicalComment).toBeDefined();
    expect(initialCanonicalComment).toContain("<summary>Review Details</summary>");
    const updateCountBeforeRetry = updateCommentCalls;

    await queuedRetryJob!(queueMetadata);

    expect(issueComments.get(950)).toBe(initialCanonicalComment);
    expect(updateCommentCalls).toBe(updateCountBeforeRetry);
    expect(issueComments.size).toBe(1);
    expect(entries.some((entry) => entry.message === "Retry produced no additional results -- keeping original partial review")).toBeTrue();

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler review prompt section telemetry", () => {
  const oversizedReviewPrompt = "Review instruction ".repeat(1200);
  const telemetryEnabledConfig = [
    "review:",
    "  enabled: true",
    "  autoApprove: false",
    "  prompt: |-",
    ...oversizedReviewPrompt.trimEnd().split(" ").map((line) => `    ${line}`),
    "  triggers:",
    "    onOpened: true",
    "    onReadyForReview: true",
    "    onReviewRequested: true",
    "  skipAuthors: []",
    "  skipPaths: []",
    "telemetry:",
    "  enabled: true",
    "",
  ].join("\n");

  test("initial review telemetry persists multiple named review.user-prompt sections", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    await Bun.write(`${workspaceFixture.dir}/.kodiai.yml`, telemetryEnabledConfig);

    const promptSectionEntries: Array<{
      deliveryId?: string;
      repo: string;
      taskType: string;
      promptKind: string;
      sections: Array<{
        sectionName: string;
        sectionPosition: number;
        charCount: number;
        estimatedTokens: number;
        truncated?: boolean;
      }>;
    }> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) =>
        fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          sessionId: "session-review-prompt-sections",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
        }),
      } as never,
      telemetryStore: {
        ...noopTelemetryStore,
        recordPromptSections: async (entry: (typeof promptSectionEntries)[number]) => {
          promptSectionEntries.push(entry);
        },
      } as never,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }),
    );

    expect(promptSectionEntries).toHaveLength(1);
    expect(promptSectionEntries[0]?.promptKind).toBe("review.user-prompt");
    expect(promptSectionEntries[0]?.taskType).toBe("review.small-diff");
    expect(promptSectionEntries[0]?.sections.length).toBeGreaterThan(1);
    expect(promptSectionEntries[0]?.sections.map((section) => section.sectionName)).toEqual(
      expect.arrayContaining([
        "review-pr-context",
        "review-change-context",
        "review-instructions",
      ]),
    );
    expect(promptSectionEntries[0]?.sections.some((section) => section.truncated === true)).toBeTrue();
    const sectionWithBudgetMetadata = promptSectionEntries[0]?.sections.find((section) => section.sectionName === "review-instructions") as (typeof promptSectionEntries)[number]["sections"][number] & Record<string, unknown> | undefined;
    expect(sectionWithBudgetMetadata?.budgetStatus).toBe("trimmed");
    expect(sectionWithBudgetMetadata?.budgetReason).toBe("section-over-budget");
    expect(sectionWithBudgetMetadata?.budgetChars).toBeGreaterThan(0);
    expect(sectionWithBudgetMetadata?.includedChars).toBe(sectionWithBudgetMetadata?.budgetChars);
    expect(sectionWithBudgetMetadata?.trimmedChars).toBeGreaterThan(0);

    await workspaceFixture.cleanup();
  });

  test("retry review telemetry preserves multi-section review.user-prompt metrics", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    await Bun.write(`${workspaceFixture.dir}/.kodiai.yml`, telemetryEnabledConfig);

    const promptSectionEntries: Array<{
      deliveryId?: string;
      repo: string;
      taskType: string;
      promptKind: string;
      sections: Array<{
        sectionName: string;
        sectionPosition: number;
        charCount: number;
        estimatedTokens: number;
        truncated?: boolean;
      }>;
    }> = [];
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let executeCount = 0;
    let nextCommentId = 500;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const queueMetadata = createQueueRunMetadata();
    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: { action?: string },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          createComment: async () => ({ data: { id: nextCommentId++ } }),
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
        execute: async (context: { eventType: string }) => {
          executeCount += 1;
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-review-retry-success",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-review-retry-timeout",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "timeout",
          };
        },
      } as never,
      telemetryStore: {
        ...noopTelemetryStore,
        recordPromptSections: async (entry: (typeof promptSectionEntries)[number]) => {
          promptSectionEntries.push(entry);
        },
      } as never,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => null,
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Retry prompt telemetry",
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

    expect(queuedRetryJob).toBeDefined();
    await queuedRetryJob!(queueMetadata);

    expect(executeCount).toBe(2);
    expect(promptSectionEntries).toHaveLength(2);
    expect(promptSectionEntries.map((entry) => entry.promptKind)).toEqual([
      "review.user-prompt",
      "review.user-prompt",
    ]);
    expect(promptSectionEntries.map((entry) => entry.deliveryId)).toEqual([
      "delivery-123",
      "delivery-123-retry-1",
    ]);
    for (const entry of promptSectionEntries) {
      expect(entry.taskType).toBe("review.small-diff");
      expect(entry.sections.length).toBeGreaterThan(1);
      expect(entry.sections.map((section) => section.sectionName)).toEqual(
        expect.arrayContaining([
          "review-pr-context",
          "review-change-context",
          "review-instructions",
        ]),
      );
      expect(entry.sections.some((section) => section.truncated === true)).toBeTrue();
      const sectionWithBudgetMetadata = entry.sections.find((section) => section.sectionName === "review-instructions") as (typeof entry.sections)[number] & Record<string, unknown> | undefined;
      expect(sectionWithBudgetMetadata?.budgetStatus).toBe("trimmed");
      expect(sectionWithBudgetMetadata?.budgetReason).toBe("section-over-budget");
      expect(sectionWithBudgetMetadata?.includedChars).toBe(sectionWithBudgetMetadata?.budgetChars);
      expect(sectionWithBudgetMetadata?.trimmedChars).toBeGreaterThan(0);
    }

    await workspaceFixture.cleanup();
  });
});

describe("review prompt derived cache", () => {
  test("buildReviewPromptFingerprint bypasses malformed prompt state", () => {
    expect(
      buildReviewPromptFingerprint({
        owner: "acme",
        repo: "repo",
        prNumber: 101,
        prTitle: "Prompt fingerprint",
        prBody: "",
        prAuthor: "octocat",
        baseBranch: "main",
        headBranch: "feature",
        changedFiles: [],
      }),
    ).toEqual({
      fingerprint: null,
      missingSignals: ["changed-files"],
    });
  });

  test("buildReviewPromptFingerprint invalidates bounded prompt safety inputs without exposing raw payloads", () => {
    const baseContext = {
      owner: "Acme",
      repo: "Repo",
      prNumber: 101,
      prTitle: "Prompt fingerprint",
      prBody: "Review this safely",
      prAuthor: "octocat",
      baseBranch: "main",
      headBranch: "feature",
      changedFiles: ["README.md", "src/a.ts"],
      contextWindow: "budget-relevant context",
      retrievalContext: {
        maxChars: 240,
        findings: [
          {
            findingText: "Prefer bounded cache telemetry.",
            severity: "medium",
            category: "observability",
            path: "src/a.ts",
            line: 12,
            snippet: "bounded telemetry",
            outcome: "accepted",
            distance: 0.1234567,
            sourceRepo: "ACME/Repo",
          },
        ],
      },
    };

    const base = buildReviewPromptFingerprint(baseContext);
    expect(base.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(base.missingSignals).toEqual([]);

    const sameSemanticState = buildReviewPromptFingerprint({
      ...baseContext,
      owner: "acme",
      repo: "repo",
      changedFiles: ["src/a.ts", "README.md"],
    });
    expect(sameSemanticState.fingerprint).toBe(base.fingerprint);

    const changedFiles = buildReviewPromptFingerprint({
      ...baseContext,
      changedFiles: ["README.md", "src/b.ts"],
    });
    const changedRetrievalFinding = buildReviewPromptFingerprint({
      ...baseContext,
      retrievalContext: {
        ...baseContext.retrievalContext,
        findings: [
          {
            ...baseContext.retrievalContext.findings[0]!,
            findingText: "A different retrieval finding must not reuse the old prompt.",
          },
        ],
      },
    });
    const changedBudgetContext = buildReviewPromptFingerprint({
      ...baseContext,
      contextWindow: "different budget-relevant context",
    });

    expect(changedFiles.fingerprint).not.toBe(base.fingerprint);
    expect(changedRetrievalFinding.fingerprint).not.toBe(base.fingerprint);
    expect(changedBudgetContext.fingerprint).not.toBe(base.fingerprint);
    expect(JSON.stringify({ base, changedFiles, changedRetrievalFinding, changedBudgetContext })).not.toContain("Prefer bounded cache telemetry");
  });

  test("buildReviewPromptFingerprint bypasses malformed retrieval fingerprint state", () => {
    const result = buildReviewPromptFingerprint({
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      prTitle: "Prompt fingerprint",
      prBody: "",
      prAuthor: "octocat",
      baseBranch: "main",
      headBranch: "feature",
      changedFiles: ["README.md"],
      retrievalContext: {
        maxChars: 240,
        findings: [
          {
            findingText: "missing distance",
            severity: "medium",
            category: "observability",
            path: "README.md",
            outcome: "accepted",
            sourceRepo: "acme/repo",
          } as never,
        ],
      },
    });

    expect(result).toEqual({
      fingerprint: null,
      missingSignals: ["retrieval-fingerprint-data"],
    });
  });

  test("reuses identical review prompt artifacts across identical review state", async () => {
    const reuseTelemetry: Array<Record<string, unknown>> = [];
    const reviewCacheTelemetry: Array<Record<string, unknown>> = [];
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const queueMetadata = createQueueRunMetadata();
    const promptSectionsByRun: Array<Array<{ sectionName: string; charCount: number; estimatedTokens: number; truncated?: boolean }>> = [];
    let promptBuilderCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(queueMetadata),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
        execute: async (context: { promptSections: Array<{ sections: Array<{ sectionName: string; charCount: number; estimatedTokens: number; truncated?: boolean }> }> }) => {
          promptSectionsByRun.push(context.promptSections[0]?.sections ?? []);
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: `session-review-cache-${promptSectionsByRun.length}`,
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "end_turn",
          };
        },
      } as never,
      telemetryStore: {
        ...noopTelemetryStore,
        recordRateLimitEvent: async (entry) => {
          reuseTelemetry.push(entry as Record<string, unknown>);
        },
        recordReviewCacheEvent: async (entry) => {
          reviewCacheTelemetry.push(entry as Record<string, unknown>);
        },
      },
      reviewPromptBuilder: (context) => {
        promptBuilderCalls += 1;
        return {
          text: `prompt:${context.changedFiles.join(",")}:${context.customInstructions ?? "none"}`,
          sections: [
            {
              sectionName: "review-pr-context",
              sectionPosition: 0,
              charCount: 12,
              estimatedTokens: 3,
            },
            {
              sectionName: "review-instructions",
              sectionPosition: 1,
              charCount: 24,
              estimatedTokens: 6,
            },
          ],
        };
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    const event = buildReviewRequestedEvent({
      requested_reviewer: { login: "kodiai[bot]" },
      pull_request: {
        number: 101,
        draft: false,
        title: "Review prompt cache hit",
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
    });

    await handler!(event);
    await handler!(event);

    expect(promptBuilderCalls).toBe(1);
    expect(promptSectionsByRun).toHaveLength(2);
    expect(promptSectionsByRun[0]).toEqual(promptSectionsByRun[1]);
    const promptReuseStatuses = reuseTelemetry
      .filter((entry) => entry.eventType === "reuse.review-derived-prompt")
      .map((entry) => entry.degradationPath);
    expect(promptReuseStatuses).toEqual(["miss", "hit"]);
    expect(reviewCacheTelemetry.map((entry) => ({
      cacheSurface: entry.cacheSurface,
      status: entry.status,
      reason: entry.reason,
      deliveryId: entry.deliveryId,
      repo: entry.repo,
      prNumber: entry.prNumber,
      fingerprintVersion: entry.fingerprintVersion,
      safetySignalNames: entry.safetySignalNames,
    }))).toEqual([
      {
        cacheSurface: "review-derived-prompt",
        status: "miss",
        reason: "cache-miss",
        deliveryId: event.id,
        repo: "acme/repo",
        prNumber: 101,
        fingerprintVersion: "review-prompt-v1",
        safetySignalNames: ["prompt-cache-query-head-sha", "prompt-fingerprint-v1"],
      },
      {
        cacheSurface: "review-derived-prompt",
        status: "hit",
        reason: "safe-reuse",
        deliveryId: event.id,
        repo: "acme/repo",
        prNumber: 101,
        fingerprintVersion: "review-prompt-v1",
        safetySignalNames: ["prompt-cache-query-head-sha", "prompt-fingerprint-v1"],
      },
    ]);
    expect(JSON.stringify(reviewCacheTelemetry)).not.toContain("prompt:");

    await workspaceFixture.cleanup();
  });

  test("misses reused review prompt artifacts when review state drifts", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const queueMetadata = createQueueRunMetadata();
    const reviewCacheTelemetry: Array<Record<string, unknown>> = [];
    let promptBuilderCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(queueMetadata),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          sessionId: `session-review-cache-drift-${promptBuilderCalls}`,
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
        }),
      } as never,
      telemetryStore: {
        ...noopTelemetryStore,
        recordReviewCacheEvent: async (entry) => {
          reviewCacheTelemetry.push(entry as Record<string, unknown>);
        },
      },
      reviewPromptBuilder: (context) => {
        promptBuilderCalls += 1;
        return {
          text: `prompt:${context.changedFiles.join(",")}`,
          sections: [
            {
              sectionName: "review-pr-context",
              sectionPosition: 0,
              charCount: 10,
              estimatedTokens: 3,
            },
          ],
        };
      },
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(buildReviewRequestedEvent({
      requested_reviewer: { login: "kodiai[bot]" },
      pull_request: {
        number: 101,
        draft: false,
        title: "Review prompt cache miss",
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
    }));

    await handler!(buildReviewRequestedEvent({
      requested_reviewer: { login: "kodiai[bot]" },
      pull_request: {
        number: 101,
        draft: false,
        title: "Review prompt cache miss",
        body: "",
        commits: 0,
        additions: 1,
        deletions: 0,
        user: { login: "octocat" },
        base: { ref: "main", sha: "mainsha" },
        head: {
          sha: "fedcba0987654321",
          ref: "feature",
          repo: {
            full_name: "acme/repo",
            name: "repo",
            owner: { login: "acme" },
          },
        },
        labels: [],
      },
    }));

    expect(promptBuilderCalls).toBe(2);
    expect(reviewCacheTelemetry.map((entry) => ({
      cacheSurface: entry.cacheSurface,
      status: entry.status,
      reason: entry.reason,
      fingerprintVersion: entry.fingerprintVersion,
      safetySignalNames: entry.safetySignalNames,
    }))).toEqual([
      {
        cacheSurface: "review-derived-prompt",
        status: "miss",
        reason: "cache-miss",
        fingerprintVersion: "review-prompt-v1",
        safetySignalNames: ["prompt-cache-query-head-sha", "prompt-fingerprint-v1"],
      },
      {
        cacheSurface: "review-derived-prompt",
        status: "miss",
        reason: "cache-miss",
        fingerprintVersion: "review-prompt-v1",
        safetySignalNames: ["prompt-cache-query-head-sha", "prompt-fingerprint-v1"],
      },
    ]);

    await workspaceFixture.cleanup();
  });

  test("reduced-scope retry misses naturally and degraded cache falls back to rebuild", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const queueMetadata = createQueueRunMetadata();
    const promptTexts: string[] = [];
    const reviewCacheTelemetry: Array<Record<string, unknown>> = [];
    const { logger, entries } = createCaptureLogger();
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let promptBuilderCalls = 0;

    const failingStore = {
      get: () => {
        throw new Error("cache read unavailable");
      },
      set: () => {
        throw new Error("cache write unavailable");
      },
      delete: () => undefined,
      entries: function* () {
      },
    };

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: { action?: string },
      ) => {
        if (context?.action === "review-retry") {
          queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
          return undefined as T;
        }
        return fn(queueMetadata);
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          createComment: async () => ({ data: { id: 1 } }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
        execute: async (context: { eventType: string; prompt: string }) => {
          promptTexts.push(context.prompt);
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-review-retry-success",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-review-retry-timeout",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "timeout",
          };
        },
      } as never,
      telemetryStore: {
        ...noopTelemetryStore,
        recordReviewCacheEvent: async (entry) => {
          reviewCacheTelemetry.push(entry as Record<string, unknown>);
        },
      },
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => null,
        updateCheckpointCommentId: () => undefined,
        deleteCheckpoint: () => undefined,
      }) as never,
      reviewPromptDerivedCacheOptions: {
        store: failingStore,
      },
      reviewPromptBuilder: (context) => {
        promptBuilderCalls += 1;
        return {
          text: `prompt:${context.changedFiles.join(",")}:${context.customInstructions ?? "none"}`,
          sections: [
            {
              sectionName: "review-pr-context",
              sectionPosition: 0,
              charCount: 10,
              estimatedTokens: 3,
            },
          ],
        };
      },
      logger: logger as never,
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 101,
          draft: false,
          title: "Retry prompt cache miss",
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

    expect(queuedRetryJob).toBeDefined();
    await queuedRetryJob!(queueMetadata);

    expect(promptBuilderCalls).toBe(2);
    expect(promptTexts).toHaveLength(2);
    expect(promptTexts[0]).not.toBe(promptTexts[1]);
    expect(promptTexts[1]).toContain("This is a retry of a timed-out review with reduced scope.");
    expect(
      entries.some((entry) => entry.message === "Review derived prompt cache degraded; bypassing cache for this request"),
    ).toBeTrue();
    expect(
      entries.filter((entry) => entry.message === "Resolved review prompt derived-cache state").every((entry) => entry.data?.gateResult === "degraded"),
    ).toBeTrue();
    expect(reviewCacheTelemetry.some((entry) =>
      entry.cacheSurface === "review-derived-prompt"
      && entry.status === "degraded"
      && entry.reason === "bookkeeping-failure"
      && typeof entry.bookkeepingErrorCount === "number"
      && entry.bookkeepingErrorCount > 0
    )).toBeTrue();

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
      recordReviewCacheEvent?: (entry: Record<string, unknown>) => void;
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
      recordReviewCacheEvent?: (entry: Record<string, unknown>) => void;
    };
    knowledgeStoreOverrides?: Record<string, unknown>;
    configYaml?: string;
    retriever?: ReturnType<typeof createRetriever>;
    contributorProfileStore?: ContributorProfileStore;
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        ?? "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: true\n",
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
      contributorProfileStore: params.contributorProfileStore as never,
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

  async function captureReviewRetrievalQueries(params: {
    issuesAndPullRequests: (params: { q: string; per_page: number }) => Promise<{ data: { total_count: number } }>;
    contributorProfileStore?: ContributorProfileStore;
  }): Promise<{ executeCount: number; queries: string[] }> {
    const queries: string[] = [];

    const retriever = createRetriever({
      embeddingProvider: {
        model: "test",
        dimensions: 1,
        generate: async (query: string) => {
          queries.push(query);
          const variantId = query.includes("files:")
            ? 2
            : query.includes("languages:") || query.includes("risk:") || query.includes("type:")
              ? 3
              : 1;
          return {
            embedding: new Float32Array([variantId]),
            model: "test",
            dimensions: 1,
          };
        },
      } as never,
      isolationLayer: {
        retrieveWithIsolation: async () => ({
          results: [],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 0,
            query: { repo: "acme/repo", topK: 2, threshold: 0.3 },
          },
        }),
      } as never,
      config: {
        retrieval: { enabled: true, topK: 2, distanceThreshold: 0.3, adaptive: true, maxContextChars: 240 },
        sharing: { enabled: false },
      },
    });

    const { executeCount } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: params.issuesAndPullRequests,
      contributorProfileStore: params.contributorProfileStore,
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
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
      retriever,
    });

    return { executeCount, queries };
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
    const searchTelemetryEvents = rateLimitEvents.filter((event) => event.eventType === "pull_request.review_requested");
    expect(searchTelemetryEvents).toHaveLength(1);
    expect(searchTelemetryEvents[0]?.cacheHitRate).toBe(0);
    expect(searchTelemetryEvents[0]?.retryAttempts).toBe(1);
    expect(searchTelemetryEvents[0]?.skippedQueries).toBe(0);
    expect(searchTelemetryEvents[0]?.degradationPath).toBe("none");
  });

  test("records bounded retrieval embedding cache telemetry beside legacy rate-limit reuse telemetry", async () => {
    const rateLimitEvents: Array<Record<string, unknown>> = [];
    const reviewCacheTelemetry: Array<Record<string, unknown>> = [];
    const retriever = {
      retrieve: async () => ({
        findings: [],
        reviewPrecedents: [],
        wikiKnowledge: [],
        unifiedResults: [],
        contextWindow: "",
        provenance: {
          embeddingRequests: 1,
          embeddingCacheHits: 2,
        },
      }),
    };

    const { executeCount } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => ({ data: { total_count: 5 } }),
      retriever: retriever as never,
      telemetryStore: {
        recordRateLimitEvent: (entry) => {
          rateLimitEvents.push(entry);
        },
        recordReviewCacheEvent: (entry) => {
          reviewCacheTelemetry.push(entry);
        },
      },
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
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
    });

    expect(executeCount).toBe(1);
    expect(rateLimitEvents.some((event) => event.eventType === "reuse.retrieval-query-embedding.main")).toBeTrue();
    const retrievalRows = reviewCacheTelemetry.filter((entry) => entry.cacheSurface === "retrieval-query-embedding");
    expect(retrievalRows).toEqual([
      {
        deliveryId: "delivery-123",
        repo: "acme/repo",
        prNumber: 101,
        cacheSurface: "retrieval-query-embedding",
        status: "hit",
        reason: "safe-reuse",
        fingerprintVersion: "retrieval-query-embedding-v1",
        safetySignalNames: ["embedding-cache-provenance"],
      },
    ]);
    expect(JSON.stringify(reviewCacheTelemetry)).not.toContain("contextWindow");
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
    const searchTelemetryEvents = rateLimitEvents.filter((event) => event.eventType === "pull_request.review_requested");
    const emittedIdentities = new Set(
      searchTelemetryEvents.map((event) => `${event.deliveryId}:${event.eventType}`),
    );
    expect(searchTelemetryEvents).toHaveLength(1);
    expect(emittedIdentities.size).toBe(1);
    expect(searchTelemetryEvents[0]?.deliveryId).toBe("delivery-123");
    expect(searchTelemetryEvents[0]?.eventType).toBe("pull_request.review_requested");
    expect(searchTelemetryEvents[0]?.cacheHitRate).toBe(0);
    expect(searchTelemetryEvents[0]?.retryAttempts).toBe(1);
    expect(searchTelemetryEvents[0]?.skippedQueries).toBe(1);
    expect(searchTelemetryEvents[0]?.degradationPath).toBe("search-api-rate-limit");
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
    const searchTelemetryIdentities = emittedIdentities.filter((identity) => identity.endsWith(":pull_request.review_requested"));
    expect(searchTelemetryIdentities).toHaveLength(1);
    expect(searchTelemetryIdentities[0]).toBe("delivery-123:pull_request.review_requested");
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
    const searchTelemetryEvents = rateLimitEvents.filter((event) => event.eventType === "pull_request.review_requested");
    expect(searchTelemetryEvents).toHaveLength(1);
    expect(searchTelemetryEvents[0]?.cacheHitRate).toBe(0);
  });

  test("ignores unsupported cached contributor tiers and falls back to live classification", async () => {
    let searchCallCount = 0;

    const { executeCount, prompt } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        searchCallCount += 1;
        return { data: { total_count: 0 } };
      },
      knowledgeStoreOverrides: {
        getAuthorCache: () => ({
          tier: "established",
          prCount: 24,
        }),
      },
    });

    expect(executeCount).toBe(1);
    expect(searchCallCount).toBe(1);
    expect(prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(prompt).toContain("only coarse fallback signals");
    expect(prompt).not.toContain("first-time or new contributor");
    expect(prompt).not.toContain("established contributor");
    expect(prompt).not.toContain("core/senior contributor");
  });

  test("cached core tier keeps coarse-fallback handler wording on cache hits", async () => {
    const { executeCount, prompt } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        throw new Error("search should not execute when author classification cache is hit");
      },
      knowledgeStoreOverrides: {
        getAuthorCache: () => ({
          tier: "core",
          prCount: 12,
        }),
      },
    });

    expect(executeCount).toBe(1);
    expect(prompt).toContain("Contributor-experience contract: coarse-fallback.");
    expect(prompt).toContain("only coarse fallback signals");
    expect(prompt).not.toContain("first-time or new contributor");
    expect(prompt).not.toContain("developing contributor with growing familiarity");
    expect(prompt).not.toContain("core/senior contributor of this repository.");
  });

  test("contributor profile established tier beats contradictory cached low-tier data in handler output", async () => {
    const { executeCount, prompt } = await runSingleAuthorTierEvent({
      issuesAndPullRequests: async () => {
        throw new Error("search should not execute when contributor profile is present");
      },
      knowledgeStoreOverrides: {
        getAuthorCache: () => ({
          tier: "regular",
          prCount: 4,
        }),
      },
      contributorProfileStore: {
        getByGithubUsername: async (login: string) => login === "octocat"
          ? buildContributorProfileFixture({ overallTier: "established" })
          : null,
        getExpertise: async () => [],
      } as never,
    });

    expect(executeCount).toBe(1);
    expect(prompt).toContain("The PR author (octocat) is an established contributor.");
    expect(prompt).toContain("Keep explanations brief — one sentence on WHY, then the suggestion");
    expect(prompt).not.toContain("first-time or new contributor");
    expect(prompt).not.toContain("developing contributor with growing familiarity");
    expect(prompt).not.toContain("core/senior contributor of this repository.");
  });

  test("degraded retry path keeps resolved established tier in rebuilt prompt output", async () => {
    let searchCallCount = 0;

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
      contributorProfileStore: {
        getByGithubUsername: async (login: string) => login === "octocat"
          ? buildContributorProfileFixture({ overallTier: "established" })
          : null,
        getExpertise: async () => [],
      } as never,
    });

    expect(searchCallCount).toBe(0);
    expect(executeCount).toBe(1);
    expect(prompt).toContain("The PR author (octocat) is an established contributor.");
    expect(prompt).toContain("Keep explanations brief — one sentence on WHY, then the suggestion");
    expect(prompt).not.toContain("first-time or new contributor");
    expect(prompt).not.toContain("developing contributor with growing familiarity");
    expect(prompt).not.toContain("## Search API Degradation Context");
  });

  test("passes a normalized retrieval hint for profile-backed review retrieval", async () => {
    const { executeCount, queries } = await captureReviewRetrievalQueries({
      issuesAndPullRequests: async () => ({ data: { total_count: 0 } }),
      contributorProfileStore: {
        getByGithubUsername: async () =>
          buildContributorProfileFixture({ overallTier: "newcomer", optedOut: false }),
        getExpertise: async () => [],
      } as never,
    });

    expect(executeCount).toBe(1);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain("author: new contributor");
    expect(queries[0]).not.toContain("newcomer");
    expect(queries[0]).not.toContain("first-time");
  });

  test("omits retrieval hints for generic contributor-experience states", async () => {
    const { executeCount, queries } = await captureReviewRetrievalQueries({
      issuesAndPullRequests: async () => ({ data: { total_count: 9 } }),
      contributorProfileStore: {
        getByGithubUsername: async () =>
          buildContributorProfileFixture({ overallTier: "senior", optedOut: true }),
        getExpertise: async () => [],
      } as never,
    });

    expect(executeCount).toBe(1);
    expect(queries).toHaveLength(2);
    expect(queries[0]).not.toContain("author:");
    expect(queries.join("\n")).not.toMatch(
      /\b(first-time|regular|core|newcomer|developing|established|senior)\b/,
    );
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

    const searchTelemetryEvents = rateLimitEvents.filter((event) => event.eventType === "pull_request.review_requested");
    expect(searchTelemetryEvents).toHaveLength(2);
    expect(searchTelemetryEvents[0]?.cacheHitRate).toBe(0);
    expect(searchTelemetryEvents[1]?.cacheHitRate).toBe(1);
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
    const searchTelemetryEvents = rateLimitEvents.filter((event) => event.eventType === "pull_request.review_requested");
    expect(searchTelemetryEvents).toHaveLength(1);
    expect(searchTelemetryEvents[0]?.cacheHitRate).toBe(0);
  });
});

describe("createReviewHandler synchronize gating", () => {
  async function runSynchronizeScenario(options: {
    configYaml: string;
  }) {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    await Bun.write(`${workspaceFixture.dir}/.kodiai.yml`, options.configYaml);

    let executeCount = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
        execute: async () => {
          executeCount++;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-synchronize-test",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("pull_request.synchronize");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        action: "synchronize",
        pull_request: {
          number: 101,
          draft: false,
          title: "Synchronize trigger test",
          body: "",
          commits: 0,
          additions: 50,
          deletions: 10,
          user: { login: "octocat" },
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "abcdef1234567890",
            ref: "feature/synchronize",
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
    return { executeCount, entries };
  }

  test("synchronize executes when the effective nested trigger is enabled", async () => {
    const { executeCount } = await runSynchronizeScenario({
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "    onSynchronize: true",
        "  skipAuthors: []",
        "  skipPaths: []",
      ].join("\n") + "\n",
    });

    expect(executeCount).toBe(1);
  });

  test("synchronize skips when the effective nested trigger is disabled", async () => {
    const { executeCount, entries } = await runSynchronizeScenario({
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "    onSynchronize: false",
        "  skipAuthors: []",
        "  skipPaths: []",
      ].join("\n") + "\n",
    });

    expect(executeCount).toBe(0);
    expect(
      entries.some((entry) =>
        entry.data?.gate === "review-trigger"
        && entry.data?.skipReason === "trigger-disabled",
      ),
    ).toBe(true);
  });

  test("synchronize skips legacy review.onSynchronize intent because the effective trigger stays disabled", async () => {
    const { executeCount, entries } = await runSynchronizeScenario({
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
                "  onSynchronize: true",
        "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
      ].join("\n") + "\n",
    });

    expect(executeCount).toBe(0);
    expect(
      entries.some((entry) =>
        entry.data?.gate === "review-trigger"
        && entry.data?.skipReason === "trigger-disabled",
      ),
    ).toBe(true);
    expect(
      entries.some((entry) =>
        entry.message === "Config warning detected"
        && Array.isArray(entry.data?.issues)
        && (entry.data?.issues as string[]).some((issue) => issue.includes("review.onSynchronize")),
      ),
    ).toBe(true);
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
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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

describe("createReviewHandler coordinator phase checkpoints", () => {
  test("advances through pre-executor checkpoint phases before dispatching the executor", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const phaseTransitions: string[] = [];
    let phasesSeenAtExecutor: string[] = [];
    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 12_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: Parameters<typeof coordinator.canPublish>[0]) => coordinator.canPublish(attemptId),
      setPhase: (
        attemptId: Parameters<typeof coordinator.setPhase>[0],
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => {
        phaseTransitions.push(phase);
        return coordinator.setPhase(attemptId, phase);
      },
      getSnapshot: (familyKey: Parameters<typeof coordinator.getSnapshot>[0]) => coordinator.getSnapshot(familyKey),
      release: (attemptId: Parameters<typeof coordinator.release>[0]) => coordinator.release(attemptId),
      complete: (attemptId: Parameters<typeof coordinator.complete>[0]) => coordinator.complete(attemptId),
    };

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          createComment: async () => ({ data: { id: 1 } }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          phasesSeenAtExecutor = [...phaseTransitions];
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-phase-checkpoints",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator,
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
          title: "Coordinator phase checkpoints",
          body: "",
          commits: 0,
          additions: 40,
          deletions: 10,
          user: { login: "octocat" },
          author_association: "CONTRIBUTOR",
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "abcdef1234567890",
            ref: "feature/phase-checkpoints",
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

    expect(phasesSeenAtExecutor).toEqual([
      "workspace-create",
      "load-config",
      "incremental-diff",
      "prompt-build",
      "executor-dispatch",
    ]);
    expect(phaseTransitions).toContain("publish");
  });

  test("exposes truthful workspace-create and load-config phases at async boundaries", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const reviewFamilyKey = buildReviewFamilyKey("acme", "repo", 102);
    await Bun.write(
      join(workspaceFixture.dir, ".kodiai.yml"),
      [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
        "  onSynchronize: true",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "",
      ].join("\n"),
    );

    let phaseAtWorkspaceCreate: string | undefined;
    let phaseAtConfigWarning: string | undefined;
    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 13_000;
        return () => ++nowMs;
      })(),
    });

    const logger = {
      info: () => undefined,
      warn: (_data: Record<string, unknown>, message: string) => {
        if (message === "Config warning detected") {
          phaseAtConfigWarning = coordinator.getSnapshot(reviewFamilyKey)?.attempts[0]?.phase;
        }
      },
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger,
    } as unknown as Logger;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => {
        phaseAtWorkspaceCreate = coordinator.getSnapshot(reviewFamilyKey)?.attempts[0]?.phase;
        return {
          dir: workspaceFixture.dir,
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
          createComment: async () => ({ data: { id: 1 } }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          sessionId: "session-phase-boundaries",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: coordinator,
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
        pull_request: {
          number: 102,
          draft: false,
          title: "Coordinator phase boundary checkpoints",
          body: "",
          commits: 0,
          additions: 20,
          deletions: 5,
          user: { login: "octocat" },
          author_association: "CONTRIBUTOR",
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "bcdef1234567890a",
            ref: "feature/phase-boundaries",
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

    expect(phaseAtWorkspaceCreate).toBe("workspace-create");
    expect(phaseAtConfigWarning).toBe("load-config");
  });
});

describe("createReviewHandler phase timing logging", () => {
  async function runPhaseTimingScenario(options: {
    queueMetadata?: JobQueueRunMetadata;
  }) {
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
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(options.queueMetadata ?? createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          createComment: async () => ({ data: { id: 1 } }),
          updateComment: async () => ({ data: {} }),
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          durationMs: 550,
          sessionId: "session-phase-timing",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
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
        pull_request: {
          number: 101,
          draft: false,
          title: "Phase timing contract",
          body: "",
          commits: 0,
          additions: 40,
          deletions: 10,
          user: { login: "octocat" },
          author_association: "CONTRIBUTOR",
          base: { ref: "main", sha: "mainsha" },
          head: {
            sha: "abcdef1234567890",
            ref: "feature/phase-timing",
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

    return { entries, workspaceDir: workspaceFixture.dir };
  }

  test("emits one correlated review phase timing payload with the required six phases", async () => {
    const { entries, workspaceDir } = await runPhaseTimingScenario({
      queueMetadata: createQueueRunMetadata(),
    });

    const matchingEntries = entries.filter((entry) => entry.message === "Review phase timing summary");
    expect(matchingEntries).toHaveLength(1);

    const summary = matchingEntries[0]?.data as {
      deliveryId: string;
      reviewOutputKey: string;
      phases: Array<{ name: string; status: string; durationMs?: number; detail?: string }>;
      totalDurationMs: number;
    };

    expect(summary.deliveryId).toBe("delivery-123");
    expect(summary.reviewOutputKey).toContain("delivery-delivery-123");
    expect(summary.phases.map((phase) => phase.name)).toEqual([
      "queue wait",
      "workspace preparation",
      "retrieval/context assembly",
      "executor handoff",
      "remote runtime",
      "publication",
    ]);
    expect(summary.phases[0]).toEqual({
      name: "queue wait",
      status: "completed",
      durationMs: 250,
    });
    expect(summary.phases[3]).toEqual({
      name: "executor handoff",
      status: "completed",
      durationMs: 50,
    });
    expect(summary.phases[4]).toEqual({
      name: "remote runtime",
      status: "completed",
      durationMs: 500,
    });
    expect(summary.phases[5]).toEqual(expect.objectContaining({
      name: "publication",
      status: "completed",
      durationMs: expect.any(Number),
    }));
    expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(summary)).not.toContain(workspaceDir);
  });

  test("marks queue wait unavailable instead of coercing invalid wait metadata to zero", async () => {
    const { entries } = await runPhaseTimingScenario({
      queueMetadata: createQueueRunMetadata({
        queuedAtMs: 1_000,
        startedAtMs: 900,
        waitMs: -100,
      }),
    });

    const summary = entries.find((entry) => entry.message === "Review phase timing summary")?.data as {
      phases: Array<{ name: string; status: string; durationMs?: number; detail?: string }>;
    };
    const queueWaitPhase = summary.phases.find((phase) => phase.name === "queue wait");

    expect(queueWaitPhase).toEqual({
      name: "queue wait",
      status: "unavailable",
      detail: "invalid queue wait metadata",
    });
  });
});

describe("createReviewHandler ReviewPlan wiring", () => {
  const candidateTitle = "Guard candidate publication";
  const candidateBody = "Publish this approved candidate through the shared inline publisher.";
  const candidateFixReplacementText = "feature fixed by candidate";

  function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function reviewCandidateFingerprint(params: {
    repo: string;
    pullNumber: number;
    reviewOutputKey: string;
    filePath: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
  }): string {
    const canonical = [
      params.repo,
      params.pullNumber,
      params.reviewOutputKey,
      params.filePath,
      params.startLine,
      params.endLine,
      params.severity,
      params.category,
      params.title.toLowerCase(),
    ].join("\u001f");
    return `rcf-${sha256(canonical).slice(0, 16)}`;
  }

  function candidateReviewOutputKey(reviewOutputKey: string, fingerprint: string): string {
    return `${reviewOutputKey}:candidate:${fingerprint}`;
  }

  function formattedCandidateInlineBody(params: {
    severity: string;
    category: string;
    title: string;
    body: string;
  }): string {
    return [
      "```yaml",
      `severity: ${params.severity}`,
      `category: ${params.category}`,
      "```",
      "",
      `**${params.title}**`,
      "",
      params.body,
    ].join("\n");
  }

  function formattedCandidateFixSuggestionBody(params: {
    severity: string;
    category: string;
    title: string;
    fixReplacementText: string;
  }): string {
    return [
      `**Fix suggestion:** ${params.title}`,
      `Severity: ${params.severity} · Category: ${params.category}`,
      "",
      "```suggestion",
      params.fixReplacementText,
      "```",
    ].join("\n");
  }

  function publicationPolicyCandidateKey(params: {
    path: string;
    side: string;
    line?: number;
    startLine?: number;
    reviewOutputKey: string;
    deliveryId: string;
    body: string;
  }): string {
    const material = {
      path: params.path.trim().slice(0, 256),
      side: params.side.trim().slice(0, 32),
      line: params.line ?? null,
      startLine: params.startLine ?? null,
      reviewOutputKey: params.reviewOutputKey.trim().slice(0, 256),
      deliveryId: params.deliveryId.trim().slice(0, 256),
      bodySignal: sha256(params.body.slice(0, 4096)),
    };
    return `m070-publication:${sha256(JSON.stringify(material))}`;
  }

  function buildCandidateVerificationShadowSubflow(
    decision: "verified" | "partially_verified" | "disagreement" = "verified",
    candidate: {
      title?: string;
      body?: string;
      filePath?: string;
      line?: number;
      endLine?: number;
      severity?: string;
      category?: string;
      fixReplacementText?: string;
    } = {},
  ) {
    return async (input: ShadowSpecialistSubflowInput): Promise<ShadowSpecialistSubflowResult> => {
      const baseReviewOutputKey = String(input.reviewOutputKey ?? "");
      const title = candidate.title ?? candidateTitle;
      const body = candidate.body ?? candidateBody;
      const filePath = candidate.filePath ?? "README.md";
      const line = candidate.line ?? 2;
      const endLine = candidate.endLine ?? line;
      const severity = candidate.severity ?? "major";
      const category = candidate.category ?? "correctness";
      const fixReplacementText = candidate.fixReplacementText ?? candidateFixReplacementText;
      const fingerprint = reviewCandidateFingerprint({
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: baseReviewOutputKey,
        filePath,
        startLine: line,
        endLine,
        severity,
        category,
        title,
      });
      const candidateKey = publicationPolicyCandidateKey({
        path: filePath,
        side: "RIGHT",
        ...(line === endLine ? { line } : { startLine: line, line: endLine }),
        reviewOutputKey: candidateReviewOutputKey(baseReviewOutputKey, fingerprint),
        deliveryId: String(input.deliveryId ?? ""),
        body: formattedCandidateFixSuggestionBody({
          severity,
          category,
          title,
          fixReplacementText,
        }),
      });
      return {
        trigger: {
          status: "triggered",
          laneId: "docs-config-truth",
          skipReason: null,
          degradedReason: null,
          errorKind: null,
          matchedPaths: [filePath],
          candidateCount: 1,
          selectedLaneCount: 1,
          shadowOnly: true,
          publishesFindings: false,
          correlationKey: input.correlationKey ?? null,
          metrics: { decisionCount: 1, duplicateCount: 0, disagreementCount: decision === "disagreement" ? 1 : 0, tokenCountAvailable: false, costAvailable: false, latencyMsAvailable: false },
        },
        output: {
          laneId: "docs-config-truth",
          status: "ok",
          skipReason: null,
          degradedReasons: [],
          errorKind: null,
          evidence: [{ candidateKey, decision, evidenceId: "review-plan-shadow-evidence-1" }],
          candidateCount: 1,
          truncatedCandidateCount: 0,
          decisionCounts: { candidate: decision === "disagreement" ? 0 : 1, duplicate: 0, disagreement: decision === "disagreement" ? 1 : 0, dismissed: 0, unclassifiable: 0 },
          duplicateCount: 0,
          disagreementCount: decision === "disagreement" ? 1 : 0,
          metricAvailability: { tokenCount: "unavailable", costUsd: "unavailable", latencyMs: "unavailable" },
          metrics: { decisionCount: 1, duplicateCount: 0, disagreementCount: decision === "disagreement" ? 1 : 0, tokenCountAvailable: false, costAvailable: false, latencyMsAvailable: false },
          deliveryId: input.deliveryId ?? null,
          reviewOutputKey: input.reviewOutputKey ?? null,
          correlationKey: input.correlationKey ?? null,
          redactionFlags: { unsafeFieldCount: 0, discardedRawPayload: false, discardedPublicationFields: false, discardedApprovalFields: false },
          shadowOnly: true,
          publishesFindings: false,
        } as never,
        durationMs: 1,
        laneId: "docs-config-truth",
        triggerStatus: "triggered",
        skipReason: null,
        degradedReason: null,
        errorKind: null,
        timeoutReason: null,
        errorReason: null,
        unclassifiableReason: null,
        deliveryId: input.deliveryId ?? null,
        reviewOutputKey: input.reviewOutputKey ?? null,
        correlationKey: input.correlationKey ?? null,
        candidateCount: 1,
        decisionCount: 1,
        duplicateCount: 0,
        disagreementCount: decision === "disagreement" ? 1 : 0,
        metricAvailability: { tokenCount: "unavailable", costUsd: "unavailable", latencyMs: "unavailable" },
        redactionFlags: { unsafeFieldCount: 0, discardedRawPayload: false, discardedPublicationFields: false, discardedApprovalFields: false },
        shadowOnly: true,
        publishesFindings: false,
      };
    };
  }

  function candidateFindingResult() {
    return {
      status: "shadow",
      repo: "acme/repo",
      pullNumber: 101,
      reviewOutputKey: "rk_safe",
      deliveryId: "delivery-123",
      artifactPresent: true,
      findings: [
        {
          filePath: "README.md",
          startLine: 2,
          endLine: 2,
          severity: "major",
          category: "correctness",
          title: candidateTitle,
          body: candidateBody,
          fixReplacementText: candidateFixReplacementText,
        },
      ],
      rejections: [],
    };
  }

  async function runReviewPlanScenario(params: {
    reviewPlanBuilder?: typeof buildReviewPlan;
    reviewReducer?: (input: ReviewReducerInput) => Promise<ReviewReducerResult>;
    graphValidationEnabled?: boolean;
    reviewGraphQuery?: (input: {
      repo: string;
      workspaceKey: string;
      changedPaths: string[];
      limit?: number;
    }) => Promise<ReviewGraphBlastRadiusResult>;
    extraChangedFiles?: number;
    maxComments?: number;
    candidateFindingResult?: Record<string, unknown>;
    directReviewComments?: Array<Record<string, unknown>>;
    executorPublished?: boolean;
    exposeSummaryComment?: boolean;
    shadowSpecialistSubflow?: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
  } = {}) {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture({
      graphValidationEnabled: params.graphValidationEnabled,
      extraChangedFiles: params.extraChangedFiles,
      maxComments: params.maxComments,
    });
    const { logger, entries } = createCaptureLogger();

    let executeStarted = false;
    let updatedSummaryBody: string | undefined;
    const executeCalls: Array<Record<string, unknown>> = [];
    const promptBuildContexts: Array<Record<string, unknown>> = [];
    const recordReviewEntries: Array<Record<string, unknown>> = [];
    const recordFindingEntries: Array<Record<string, unknown>> = [];
    const createdReviewComments: Array<Record<string, unknown>> = [];
    const createdIssueComments: Array<Record<string, unknown>> = [];

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const summaryBody = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      "- Reviewed the fixture change.",
      "",
      "</details>",
      "",
      buildReviewOutputMarker(reviewOutputKey),
    ].join("\n");

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir: workspaceFixture.dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    };

    let postExecuteReviewCommentListCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            if (!executeStarted) return { data: [] };
            postExecuteReviewCommentListCalls += 1;
            return {
              data: postExecuteReviewCommentListCalls === 1
                ? (params.directReviewComments ?? [])
                : [],
            };
          },
          listReviews: async () => ({ data: [] }),
          listCommits: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234567890" } } }),
          createReviewComment: async (commentParams: Record<string, unknown>) => {
            const id = 1200 + createdReviewComments.length;
            createdReviewComments.push({ ...commentParams, id });
            return { data: { id, path: commentParams.path, html_url: `https://example.test/comment/${id}` } };
          },
        },
        issues: {
          listComments: async () => ({ data: executeStarted && params.exposeSummaryComment !== false ? [{ id: 991, body: summaryBody }] : [] }),
          createComment: async (commentParams: Record<string, unknown>) => {
            const id = 992 + createdIssueComments.length;
            createdIssueComments.push({ ...commentParams, id });
            return { data: { id } };
          },
          updateComment: async (updateParams: { body: string }) => {
            updatedSummaryBody = updateParams.body;
            return { data: {} };
          },
        },
        reactions: { createForIssue: async () => ({ data: {} }) },
        search: { issuesAndPullRequests: async () => ({ data: { total_count: 4 } }) },
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
        execute: async (context: Record<string, unknown>) => {
          executeStarted = true;
          executeCalls.push(context);
          return {
            conclusion: "success",
            published: params.executorPublished ?? true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-review-plan",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "end_turn",
            ...(params.candidateFindingResult === undefined ? {} : { candidateFinding: params.candidateFindingResult }),
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        recordReview: async (entry: Record<string, unknown>) => {
          recordReviewEntries.push(entry);
          return 1;
        },
        recordFindings: async (entries: Record<string, unknown>[]) => {
          recordFindingEntries.push(...entries);
        },
      }) as never,
      reviewPromptBuilder: (context: Record<string, unknown>) => {
        promptBuildContexts.push(context);
        return {
          text: "safe test prompt",
          sections: [
            {
              sectionName: "review-pr-context",
              sectionPosition: 0,
              charCount: 16,
              estimatedTokens: 4,
            },
          ],
        };
      },
      ...(params.reviewGraphQuery ? { reviewGraphQuery: params.reviewGraphQuery } : {}),
      ...(params.reviewPlanBuilder ? { reviewPlanBuilder: params.reviewPlanBuilder } : {}),
      ...(params.reviewReducer ? { reviewReducer: params.reviewReducer } : {}),
      ...(params.shadowSpecialistSubflow ? { shadowSpecialistSubflow: params.shadowSpecialistSubflow } : {}),
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }));
    await workspaceFixture.cleanup();

    return { updatedSummaryBody, executeCalls, promptBuildContexts, recordReviewEntries, recordFindingEntries, createdReviewComments, createdIssueComments, logEntries: entries };
  }

  function buildGraphBlastRadiusFixture(changedPaths: string[]): ReviewGraphBlastRadiusResult {
    return {
      changedFiles: changedPaths,
      seedSymbols: changedPaths.map((filePath, index) => ({
        stableKey: `seed-${index}`,
        symbolName: `seed${index}`,
        qualifiedName: `seed${index}`,
        filePath,
      })),
      impactedFiles: [
        {
          path: "README.md",
          score: 0.9,
          confidence: 0.8,
          reasons: ["test-fixture"],
          relatedChangedPaths: changedPaths,
          languages: ["markdown"],
        },
      ],
      probableDependents: [],
      likelyTests: [],
      graphStats: {
        files: changedPaths.length,
        nodes: changedPaths.length,
        edges: changedPaths.length,
        changedFilesFound: changedPaths.length,
      },
    };
  }

  test("default graph-validation config reports skipped in Review Details, logs, and knowledge snapshot", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario();

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock).toContain("graph=skipped");

    const readyLog = logEntries.find((entry) => entry.data?.gate === "review-plan");
    expect(readyLog?.data?.graphValidationStatus).toBe("skipped");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewPlan as Record<string, unknown>).graphValidationStatus).toBe("skipped");
  });

  test("enabled graph validation without reviewGraphQuery reports unavailable and still dispatches executor", async () => {
    const { updatedSummaryBody, executeCalls, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      graphValidationEnabled: true,
    });

    expect(executeCalls).toHaveLength(1);
    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock).toContain("graph=unavailable");

    const readyLog = logEntries.find((entry) => entry.data?.gate === "review-plan");
    expect(readyLog?.data?.graphValidationStatus).toBe("unavailable");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewPlan as Record<string, unknown>).graphValidationStatus).toBe("unavailable");
  });

  test("enabled graph validation with graph prerequisites reports enabled rather than graph-selection state", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      graphValidationEnabled: true,
      extraChangedFiles: 3,
      reviewGraphQuery: async (input) => buildGraphBlastRadiusFixture(input.changedPaths),
    });

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock).toContain("graph=enabled");

    const readyLog = logEntries.find((entry) => entry.data?.gate === "review-plan");
    expect(readyLog?.data?.graphValidationStatus).toBe("enabled");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewPlan as Record<string, unknown>).graphValidationStatus).toBe("enabled");
  });

  test("review runs prefer candidate capture and pass optional prompt context", async () => {
    const { updatedSummaryBody, executeCalls, promptBuildContexts } = await runReviewPlanScenario();

    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]?.enableCandidateFindingTool).toBe(true);
    expect(promptBuildContexts[0]?.candidateFindingToolName).toBe("record_candidate_finding");
    expect(promptBuildContexts[0]?.candidateFindingMode).toBe("preferred");

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock).toContain("candidates=preferred");
  });

  test("candidate finding result is projected once into Review Details, logs, and safe snapshots", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      candidateFindingResult: {
        status: "shadow",
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: "rk_safe",
        deliveryId: "delivery-123",
        artifactPresent: true,
        artifactBasename: "candidate-findings.jsonl",
        counts: { input: 3, recorded: 2, rejected: 1, errors: 0 },
        findings: [
          {
            title: "RAW TITLE MUST NOT LEAK",
            body: "RAW BODY MUST NOT LEAK",
            filePath: "/tmp/workspace/src/secret.ts",
          },
        ],
        rejections: [],
      },
    });

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review candidates:/g) ?? []).toHaveLength(1);
    expect(detailsBlock.match(/Review validation truth:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review validation truth: status=empty");
    expect(detailsBlock).toMatch(/counts=detected:\d+,suggested:\d+,validated:\d+,revalidated:\d+,resolved:\d+,blocked:\d+,degraded:\d+,open:\d+,uncertain:\d+,inputFindings:\d+,unsafeInputFields:\d+/);
    expect(detailsBlock).toContain("evidence=fresh:");
    expect(detailsBlock).toContain("correlation=reviewOutputKey:y,deliveryId:y");
    expect(detailsBlock).toContain("redaction=privateOnly:y,rawPrompts:n,rawModelOutput:n,candidateBodies:n,replacementText:n,toolPayloads:n,secretLike:n,diffs:n,unboundedArrays:n");
    expect(detailsBlock).toContain("Review candidates: shadow recorded=2 rejected=1 errors=0 artifact=present");
    expect(detailsBlock).not.toContain("RAW TITLE MUST NOT LEAK");
    expect(detailsBlock).not.toContain("RAW BODY MUST NOT LEAK");
    expect(detailsBlock).not.toContain("/tmp/workspace");

    const candidateLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-finding");
    expect(candidateLog?.data).toEqual(expect.objectContaining({
      gateResult: "shadow",
      status: "shadow",
      recorded: 2,
      rejected: 1,
      errors: 0,
      artifactPresent: true,
    }));
    expect(JSON.stringify(candidateLog?.data)).not.toContain("RAW TITLE MUST NOT LEAK");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect(configSnapshot.reviewCandidateFinding).toEqual({
      status: "shadow",
      recorded: 2,
      rejected: 1,
      errors: 0,
      artifactPresent: true,
    });
    expect(JSON.stringify(configSnapshot)).not.toContain("RAW BODY MUST NOT LEAK");
    expect(JSON.stringify(configSnapshot)).not.toContain("/tmp/workspace");
  });

  test("candidate reducer drafts get unique synthetic ids before reducer processing", async () => {
    const firstTitle = "First candidate with unique reducer id";
    const secondTitle = "Second candidate with unique reducer id";
    const seenCandidateIds: number[] = [];

    await runReviewPlanScenario({
      executorPublished: false,
      exposeSummaryComment: false,
      candidateFindingResult: {
        status: "shadow",
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: "rk_safe",
        deliveryId: "delivery-123",
        artifactPresent: true,
        counts: { input: 2, recorded: 2, rejected: 0, errors: 0 },
        findings: [
          {
            filePath: "README.md",
            startLine: 2,
            endLine: 2,
            severity: "major",
            category: "correctness",
            title: firstTitle,
            body: `${firstTitle} body is safe and grounded.`,
            fingerprint: "rcf-1111111111111111",
          },
          {
            filePath: "README.md",
            startLine: 3,
            endLine: 3,
            severity: "major",
            category: "correctness",
            title: secondTitle,
            body: `${secondTitle} body is safe and grounded.`,
            fingerprint: "rcf-2222222222222222",
          },
        ],
        rejections: [],
      },
      reviewReducer: async (input) => {
        seenCandidateIds.push(
          ...input.findings
            .filter((finding) => typeof finding.candidateFingerprint === "string")
            .map((finding) => finding.commentId),
        );
        return createDegradedReviewReducerResult({ findings: input.findings, reason: "test-stop-after-input-capture" });
      },
    });

    expect(seenCandidateIds).toHaveLength(2);
    expect(new Set(seenCandidateIds).size).toBe(2);
    expect(seenCandidateIds.every((id) => Number.isInteger(id) && id < 0)).toBe(true);
  });

  test("approved candidate findings publish through the shared inline publisher and become stored findings", async () => {
    const { createdReviewComments, recordReviewEntries, recordFindingEntries, logEntries } = await runReviewPlanScenario({
      executorPublished: false,
      exposeSummaryComment: false,
      shadowSpecialistSubflow: buildCandidateVerificationShadowSubflow("verified"),
      candidateFindingResult: candidateFindingResult(),
      reviewReducer: async (input) => {
        const visible = input.findings.filter((finding) => typeof finding.candidateFingerprint === "string");
        return {
          status: "ready",
          findings: visible,
          visibleFindings: visible,
          filteredInlineFindings: [],
          lowConfidenceFindings: [],
          suppressionMatchCounts: new Map(),
          filterRecords: [],
          counts: {
            input: input.findings.length,
            kept: visible.length,
            suppressed: 0,
            rewritten: 0,
            deprioritized: 0,
            lowConfidence: 0,
            auditEvents: 0,
            severityDemoted: 0,
            graphValidated: 0,
            graphUncertain: 0,
          },
          audit: [],
          detailsSummary: {
            label: "Review reducer",
            status: "ready",
            text: "Review reducer: ready input=1 kept=1 suppressed=0 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=0 severityDemoted=0 graphValidated=0 graphUncertain=0",
          },
        };
      },
    });

    expect(createdReviewComments).toHaveLength(1);
    expect(createdReviewComments[0]?.path).toBe("README.md");
    expect(createdReviewComments[0]?.line).toBe(2);
    expect(String(createdReviewComments[0]?.body)).toContain(candidateTitle);
    expect(String(createdReviewComments[0]?.body)).toContain("```suggestion");
    expect(String(createdReviewComments[0]?.body)).toContain(candidateFixReplacementText);
    expect(String(createdReviewComments[0]?.body)).not.toContain(candidateBody);

    expect(recordReviewEntries[0]?.findingsTotal).toBe(1);
    expect(recordFindingEntries).toHaveLength(1);
    expect(recordFindingEntries[0]?.commentId).toBe(1200);
    expect(recordFindingEntries[0]?.filePath).toBe("README.md");

    const publicationLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-publication");
    expect(publicationLog?.data?.gateResult).toBe("candidate-approved");
    expect(publicationLog?.data?.counts).toEqual(expect.objectContaining({
      candidatePublished: 1,
      directPublished: 0,
      fallbackEvidence: 0,
    }));

    const fixEligibilityLog = logEntries.find((entry) => entry.data?.gate === "review-fix-eligibility");
    expect(fixEligibilityLog?.data).toEqual(expect.objectContaining({
      gateResult: "eligible",
      reviewOutputKey: expect.any(String),
      deliveryId: "delivery-123",
      counts: expect.objectContaining({ input: 1, eligible: 1, blocked: 0 }),
      reasonCounts: { eligible: 1 },
      redaction: expect.objectContaining({
        privateOnly: true,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        candidateBodiesIncluded: false,
        secretDetected: false,
      }),
    }));

    const validationTruthLog = logEntries.find((entry) => entry.data?.gate === "review-validation-truth");
    expect(validationTruthLog?.data).toEqual(expect.objectContaining({
      gateResult: "normalized",
      source: "automatic-review",
      reviewOutputKey: expect.any(String),
      deliveryId: "delivery-123",
      counts: expect.objectContaining({ detected: 2, suggested: 2, resolved: 0, degraded: 0 }),
      reasonCounts: expect.objectContaining({
        "suggested-but-open": 2,
        "validation-missing": 2,
      }),
      evidenceFreshness: expect.objectContaining({ missingValidation: 2, missingRevalidation: 2 }),
      redaction: expect.objectContaining({
        privateOnly: true,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        candidateBodiesIncluded: false,
        replacementTextIncluded: false,
        toolPayloadsIncluded: false,
        diffsIncluded: false,
      }),
    }));
    expect(JSON.stringify(validationTruthLog?.data)).not.toContain(candidateBody);
    expect(JSON.stringify(validationTruthLog?.data)).not.toContain(candidateFixReplacementText);

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewCandidatePublication as Record<string, unknown>).mode).toBe("candidate-approved");
    expect(configSnapshot.reviewCandidatePublicationFlow).toEqual(expect.objectContaining({
      publishedCommentIds: [1200],
      convertedProcessedFindingCount: 1,
      hasFabricatedProcessedFindings: false,
    }));
    expect(JSON.stringify(configSnapshot)).not.toContain(candidateBody);
  });

  test("approved candidate findings are blocked when handler publication lacks matching verification evidence", async () => {
    const { createdReviewComments, recordReviewEntries, recordFindingEntries, logEntries } = await runReviewPlanScenario({
      executorPublished: false,
      exposeSummaryComment: false,
      candidateFindingResult: candidateFindingResult(),
      reviewReducer: async (input) => {
        const visible = input.findings.filter((finding) => typeof finding.candidateFingerprint === "string");
        return {
          status: "ready",
          findings: visible,
          visibleFindings: visible,
          filteredInlineFindings: [],
          lowConfidenceFindings: [],
          suppressionMatchCounts: new Map(),
          filterRecords: [],
          counts: {
            input: input.findings.length,
            kept: visible.length,
            suppressed: 0,
            rewritten: 0,
            deprioritized: 0,
            lowConfidence: 0,
            auditEvents: 0,
            severityDemoted: 0,
            graphValidated: 0,
            graphUncertain: 0,
          },
          audit: [],
          detailsSummary: {
            label: "Review reducer",
            status: "ready",
            text: "Review reducer: ready input=1 kept=1 suppressed=0 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=0 severityDemoted=0 graphValidated=0 graphUncertain=0",
          },
        };
      },
    });

    expect(createdReviewComments).toHaveLength(0);
    expect(recordReviewEntries[0]?.findingsTotal).toBe(0);
    expect(recordFindingEntries).toHaveLength(0);

    const publicationLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-publication");
    expect(publicationLog?.level).toBe("info");
    expect(publicationLog?.message).toBe("Review candidate publication completed with expected policy block");
    expect(publicationLog?.data?.gateResult).toBe("blocked");
    expect(publicationLog?.data?.counts).toEqual(expect.objectContaining({
      candidatePublished: 0,
      candidateBlocked: 1,
      directPublished: 0,
    }));
  });

  test("candidate publication still publishes inline comments when executor already created the summary comment", async () => {
    const { createdReviewComments, recordReviewEntries, recordFindingEntries, logEntries } = await runReviewPlanScenario({
      executorPublished: true,
      exposeSummaryComment: true,
      shadowSpecialistSubflow: buildCandidateVerificationShadowSubflow("verified"),
      candidateFindingResult: candidateFindingResult(),
      reviewReducer: async (input) => {
        const visible = input.findings.filter((finding) => typeof finding.candidateFingerprint === "string");
        return {
          status: "ready",
          findings: visible,
          visibleFindings: visible,
          filteredInlineFindings: [],
          lowConfidenceFindings: [],
          suppressionMatchCounts: new Map(),
          filterRecords: [],
          counts: {
            input: input.findings.length,
            kept: visible.length,
            suppressed: 0,
            rewritten: 0,
            deprioritized: 0,
            lowConfidence: 0,
            auditEvents: 0,
            severityDemoted: 0,
            graphValidated: 0,
            graphUncertain: 0,
          },
          audit: [],
          detailsSummary: {
            label: "Review reducer",
            status: "ready",
            text: "Review reducer: ready input=1 kept=1 suppressed=0 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=0 severityDemoted=0 graphValidated=0 graphUncertain=0",
          },
        };
      },
    });

    expect(createdReviewComments).toHaveLength(1);
    expect(recordReviewEntries[0]?.findingsTotal).toBe(1);
    expect(recordFindingEntries).toHaveLength(1);

    const publicationLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-publication");
    expect(publicationLog?.data?.gateResult).toBe("candidate-approved");
    expect(publicationLog?.data?.counts).toEqual(expect.objectContaining({
      candidatePublished: 1,
      directPublished: 1,
      fallbackEvidence: 0,
    }));
  });

  test("candidate draft prioritization respects maxComments before inline publication", async () => {
    const { createdReviewComments, recordReviewEntries, recordFindingEntries, logEntries } = await runReviewPlanScenario({
      executorPublished: false,
      exposeSummaryComment: false,
      maxComments: 1,
      shadowSpecialistSubflow: buildCandidateVerificationShadowSubflow("verified", {
        title: "First capped candidate",
        body: "Publish only the strongest candidate after prioritization.",
        fixReplacementText: "feature fixed by strongest candidate",
        severity: "critical",
        category: "security",
      }),
      candidateFindingResult: {
        status: "shadow",
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: "rk_safe",
        deliveryId: "delivery-123",
        artifactPresent: true,
        findings: [
          {
            filePath: "README.md",
            startLine: 2,
            endLine: 2,
            severity: "critical",
            category: "security",
            title: "First capped candidate",
            body: "Publish only the strongest candidate after prioritization.",
            fixReplacementText: "feature fixed by strongest candidate",
          },
          {
            filePath: "README.md",
            startLine: 2,
            endLine: 2,
            severity: "minor",
            category: "style",
            title: "Second capped candidate",
            body: "This candidate should be omitted by the max comment cap.",
            fixReplacementText: "feature fixed by second candidate",
          },
          {
            filePath: "README.md",
            startLine: 2,
            endLine: 2,
            severity: "minor",
            category: "style",
            title: "Third capped candidate",
            body: "This candidate should also be omitted by the max comment cap.",
            fixReplacementText: "feature fixed by third candidate",
          },
        ],
        rejections: [],
      },
    });

    expect(createdReviewComments).toHaveLength(1);
    expect(String(createdReviewComments[0]?.body)).toContain("First capped candidate");
    expect(recordReviewEntries[0]?.findingsTotal).toBe(1);
    expect(recordFindingEntries).toHaveLength(1);

    const publicationLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-publication");
    expect(publicationLog?.data?.counts).toEqual(expect.objectContaining({
      candidatePublished: 1,
      convertedProcessedFindings: 1,
    }));
  });

  test("candidate-published findings are merged with direct inline findings in review bookkeeping", async () => {
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
    const { recordReviewEntries, recordFindingEntries, logEntries, createdReviewComments } = await runReviewPlanScenario({
      executorPublished: true,
      exposeSummaryComment: true,
      shadowSpecialistSubflow: buildCandidateVerificationShadowSubflow("verified", {
        title: "Candidate published finding",
        body: "Keep candidate publication in bookkeeping too.",
        fixReplacementText: candidateFixReplacementText,
      }),
      directReviewComments: [
        {
          id: 777,
          body: [
            "```yaml",
            "severity: MAJOR",
            "category: correctness",
            "```",
            "",
            "**Direct published finding**",
            "Keep direct executor output in bookkeeping when candidate publication also succeeds.",
            "",
            marker,
          ].join("\n"),
          path: "src/direct.ts",
          line: 4,
          start_line: 4,
        },
      ],
      candidateFindingResult: {
        status: "shadow",
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: "rk_safe",
        deliveryId: "delivery-123",
        artifactPresent: true,
        findings: [
          {
            filePath: "README.md",
            startLine: 2,
            endLine: 2,
            severity: "major",
            category: "correctness",
            title: "Candidate published finding",
            body: "Keep candidate publication in bookkeeping too.",
            fixReplacementText: candidateFixReplacementText,
          },
        ],
        rejections: [],
      },
      reviewReducer: async (input) => ({
        status: "ready",
        findings: input.findings,
        visibleFindings: input.findings,
        filteredInlineFindings: [],
        lowConfidenceFindings: [],
        suppressionMatchCounts: new Map(),
        filterRecords: [],
        counts: {
          input: input.findings.length,
          kept: input.findings.length,
          suppressed: 0,
          rewritten: 0,
          deprioritized: 0,
          lowConfidence: 0,
          auditEvents: 0,
          severityDemoted: 0,
          graphValidated: 0,
          graphUncertain: 0,
        },
        audit: [],
        detailsSummary: {
          label: "Review reducer",
          status: "ready",
          text: `Review reducer: ready input=${input.findings.length} kept=${input.findings.length} suppressed=0 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=0 severityDemoted=0 graphValidated=0 graphUncertain=0`,
        },
      }),
    });

    const extractionLog = logEntries.find((entry) => entry.data?.gate === "finding-extraction");
    expect(extractionLog?.data?.extractedCount).toBe(1);
    expect(createdReviewComments).toHaveLength(1);
    expect(recordReviewEntries[0]?.findingsTotal).toBe(2);
    expect(recordFindingEntries.map((entry) => entry.commentId).sort((a, b) => Number(a) - Number(b))).toEqual([777, 1200]);
    expect(recordFindingEntries.map((entry) => entry.title).sort()).toEqual([
      "Candidate published finding",
      "Direct published finding",
    ]);
  });

  test("direct executor publication is audited as fallback and cannot satisfy candidate-approved success", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario();

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock).toContain("Review candidate publication: mode=direct-fallback");
    expect(detailsBlock).toContain("published=0");
    expect(detailsBlock).toContain("directFallback=1");

    const publicationLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-publication");
    expect(publicationLog?.data?.gateResult).toBe("direct-fallback");
    expect(publicationLog?.data?.counts).toEqual(expect.objectContaining({
      candidatePublished: 0,
      directPublished: 1,
      fallbackEvidence: 1,
    }));

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewCandidatePublication as Record<string, unknown>).mode).toBe("direct-fallback");
    expect(JSON.stringify(configSnapshot)).not.toContain("safe test prompt");
    expect(JSON.stringify(configSnapshot)).not.toContain("base\\nfeature");
  });

  test("candidate publication blocks non-commentable fix suggestions without storing draft findings", async () => {
    const { recordReviewEntries, recordFindingEntries, logEntries } = await runReviewPlanScenario({
      executorPublished: false,
      exposeSummaryComment: false,
      candidateFindingResult: {
        status: "shadow",
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: "rk_safe",
        deliveryId: "delivery-123",
        artifactPresent: true,
        findings: [
          {
            filePath: "README.md",
            startLine: 999,
            endLine: 999,
            severity: "major",
            category: "correctness",
            title: "Unpublishable candidate line",
            body: "This line is not commentable in the PR diff.",
            fixReplacementText: "feature fixed on an unpublishable line",
          },
        ],
        rejections: [],
      },
      reviewReducer: async (input) => {
        const visible = input.findings.filter((finding) => typeof finding.candidateFingerprint === "string");
        return {
          status: "ready",
          findings: visible,
          visibleFindings: visible,
          filteredInlineFindings: [],
          lowConfidenceFindings: [],
          suppressionMatchCounts: new Map(),
          filterRecords: [],
          counts: {
            input: input.findings.length,
            kept: visible.length,
            suppressed: 0,
            rewritten: 0,
            deprioritized: 0,
            lowConfidence: 0,
            auditEvents: 0,
            severityDemoted: 0,
            graphValidated: 0,
            graphUncertain: 0,
          },
          audit: [],
          detailsSummary: {
            label: "Review reducer",
            status: "ready",
            text: "Review reducer: ready input=1 kept=1 suppressed=0 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=0 severityDemoted=0 graphValidated=0 graphUncertain=0",
          },
        };
      },
    });

    expect(recordReviewEntries[0]?.findingsTotal).toBe(0);
    expect(recordFindingEntries).toHaveLength(0);

    const publicationLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-publication");
    expect(publicationLog?.data?.gateResult).toBe("blocked");
    expect(publicationLog?.data?.counts).toEqual(expect.objectContaining({
      candidatePublishable: 0,
      candidatePublished: 0,
      candidateFailed: 0,
      convertedProcessedFindings: 0,
    }));

    const fixEligibilityLog = logEntries.find((entry) => entry.data?.gate === "review-fix-eligibility");
    expect(fixEligibilityLog?.data).toEqual(expect.objectContaining({
      gateResult: "blocked",
      counts: expect.objectContaining({ input: 1, eligible: 0, blocked: 1 }),
      reasonCounts: { "line-not-commentable": 1 },
    }));

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewCandidatePublication as Record<string, unknown>).mode).toBe("blocked");
    expect(configSnapshot.reviewCandidatePublicationFlow).toEqual(expect.objectContaining({
      publishedCommentIds: [],
      convertedProcessedFindingCount: 0,
      hasFabricatedProcessedFindings: false,
    }));
    expect(JSON.stringify(configSnapshot)).not.toContain("This line is not commentable");
  });
  test("missing candidate metadata keeps Review Details publication fail-open with unavailable snapshot", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario();

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review candidates:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review candidates: unavailable");

    const candidateLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-finding");
    expect(candidateLog?.data?.gateResult).toBe("unavailable");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect(configSnapshot.reviewCandidateFinding).toEqual({
      status: "unavailable",
      recorded: 0,
      rejected: 0,
      errors: 0,
      artifactPresent: false,
    });
  });

  test("degraded candidate metadata is sanitized and does not block details publication", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      candidateFindingResult: {
        status: "degraded",
        repo: "acme/repo",
        pullNumber: 101,
        reviewOutputKey: "rk_safe",
        deliveryId: "delivery-123",
        artifactPresent: false,
        counts: { errors: 2 },
        findings: [],
        rejections: [],
        reason: "  bad {json} PROMPT_SECRET TOKEN=abc123  ",
      },
    });

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review candidates:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review candidates: degraded");
    expect(detailsBlock).toContain("errors=2");
    expect(detailsBlock).not.toContain("PROMPT_SECRET");
    expect(detailsBlock).not.toContain("TOKEN=abc123");

    const candidateLog = logEntries.find((entry) => entry.data?.gate === "review-candidate-finding");
    expect(candidateLog?.data?.gateResult).toBe("degraded");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect(configSnapshot.reviewCandidateFinding).toEqual({
      status: "degraded",
      recorded: 0,
      rejected: 0,
      errors: 2,
      artifactPresent: false,
      reason: "bad-json-prompt-redacted-token-redacted",
    });
  });

  test("successful review publishes a compact ready Review plan line and preserves executor dispatch inputs", async () => {
    const { updatedSummaryBody, executeCalls, logEntries } = await runReviewPlanScenario();

    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]?.taskType).toBe("review.small-diff");
    expect(executeCalls[0]?.prompt).toBe("safe test prompt");
    expect(executeCalls[0]?.triggerBody).toBe("safe test prompt");
    expect(executeCalls[0]?.totalFiles).toBe(1);
    expect(executeCalls[0]?.reviewOutputKey).toBe(buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    }));

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review plan:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review plan: ready");
    expect(detailsBlock).toContain("task=review.small-diff");
    expect(detailsBlock).toContain("route=tiny-diff");
    expect(detailsBlock).not.toContain("safe test prompt");
    expect(detailsBlock).not.toContain("base\\nfeature");

    const readyLog = logEntries.find((entry) => entry.data?.gate === "review-plan");
    expect(readyLog?.data?.gateResult).toBe("ready");
    expect(readyLog?.data?.planHash).toEqual(expect.any(String));
    expect(readyLog?.data?.taskType).toBe("review.small-diff");
    expect(readyLog?.data).not.toHaveProperty("prompt");
    expect(readyLog?.data).not.toHaveProperty("diffContent");
  });

  test("knowledge configSnapshot contains only safe ReviewPlan metadata", async () => {
    const { recordReviewEntries } = await runReviewPlanScenario();

    expect(recordReviewEntries).toHaveLength(1);
    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    const reviewPlan = configSnapshot.reviewPlan as Record<string, unknown>;

    expect(reviewPlan).toBeDefined();
    expect(reviewPlan.status).toBe("ready");
    expect(reviewPlan.hash).toEqual(expect.any(String));
    expect(reviewPlan.taskType).toBe("review.small-diff");
    expect(reviewPlan.routingReason).toBe("tiny-diff");
    expect(reviewPlan.graphValidationStatus).toEqual(expect.any(String));
    expect(reviewPlan.candidateFindingMode).toEqual(expect.any(String));

    const serialized = JSON.stringify(configSnapshot);
    expect(serialized).not.toContain("safe test prompt");
    expect(serialized).not.toContain("base\\nfeature");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("diffContent");
  });

  test("injected ready review reducer publishes compact details, logs counts, and stores safe snapshot", async () => {
    const { updatedSummaryBody, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      reviewReducer: async (input) => {
        const counts = {
          input: input.findings.length,
          kept: input.findings.length,
          suppressed: 0,
          rewritten: 0,
          deprioritized: 0,
          lowConfidence: 0,
          auditEvents: 0,
          severityDemoted: 0,
          graphValidated: 0,
          graphUncertain: 0,
        };
        return {
          status: "ready",
          findings: input.findings,
          visibleFindings: input.findings,
          filteredInlineFindings: [],
          lowConfidenceFindings: [],
          suppressionMatchCounts: new Map(),
          filterRecords: [],
          counts,
          audit: [],
          detailsSummary: {
            label: "Review reducer",
            status: "ready",
            text: "Review reducer: ready input=0 kept=0 suppressed=0 rewritten=0 deprioritized=0 lowConfidence=0 auditEvents=0 severityDemoted=0 graphValidated=0 graphUncertain=0",
          },
        };
      },
    });

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review reducer:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review reducer: ready");
    expect(detailsBlock).not.toContain("safe test prompt");
    expect(detailsBlock).not.toContain("diff --git");

    const reducerLog = logEntries.find((entry) => entry.data?.gate === "review-reducer");
    expect(reducerLog?.data?.gateResult).toBe("ready");
    expect(reducerLog?.data?.counts).toEqual(expect.objectContaining({ input: 0, kept: 0 }));
    expect(reducerLog?.data?.graphValidation).toEqual(expect.objectContaining({ enabled: false, graphValidated: 0, graphUncertain: 0 }));

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect(configSnapshot.reviewReducer).toEqual({
      status: "ready",
      counts: expect.objectContaining({ input: 0, kept: 0 }),
      reason: undefined,
    });
    expect(JSON.stringify(configSnapshot)).not.toContain("safe test prompt");
    expect(JSON.stringify(configSnapshot)).not.toContain("diffContent");
  });

  test("injected reducer failure degrades fail-open and stores a sanitized reason", async () => {
    const { updatedSummaryBody, executeCalls, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      reviewReducer: async () => {
        throw new Error("boom diff --git PROMPT_SECRET TOKEN=abc123");
      },
    });

    expect(executeCalls).toHaveLength(1);
    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review reducer:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review reducer: degraded");
    expect(detailsBlock).toContain("reason=reducer-exception");
    expect(detailsBlock).not.toContain("PROMPT_SECRET");
    expect(detailsBlock).not.toContain("TOKEN=abc123");
    expect(detailsBlock).not.toContain("diff --git");

    const reducerLog = logEntries.find((entry) => entry.data?.gate === "review-reducer");
    expect(reducerLog?.data?.gateResult).toBe("degraded");
    expect(reducerLog?.data?.reason).toBe("reducer-exception");

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    const reviewReducer = configSnapshot.reviewReducer as Record<string, unknown>;
    expect(reviewReducer.status).toBe("degraded");
    expect(reviewReducer.reason).toBe("reducer-exception");
    expect(JSON.stringify(configSnapshot)).not.toContain("PROMPT_SECRET");
    expect(JSON.stringify(configSnapshot)).not.toContain("TOKEN=abc123");
    expect(JSON.stringify(configSnapshot)).not.toContain("diff --git");
  });

  test("builder failure still dispatches executor and renders a degraded Review plan line", async () => {
    const { updatedSummaryBody, executeCalls, recordReviewEntries, logEntries } = await runReviewPlanScenario({
      reviewPlanBuilder: () => {
        throw new Error("boom raw prompt token diff should not leak");
      },
    });

    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]?.taskType).toBe("review.small-diff");
    expect(executeCalls[0]?.prompt).toBe("safe test prompt");

    const detailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");
    expect(detailsBlock.match(/Review plan:/g) ?? []).toHaveLength(1);
    expect(detailsBlock).toContain("Review plan: degraded");
    expect(detailsBlock).toContain("reason=builder-error");
    expect(detailsBlock).not.toContain("raw prompt");
    expect(detailsBlock).not.toContain("boom raw prompt token diff should not leak");
    expect(detailsBlock).not.toContain("diffContent");

    const degradedLog = logEntries.find((entry) => entry.data?.gate === "review-plan");
    expect(degradedLog?.data?.gateResult).toBe("degraded");
    expect(degradedLog?.data?.planHash).toMatch(/^degraded-/);
    expect(degradedLog?.data?.error).toEqual({ name: "Error", message: "ReviewPlan builder failed" });

    const configSnapshot = JSON.parse(recordReviewEntries[0]?.configSnapshot as string) as Record<string, unknown>;
    expect((configSnapshot.reviewPlan as Record<string, unknown>).status).toBe("degraded");
  });
});

describe("createReviewHandler Review Details phase timing publication", () => {
  test("merges Review Details before later unrelated details blocks in the canonical summary body", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    let updatedSummaryBody: string | undefined;

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const summaryBody = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      "- Found one correctness issue worth fixing before merge.",
      "",
      "</details>",
      "",
      "<details>",
      "<summary>Unrelated downstream section</summary>",
      "",
      "This block should stay after Review Details.",
      "",
      "</details>",
      "",
      buildReviewOutputMarker(reviewOutputKey),
    ].join("\n");

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async () => ({ dir: workspaceFixture.dir, cleanup: async () => undefined }),
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
          listComments: async () => ({ data: [{ id: 77, body: summaryBody }] }),
          createComment: async () => ({ data: { id: 88 } }),
          updateComment: async (params: { comment_id: number; body: string }) => {
            updatedSummaryBody = params.body;
            return { data: {} };
          },
        },
        reactions: { createForIssue: async () => ({ data: {} }) },
        search: { issuesAndPullRequests: async () => ({ data: { total_count: 4 } }) },
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-multi-details-summary",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(buildReviewRequestedEvent({ requested_reviewer: { login: "kodiai[bot]" } }));

    const reviewDetailsIndex = updatedSummaryBody?.indexOf("<summary>Review Details</summary>") ?? -1;
    const unrelatedIndex = updatedSummaryBody?.indexOf("<summary>Unrelated downstream section</summary>") ?? -1;

    expect(reviewDetailsIndex).toBeGreaterThan(-1);
    expect(unrelatedIndex).toBeGreaterThan(-1);
    expect(reviewDetailsIndex).toBeLessThan(unrelatedIndex);

    await workspaceFixture.cleanup();
  });

  test("merges Review Details timings into the published canonical visible surface", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const createdCommentBodies: string[] = [];
    const { logger, entries } = createCaptureLogger();
    let updatedSummaryBody: string | undefined;
    let updatedSummaryCommentId: number | undefined;
    let issueCommentListCalls = 0;

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const summaryBody = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      "- Found one correctness issue worth fixing before merge.",
      "",
      "</details>",
      "",
      buildReviewOutputMarker(reviewOutputKey),
    ].join("\n");

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => {
            issueCommentListCalls += 1;
            return { data: [{ id: 77, body: summaryBody }] };
          },
          createComment: async (params: { body: string }) => {
            createdCommentBodies.push(params.body);
            return { data: { id: 88 } };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            updatedSummaryCommentId = params.comment_id;
            updatedSummaryBody = params.body;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-review-details-append",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
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

    expect(issueCommentListCalls).toBeGreaterThanOrEqual(1);
    expect(updatedSummaryCommentId).toBe(77);
    expect(updatedSummaryBody).toContain("<summary>Kodiai Review Summary</summary>");
    expect(updatedSummaryBody).toContain("## What Changed");
    expect(updatedSummaryBody).toContain("- Found one correctness issue worth fixing before merge.");

    const reviewDetailsBlock = extractReviewDetailsBlock(updatedSummaryBody ?? "");

    expect(reviewDetailsBlock).toContain("<summary>Review Details</summary>");
    expect(reviewDetailsBlock).toContain("- Total wall-clock:");
    expect(reviewDetailsBlock).toContain("- Phase timings:");
    expect(reviewDetailsBlock).toContain("queue wait: 250ms");
    expect(reviewDetailsBlock).toContain("executor handoff: 50ms");
    expect(reviewDetailsBlock).toContain("remote runtime: 500ms");
    expect(reviewDetailsBlock).toContain("publication:");
    expect(updatedSummaryBody?.indexOf("<summary>Kodiai Review Summary</summary>")).toBeLessThan(
      updatedSummaryBody?.indexOf("<summary>Review Details</summary>") ?? Number.POSITIVE_INFINITY,
    );
    expect(updatedSummaryBody).toContain(buildReviewOutputMarker(reviewOutputKey));
    expect(createdCommentBodies).toHaveLength(0);

    const completedLog = entries.find((entry) =>
      entry.data?.gate === "review-details-output" && entry.data?.gateResult === "completed"
    );
    expect(completedLog?.data).toMatchObject({
      reviewOutputKey,
      deliveryId: "delivery-123",
      reviewDetailsPublished: true,
      surfaceKind: "issue_comment",
      hasCommentId: true,
      hasReviewId: false,
    });
    expect(JSON.stringify(completedLog?.data ?? {})).not.toContain("<summary>Review Details</summary>");

    await workspaceFixture.cleanup();
  });

  test("uses degraded fallback Review Details comment only when canonical visible surface update fails", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const createdCommentBodies: string[] = [];
    let updateCommentCalls = 0;

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });

    const summaryBody = [
      "<details>",
      "<summary>Review summary</summary>",
      "",
      "No inline findings were published.",
      "",
      "</details>",
      "",
      buildReviewOutputMarker(reviewOutputKey),
    ].join("\n");

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
      ) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
          listComments: async () => ({ data: [{ id: 77, body: summaryBody }] }),
          createComment: async (params: { body: string }) => {
            createdCommentBodies.push(params.body);
            return { data: { id: 188 } };
          },
          updateComment: async (_params: { comment_id: number; body: string }) => {
            updateCommentCalls += 1;
            throw new Error("canonical update failed");
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-review-details-fallback",
          executorPhaseTimings: [
            { name: "executor handoff", status: "completed", durationMs: 50 },
            { name: "remote runtime", status: "completed", durationMs: 500 },
          ],
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

    expect(updateCommentCalls).toBe(1);
    expect(createdCommentBodies).toHaveLength(1);

    const fallbackCommentBody = createdCommentBodies[0] ?? "";
    const reviewDetailsBlock = extractReviewDetailsBlock(fallbackCommentBody);

    expect(reviewDetailsBlock).toContain("<summary>Review Details</summary>");
    expect(reviewDetailsBlock).toContain(`<!-- kodiai:review-details:${reviewOutputKey} -->`);
    expect(extractReviewOutputKey(reviewDetailsBlock)).toBe(reviewOutputKey);
    expect(reviewDetailsBlock).toContain("- Files reviewed: 1");
    expect(reviewDetailsBlock).toContain("- Lines changed: +1 -0");
    expect(reviewDetailsBlock).toContain("- Findings: 0 critical, 0 major, 0 medium, 0 minor");
    expect(reviewDetailsBlock).toContain("- Total wall-clock:");
    expect(reviewDetailsBlock).toContain("- Phase timings:");
    expect(reviewDetailsBlock).toContain("queue wait: 250ms");
    expect(reviewDetailsBlock).toContain("executor handoff: 50ms");
    expect(reviewDetailsBlock).toContain("remote runtime: 500ms");
    expect(reviewDetailsBlock).toContain("publication:");
    expect(reviewDetailsBlock).toContain("degraded:");
    expect(reviewDetailsBlock).toMatch(/- Review completed: \d{4}-\d{2}-\d{2}T/);
    expect(
      entries.some((entry) => entry.data?.gate === "review-details-output" && entry.data?.gateResult === "degraded-fallback"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler bounded review disclosure", () => {
  const LARGE_PR_SUMMARY_BODY = [
    "<details>",
    "<summary>Kodiai Review Summary</summary>",
    "",
    "## What Changed",
    "- Reviewed core logic changes.",
    "",
    "</details>",
  ].join("\n");

  async function seedHighRiskLargePrWorkspace(dir: string): Promise<void> {
    const boundedDir = join(dir, "src", "bounded");
    await $`mkdir -p ${boundedDir}`.quiet();

    for (let index = 1; index <= 10; index += 1) {
      const content = Array.from(
        { length: 500 },
        (_value, lineIndex) => `int bounded_${index}_${lineIndex} = ${lineIndex};`,
      ).join("\n");
      await Bun.write(join(boundedDir, `bounded-${index}.c`), `${content}\n`);
    }

    await $`git -C ${dir} add src/bounded`.quiet();
    await $`git -C ${dir} commit -m "bounded fixture"`.quiet();
  }

  async function runPublishedBoundedReviewScenario(params: {
    configYaml: string;
    additions: number;
    deletions: number;
    seedLargePr: boolean;
    title: string;
  }): Promise<string | undefined> {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    let executeStarted = false;
    let updatedSummaryBody: string | undefined;

    if (params.seedLargePr) {
      await seedHighRiskLargePrWorkspace(workspaceFixture.dir);
    }

    await Bun.write(join(workspaceFixture.dir, ".kodiai.yml"), params.configYaml);

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
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
    const summaryBody = `${LARGE_PR_SUMMARY_BODY}\n\n${marker}`;

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
              ? [{ id: 9002, body: summaryBody }]
              : [],
          }),
          createComment: async () => ({ data: {} }),
          updateComment: async (updateParams: { body: string }) => {
            updatedSummaryBody = updateParams.body;
            return { data: {} };
          },
        },
        reactions: {
          createForIssue: async () => ({ data: {} }),
        },
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
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
          executeStarted = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-bounded-summary-disclosure",
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
          title: params.title,
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
          additions: params.additions,
          deletions: params.deletions,
          author_association: "NONE",
        },
      }),
    );

    await workspaceFixture.cleanup();
    return updatedSummaryBody;
  }

  test("injects one large-PR disclosure and records explicit-profile timeout skips in Review Details", async () => {
    const updatedSummaryBody = await runPublishedBoundedReviewScenario({
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "  profile: strict",
        "largePR:",
        "  fileThreshold: 10",
        "  fullReviewCount: 5",
        "  abbreviatedCount: 2",
        "timeout:",
        "  autoReduceScope: true",
        "",
      ].join("\n"),
      additions: 100,
      deletions: 0,
      seedLargePr: true,
      title: "Explicit strict bounded review scenario",
    });

    expect(updatedSummaryBody).toBeDefined();
    expect(updatedSummaryBody).toContain(
      "- Requested strict review; effective review remained strict and covered 7/11 changed files via large-PR triage (5 full, 2 abbreviated; 4 not reviewed).",
    );
    expect(
      (updatedSummaryBody?.match(/Requested strict review; effective review remained strict and covered 7\/11 changed files via large-PR triage \(5 full, 2 abbreviated; 4 not reviewed\)\./g) ?? []).length,
    ).toBe(1);
    expect(updatedSummaryBody).toContain("- Requested profile: strict (manual config)");
    expect(updatedSummaryBody).toContain("- Effective profile: strict");
    expect(updatedSummaryBody).toContain("- Timeout auto-reduction: skipped (explicit profile)");
  });

  test("injects one timeout auto-reduction disclosure when a high-risk auto strict review is reduced", async () => {
    const updatedSummaryBody = await runPublishedBoundedReviewScenario({
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "largePR:",
        "  fileThreshold: 10",
        "  fullReviewCount: 5",
        "  abbreviatedCount: 2",
        "timeout:",
        "  autoReduceScope: true",
        "",
      ].join("\n"),
      additions: 100,
      deletions: 0,
      seedLargePr: true,
      title: "Auto strict bounded review scenario",
    });

    expect(updatedSummaryBody).toBeDefined();
    expect(updatedSummaryBody).toContain(
      "- Requested strict review; timeout risk auto-reduced the effective review to minimal and covered 7/11 changed files via large-PR triage (5 full, 2 abbreviated; 4 not reviewed).",
    );
    expect(
      (updatedSummaryBody?.match(/Requested strict review; timeout risk auto-reduced the effective review to minimal and covered 7\/11 changed files via large-PR triage \(5 full, 2 abbreviated; 4 not reviewed\)\./g) ?? []).length,
    ).toBe(1);
    expect(updatedSummaryBody).toContain("- Requested profile: strict (auto, lines changed: 100)");
    expect(updatedSummaryBody).toContain("- Effective profile: minimal");
    expect(updatedSummaryBody).toContain("- Timeout auto-reduction: applied");
  });

  test("keeps published small-review summaries quiet when no bounded disclosure is required", async () => {
    const updatedSummaryBody = await runPublishedBoundedReviewScenario({
      configYaml: [
        "review:",
        "  enabled: true",
        "  autoApprove: false",
                "  triggers:",
        "    onOpened: true",
        "    onReadyForReview: true",
        "    onReviewRequested: true",
        "  skipAuthors: []",
        "  skipPaths: []",
        "",
      ].join("\n"),
      additions: 1,
      deletions: 0,
      seedLargePr: false,
      title: "Small published review scenario",
    });

    expect(updatedSummaryBody).toBeDefined();
    expect(updatedSummaryBody).not.toContain("Requested strict review;");
    expect(updatedSummaryBody).not.toContain("- Requested profile:");
    expect(updatedSummaryBody).not.toContain("- Effective profile:");
    expect(updatedSummaryBody).toContain("- Profile: strict (auto, lines changed: 1)");
  });
});



describe("createReviewHandler failure fallback publication", () => {
  test("defers max-turns checkpoint evidence publicly while continuation is scheduled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const createdCommentBodies: string[] = [];

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        ) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
              createReview: async () => ({ data: {} }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async (params: { body: string }) => {
                createdCommentBodies.push(params.body);
                return { data: { id: 501 } };
              },
              updateComment: async (params: { body: string }) => {
                createdCommentBodies.push(params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          stopReason: "max_turns",
          failureSubtype: "error_max_turns",
          durationMs: 1,
          numTurns: 25,
          sessionId: "session-failure-bounded-first-pass",
          costUsd: 0,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 2,
          summaryDraft: "Found two issues before max-turns.",
          totalFiles: 3,
        }),
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    const combinedBodies = createdCommentBodies.join("\n");
    expect(combinedBodies).not.toContain("**Bounded first-pass review**");
    expect(combinedBodies).not.toContain("stopped at max-turns");
    expect(combinedBodies).not.toContain("follow-up review is pending");

    await workspaceFixture.cleanup();
  });

  test("enables checkpoint preservation for full reviews even when timeout risk is low", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const executeContexts: Array<Record<string, unknown>> = [];

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) =>
          fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
              createReview: async () => ({ data: {} }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 900 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 0 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: Record<string, unknown>) => {
          executeContexts.push(context);
          return {
            conclusion: "success",
            published: false,
            durationMs: 1,
            numTurns: 1,
            sessionId: "session-full-review-checkpoint",
            costUsd: 0,
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub() as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: ["1\t1\tREADME.md", "1\t1\tsrc/a.ts", "1\t1\tsrc/b.ts"],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(executeContexts.length).toBe(1);
    expect(executeContexts[0]).toMatchObject({
      taskType: "review.full",
      enableCheckpointTool: true,
    });

    await workspaceFixture.cleanup();
  });

  test("schedules a reduced-scope retry after max-turns when checkpoint evidence has remaining scope", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const createdCommentBodies: string[] = [];
    const { logger, entries } = createCaptureLogger();
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
              createReview: async () => ({ data: {} }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async (params: { body: string }) => {
                createdCommentBodies.push(params.body);
                return { data: { id: 777 } };
              },
              updateComment: async (params: { body: string }) => {
                createdCommentBodies.push(params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          stopReason: "tool_use",
          failureSubtype: "error_max_turns",
          durationMs: 1,
          numTurns: 25,
          sessionId: "session-max-turns-retry",
          costUsd: 0,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 0,
          summaryDraft: "Reviewed README before max-turns.",
          totalFiles: 3,
        }),
        saveCheckpoint: async () => undefined,
        updateCheckpointCommentId: async () => undefined,
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    const combinedBodies = createdCommentBodies.join("\n");
    expect(combinedBodies).not.toContain("**Bounded first-pass review**");
    expect(combinedBodies).not.toContain("Scheduling a reduced-scope retry.");
    expect(queuedRetryJob).toBeDefined();

    const retryLog = entries.find((entry) => entry.message === "Enqueueing retry with reduced scope");
    expect(retryLog?.data?.retryTimeout).toEqual(expect.any(Number));
    expect(retryLog!.data!.retryTimeout as number).toBeGreaterThan(30);

    await workspaceFixture.cleanup();
  });

  test("does not publish bounded Review Details for max-turns while continuation is scheduled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const issueComments = new Map<number, string>();
    let nextCommentId = 520;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        ) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
              createReview: async () => ({ data: {} }),
            },
            issues: {
              listComments: async () => ({
                data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
              }),
              createComment: async (params: { body: string }) => {
                const id = nextCommentId++;
                issueComments.set(id, params.body);
                return { data: { id } };
              },
              updateComment: async (params: { comment_id: number; body: string }) => {
                issueComments.set(params.comment_id, params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          stopReason: "max_turns",
          failureSubtype: "error_max_turns",
          durationMs: 1,
          numTurns: 25,
          sessionId: "session-failure-bounded-first-pass-details",
          costUsd: 0,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 2,
          summaryDraft: "Found two issues before max-turns.",
          totalFiles: 3,
        }),
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    const combinedBodies = Array.from(issueComments.values()).join("\n");
    expect(combinedBodies).not.toContain("**Bounded first-pass review**");
    expect(combinedBodies).not.toContain("stopped at max-turns");
    expect(combinedBodies).not.toContain("<summary>Review Details</summary>");
    expect(combinedBodies).not.toContain("- Bounded first-pass:");

    await workspaceFixture.cleanup();
  });

  test("does not fall back to standalone bounded Review Details while max-turns continuation is scheduled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const { logger, entries } = createCaptureLogger();

    const issueComments = new Map<number, string>();
    let nextCommentId = 620;
    let failCanonicalUpdate = true;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        ) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
              createReview: async () => ({ data: {} }),
            },
            issues: {
              listComments: async () => ({
                data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
              }),
              createComment: async (params: { body: string }) => {
                const id = nextCommentId++;
                issueComments.set(id, params.body);
                return { data: { id } };
              },
              updateComment: async (params: { comment_id: number; body: string }) => {
                if (failCanonicalUpdate) {
                  failCanonicalUpdate = false;
                  throw new Error("max-turns canonical update failed");
                }
                issueComments.set(params.comment_id, params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          stopReason: "max_turns",
          failureSubtype: "error_max_turns",
          durationMs: 1,
          numTurns: 25,
          sessionId: "session-failure-bounded-first-pass-fallback",
          costUsd: 0,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async () => ({
          reviewOutputKey: "unused-in-test",
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 2,
          summaryDraft: "Found two issues before max-turns.",
          totalFiles: 3,
        }),
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: logger as never,
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    const combinedBodies = Array.from(issueComments.values()).join("\n");
    expect(combinedBodies).not.toContain("**Bounded first-pass review**");
    expect(combinedBodies).not.toContain("<summary>Review Details</summary>");
    expect(
      entries.some((entry) => entry.data?.gate === "review-details-output" && entry.data?.gateResult === "degraded-fallback"),
    ).toBeFalse();

    await workspaceFixture.cleanup();
  });


  test("formats split timeout budget wording for plain timeout error comments", () => {
    const detail = formatTimeoutErrorDetail({
      totalTimeoutSeconds: 535,
      complexityInfo: "Complexity score: 0.09 (files: 3, lines: 3, lang risk: 40%). Risk level: low.",
      hasReviewOutput: false,
      timeoutEstimate: {
        remoteRuntimeBudgetSeconds: 355,
        infraOverheadBudgetSeconds: 180,
        totalTimeoutSeconds: 535,
      },
    });

    expect(detail).toContain("Timed out with no review output.");
    expect(detail).toContain("Timeout budget: remote runtime 355s + infra overhead 180s = total 535s.");
    expect(detail).toContain("PR complexity: Complexity score: 0.09");
  });

  test("formats split timeout budget wording for partial-timeout error comments", () => {
    const detail = formatTimeoutErrorDetail({
      totalTimeoutSeconds: 535,
      complexityInfo: "Complexity score: 0.09 (files: 3, lines: 3, lang risk: 40%). Risk level: low.",
      hasReviewOutput: true,
      timeoutEstimate: {
        remoteRuntimeBudgetSeconds: 355,
        infraOverheadBudgetSeconds: 180,
        totalTimeoutSeconds: 535,
      },
    });

    expect(detail).toContain("Timed out after partial review output.");
    expect(detail).toContain("Timeout budget: remote runtime 355s + infra overhead 180s = total 535s.");
    expect(detail).toContain("PR complexity: Complexity score: 0.09");
  });

  test("falls back to the enforced timeout wording when no split timeout budget applied", () => {
    const detail = formatTimeoutErrorDetail({
      totalTimeoutSeconds: 600,
      complexityInfo: "Complexity score: 0.09 (files: 3, lines: 3, lang risk: 40%). Risk level: low.",
      hasReviewOutput: false,
      timeoutEstimate: null,
    });

    expect(detail).toContain("Timed out with no review output.");
    expect(detail).toContain("Timed out after 600s.");
    expect(detail).not.toContain("Timeout budget: remote runtime");
  });

  test("schedules a retry instead of asking the user to rerun when max-turns fails without published output", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();

    const createdCommentBodies: string[] = [];
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
              createReview: async () => ({ data: {} }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async (params: { body: string }) => {
                createdCommentBodies.push(params.body);
                return { data: { id: 501 } };
              },
              updateComment: async (params: { body: string }) => {
                createdCommentBodies.push(params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          stopReason: "max_turns",
          failureSubtype: "error_max_turns",
          durationMs: 1,
          numTurns: 25,
          sessionId: "session-failure-fallback",
          costUsd: 0,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      diffContextCollector: async () => ({
        changedFiles: ["README.md"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.review_requested");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(queuedRetryJob).toBeDefined();
    expect(createdCommentBodies.join("\n")).not.toContain("Try requesting another review");
    expect(createdCommentBodies.join("\n")).not.toContain("Try requesting another review after narrowing the scope or improving the available review context.");

    await workspaceFixture.cleanup();
  });
});

describe("createReviewHandler canonical continuation-family state", () => {
  test("records blocked canonical state when timeout has no remaining continuation scope", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        ) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 2001 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "error",
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-canonical-timeout-blocked",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async (key: string) => ({
          reviewOutputKey: key,
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 1,
          summaryDraft: "Found one issue before timeout.",
          totalFiles: 1,
          partialCommentId: 2001,
        }),
        saveCheckpoint: async () => undefined,
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-1",
      authoritativeAttemptOrdinal: 1,
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("records continuation-pending canonical state when timeout schedules a retry", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 2101 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-canonical-timeout-retry",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-canonical-timeout-pending",
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
        saveCheckpoint: async () => undefined,
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(queuedRetryJob).toBeDefined();
    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "continuation-pending",
      finalStopReason: "awaiting-continuation",
      projectionStatus: "pending",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("does not enqueue a retry when the base run has no checkpoint or evidence", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 2101 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-canonical-timeout-retry-missing-checkpoint",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-canonical-timeout-pending-missing-checkpoint",
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
        getCheckpoint: async (_key: string) => null,
        deleteCheckpoint: async (_key: string) => undefined,
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(queuedRetryJob).toBeUndefined();

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-1",
      authoritativeAttemptOrdinal: 1,
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("records merged canonical state when retry results merge into the canonical comment", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];
    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 2,
      filesReviewed: ["README.md"],
      summaryDraft: "Found two issues before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["src/a.ts"],
      summaryDraft: "Retry found one more issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 2200;
    const issueComments = new Map<number, string>();
    let exposeContinuationReviewComments = false;

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({
                data: exposeContinuationReviewComments
                  ? [
                      {
                        id: 9201,
                        path: "README.md",
                        body: [
                          "```yaml",
                          "severity: major",
                          "category: correctness",
                          "```",
                          "**Carry forward timeout finding**",
                          "",
                          buildReviewOutputMarker(reviewOutputKey),
                        ].join("\n"),
                      },
                      {
                        id: 9202,
                        path: "src/a.ts",
                        body: [
                          "```yaml",
                          "severity: medium",
                          "category: correctness",
                          "```",
                          "**New continuation finding**",
                          "",
                          buildReviewOutputMarker(reviewOutputKey),
                        ].join("\n"),
                      },
                    ]
                  : [],
              }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({
                data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
              }),
              createComment: async (params: { body: string }) => {
                const id = nextCommentId++;
                issueComments.set(id, params.body);
                return { data: { id } };
              },
              updateComment: async (params: { comment_id: number; body: string }) => {
                issueComments.set(params.comment_id, params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            exposeContinuationReviewComments = true;
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-canonical-retry-merge",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-canonical-root-merge",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
          {
            filePath: "src/b.ts",
            title: "Resolved timeout finding",
            titleFingerprint: "fp-c56af86d",
            severity: "medium",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 502,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );
    await queuedRetryJob!(createQueueRunMetadata());

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("records quiet-settled canonical state when retry settles without a meaningful delta", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];
    const checkpointState = new Map<string, {
      partialCommentId?: number;
      findingCount?: number;
      filesReviewed?: string[];
      summaryDraft?: string;
      totalFiles?: number;
    }>();

    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234567890",
    });
    const retryReviewOutputKey = `${reviewOutputKey}-retry-1`;
    checkpointState.set(reviewOutputKey, {
      findingCount: 1,
      filesReviewed: ["README.md"],
      summaryDraft: "Found one issue before timeout.",
      totalFiles: 3,
    });
    checkpointState.set(retryReviewOutputKey, {
      findingCount: 0,
      filesReviewed: ["README.md"],
      summaryDraft: "Retry confirmed the same issue.",
      totalFiles: 3,
    });

    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
    let nextCommentId = 2300;
    const issueComments = new Map<number, string>();

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({
                data: Array.from(issueComments.entries()).map(([id, body]) => ({ id, body })),
              }),
              createComment: async (params: { body: string }) => {
                const id = nextCommentId++;
                issueComments.set(id, params.body);
                return { data: { id } };
              },
              updateComment: async (params: { comment_id: number; body: string }) => {
                issueComments.set(params.comment_id, params.body);
                return { data: {} };
              },
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-canonical-retry-quiet-settlement",
              model: "test-model",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              stopReason: "end_turn",
            };
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-canonical-root-quiet-settlement",
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
        saveCheckpoint: async (checkpoint: {
          reviewOutputKey: string;
          partialCommentId?: number;
          findingCount?: number;
          filesReviewed?: string[];
          summaryDraft?: string;
          totalFiles?: number;
        }) => {
          checkpointState.set(checkpoint.reviewOutputKey, {
            partialCommentId: checkpoint.partialCommentId,
            findingCount: checkpoint.findingCount,
            filesReviewed: checkpoint.filesReviewed,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
          });
        },
        getCheckpoint: async (key: string) => {
          const checkpoint = checkpointState.get(key);
          if (!checkpoint || !checkpoint.filesReviewed || !checkpoint.summaryDraft || !checkpoint.totalFiles) {
            return null;
          }
          return {
            reviewOutputKey: key,
            repo: "acme/repo",
            prNumber: 101,
            filesReviewed: checkpoint.filesReviewed,
            findingCount: checkpoint.findingCount ?? 0,
            summaryDraft: checkpoint.summaryDraft,
            totalFiles: checkpoint.totalFiles,
            partialCommentId: checkpoint.partialCommentId,
          };
        },
        getPriorReviewFindings: async () => [
          {
            filePath: "README.md",
            title: "Carry forward timeout finding",
            titleFingerprint: "fp-46cc3f1d",
            severity: "major",
            category: "correctness",
            startLine: 1,
            endLine: 1,
            commentId: 501,
          },
        ],
        updateCheckpointCommentId: (key: string, partialCommentId: number) => {
          const current = checkpointState.get(key) ?? {};
          checkpointState.set(key, { ...current, partialCommentId });
        },
        deleteCheckpoint: (key: string) => {
          checkpointState.delete(key);
        },
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts", "src/b.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );
    await queuedRetryJob!(createQueueRunMetadata());

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "quiet-settled",
      finalStopReason: "settled-without-update",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("corrects canonical state when retry enqueue fails after scheduling", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            throw new Error("retry queue unavailable");
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 2401 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "error",
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-canonical-enqueue-failure",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      knowledgeStore: createKnowledgeStoreStub({
        saveCheckpoint: async () => undefined,
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("degrades canonical projection status when timeout telemetry write fails", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    await Bun.write(
      join(workspaceFixture.dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\ntelemetry:\n  enabled: true\n",
    );
    const canonicalWrites: Array<Record<string, unknown>> = [];

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        ) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 2501 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "error",
          isTimeout: true,
          published: false,
          errorMessage: "timeout",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-canonical-telemetry-degraded",
          model: "test-model",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "timeout",
        }),
      } as never,
      telemetryStore: {
        ...noopTelemetryStore,
        recordResilienceEvent: async () => {
          throw new Error("telemetry unavailable");
        },
      } as never,
      knowledgeStore: createKnowledgeStoreStub({
        getCheckpoint: async (key: string) => ({
          reviewOutputKey: key,
          repo: "acme/repo",
          prNumber: 101,
          filesReviewed: ["README.md"],
          findingCount: 1,
          summaryDraft: "Found one issue before timeout.",
          totalFiles: 1,
          partialCommentId: 2501,
        }),
        saveCheckpoint: async () => undefined,
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: "review-work-1",
      authoritativeAttemptOrdinal: 1,
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "degraded",
      supersededByAttemptId: null,
    });

    await workspaceFixture.cleanup();
  });

  test("keeps superseding canonical authority when a stale retry attempt later throws", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const canonicalWrites: Array<Record<string, unknown>> = [];
    let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;

    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 18_000;
        return () => ++nowMs;
      })(),
    });

    createReviewHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: { action?: string },
        ) => {
          if (context?.action === "review-retry") {
            queuedRetryJob = fn as (metadata: JobQueueRunMetadata) => Promise<unknown>;
            return undefined as T;
          }
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => ({
          dir: workspaceFixture.dir,
          cleanup: async () => undefined,
        }),
        cleanupStale: async () => 0,
      } as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              listReviewComments: async () => ({ data: [] }),
              listReviews: async () => ({ data: [] }),
              listCommits: async () => ({ data: [] }),
            },
            issues: {
              listComments: async () => ({ data: [] }),
              createComment: async () => ({ data: { id: 2601 } }),
              updateComment: async () => ({ data: {} }),
            },
            reactions: {
              createForIssue: async () => ({ data: {} }),
            },
            search: {
              issuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { eventType: string }) => {
          if (context.eventType === "pull_request.review-retry") {
            throw new Error("retry executor crashed");
          }
          return {
            conclusion: "error",
            isTimeout: true,
            published: false,
            errorMessage: "timeout",
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-canonical-stale-retry-root",
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
        saveCheckpoint: async () => undefined,
        upsertContinuationFamilyState: async (record: Record<string, unknown>) => {
          canonicalWrites.push(record);
        },
      }) as never,
      diffContextCollector: async () => ({
        changedFiles: ["README.md", "src/a.ts"],
        numstatLines: [],
        diffContent: undefined,
        strategy: "github-file-list-fallback",
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:file-list",
      }),
      reviewWorkCoordinator: coordinator as never,
      logger: createNoopLogger(),
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    expect(queuedRetryJob).toBeDefined();

    const supersedingAttempt = coordinator.claim({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-newer",
      phase: "claimed",
    });
    coordinator.setPhase(supersedingAttempt.attemptId, "executor-dispatch");

    await queuedRetryJob!(createQueueRunMetadata());

    expect(canonicalWrites.at(-1)).toMatchObject({
      familyKey: buildReviewFamilyKey("acme", "repo", 101),
      authoritativeAttemptId: supersedingAttempt.attemptId,
      authoritativeAttemptOrdinal: 3,
      authoritativeOutcome: "superseded",
      finalStopReason: "superseded-by-newer-attempt",
      projectionStatus: "canonical",
      supersededByAttemptId: supersedingAttempt.attemptId,
    });

    await workspaceFixture.cleanup();
  });
});
