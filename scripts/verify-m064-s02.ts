import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createReviewHandler } from "../src/handlers/review.ts";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import { buildReviewFamilyKey, createReviewWorkCoordinator } from "../src/jobs/review-work-coordinator.ts";
import { createQueueRunMetadata, getEmptyActiveJobs } from "../src/jobs/queue.test-helpers.ts";
import type { GitHubApp } from "../src/auth/github-app.ts";
import type { JobQueue, JobQueueRunMetadata, WorkspaceManager } from "../src/jobs/types.ts";
import type { EventRouter, WebhookEvent } from "../src/webhook/types.ts";
import type {
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
  ContinuationFamilyStateKey,
  ContinuationFamilyStateRecord,
  KnowledgeStore,
} from "../src/knowledge/types.ts";

export const M064_S02_SCENARIO_IDS = [
  "retry-enqueue-failure",
  "retry-execution-failure",
  "telemetry-projection-degraded",
  "superseded-stale-retry",
] as const;

export type M064S02ScenarioId = (typeof M064_S02_SCENARIO_IDS)[number];

export type M064S02StatusCode =
  | "m064_s02_ok"
  | "m064_s02_invalid_arg"
  | "m064_s02_verifier_failed";

export type M064S02ScenarioStatusCode =
  | "canonical-blocked"
  | "canonical-blocked-degraded"
  | "canonical-superseded"
  | "invalid-contract";

export type M064S02Check = {
  key:
    | "canonical-row-present"
    | "authoritative-attempt"
    | "final-stop-reason"
    | "projection-status"
    | "supersession-shield";
  status: "pass" | "fail" | "expected-negative";
  detail: string;
};

export type M064S02ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M064S02ScenarioStatusCode;
  familyKey: string;
  baseReviewOutputKey: string;
  authoritativeAttemptId: string | null;
  authoritativeAttemptOrdinal: number | null;
  authoritativeOutcome: string | null;
  finalStopReason: ContinuationFamilyFinalStopReason | null;
  projectionStatus: ContinuationFamilyProjectionStatus | null;
  supersededByAttemptId: string | null;
  checks: M064S02Check[];
  issues: string[];
};

export type M064S02Report = {
  command: "verify:m064:s02";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M064S02StatusCode;
  scenarios: M064S02ScenarioRecord[];
  issues: string[];
};

type VerifyM064S02Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type ScenarioHarnessResult = {
  familyKey: string;
  baseReviewOutputKey: string;
  state: ContinuationFamilyStateRecord | null;
};

type ScenarioDefinition = {
  scenarioId: M064S02ScenarioId;
  expectedState: {
    authoritativeAttemptId: string;
    authoritativeAttemptOrdinal: number;
    authoritativeOutcome: ContinuationFamilyStateRecord["authoritativeOutcome"];
    finalStopReason: ContinuationFamilyStateRecord["finalStopReason"];
    projectionStatus: ContinuationFamilyStateRecord["projectionStatus"];
    supersededByAttemptId: string | null;
  };
  run: () => Promise<ScenarioHarnessResult>;
};

type EvaluateScenarioInput = ScenarioDefinition & {
  mutateState?: (state: ContinuationFamilyStateRecord | null) => ContinuationFamilyStateRecord | null;
};

const VALID_SCENARIO_IDS = new Set<string>(M064_S02_SCENARIO_IDS);
const FIXTURE_OWNER = "acme";
const FIXTURE_REPO = "repo";
const FIXTURE_PR_NUMBER = 101;
const FIXTURE_INSTALLATION_ID = 42;
const FIXTURE_DELIVERY_ID = "delivery-123";
const FIXTURE_HEAD_SHA = "abcdef1234567890";

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
  recordLlmCost: async () => {},
  recordPromptSections: async () => {},
  countRecentTimeouts: async () => 0,
  purgeOlderThan: async () => 0,
  checkpoint: () => {},
  close: () => {},
};

function buildReviewRequestedEvent(
  payloadOverrides: Record<string, unknown>,
  eventOverrides: Partial<Pick<WebhookEvent, "id">> = {},
): WebhookEvent {
  return {
    id: FIXTURE_DELIVERY_ID,
    name: "pull_request",
    installationId: FIXTURE_INSTALLATION_ID,
    payload: {
      action: "review_requested",
      pull_request: {
        number: FIXTURE_PR_NUMBER,
        draft: false,
        title: "Verifier PR",
        body: "",
        commits: 0,
        additions: 1,
        deletions: 0,
        user: { login: "octocat" },
        base: { ref: "main", sha: "mainsha" },
        head: {
          sha: FIXTURE_HEAD_SHA,
          ref: "feature",
          repo: {
            full_name: `${FIXTURE_OWNER}/${FIXTURE_REPO}`,
            name: FIXTURE_REPO,
            owner: { login: FIXTURE_OWNER },
          },
        },
        labels: [],
      },
      repository: {
        full_name: `${FIXTURE_OWNER}/${FIXTURE_REPO}`,
        name: FIXTURE_REPO,
        owner: { login: FIXTURE_OWNER },
      },
      ...payloadOverrides,
    },
    ...eventOverrides,
  } as WebhookEvent;
}

async function createWorkspaceFixture(options: { telemetryEnabled?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-verify-m064-s02-"));
  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();
  await Bun.write(join(dir, "README.md"), "base\n");
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
  if (options.telemetryEnabled) {
    configLines.push("telemetry:", "  enabled: true");
  }
  await Bun.write(join(dir, ".kodiai.yml"), `${configLines.join("\n")}\n`);
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

function createCanonicalStateStore() {
  const rows = new Map<string, ContinuationFamilyStateRecord>();

  const keyFor = (key: ContinuationFamilyStateKey) => `${key.familyKey}::${key.baseReviewOutputKey}`;

  const store = createKnowledgeStoreStub({
    upsertContinuationFamilyState: async (record: ContinuationFamilyStateRecord) => {
      rows.set(keyFor(record), {
        ...record,
        supersededByAttemptId: record.supersededByAttemptId ?? null,
      });
    },
    getContinuationFamilyState: async (key: ContinuationFamilyStateKey) => rows.get(keyFor(key)) ?? null,
  }) as KnowledgeStore;

  return {
    store,
    get: async (key: ContinuationFamilyStateKey) =>
      await store.getContinuationFamilyState?.(key) ?? null,
  };
}

function createCheckpointBackedStore(
  canonical: ReturnType<typeof createCanonicalStateStore>,
  overrides: Record<string, unknown> = {},
): KnowledgeStore {
  const checkpoints = new Map<string, Record<string, unknown>>();
  const defaultCheckpoint = (key: string) => ({
    reviewOutputKey: key,
    repo: `${FIXTURE_OWNER}/${FIXTURE_REPO}`,
    prNumber: FIXTURE_PR_NUMBER,
    filesReviewed: ["README.md"],
    inspectedFiles: ["README.md"],
    findingCount: 1,
    summaryDraft: "Found one issue before timeout.",
    totalFiles: 2,
  });

  return createKnowledgeStoreStub({
    ...canonical.store,
    getCheckpoint: async (key: string) => checkpoints.get(key) ?? defaultCheckpoint(key),
    saveCheckpoint: async (checkpoint: Record<string, unknown>) => {
      const key = String(checkpoint.reviewOutputKey ?? "");
      if (key) {
        checkpoints.set(key, { ...checkpoint });
      }
    },
    updateCheckpointCommentId: async (key: string, partialCommentId: number) => {
      checkpoints.set(key, {
        ...defaultCheckpoint(key),
        ...(checkpoints.get(key) ?? {}),
        partialCommentId,
      });
    },
    deleteCheckpoint: async (key: string) => {
      checkpoints.delete(key);
    },
    ...overrides,
  }) as KnowledgeStore;
}

function createDiffContext() {
  return {
    changedFiles: ["README.md", "src/a.ts"],
    numstatLines: [],
    diffContent: undefined,
    strategy: "github-file-list-fallback" as const,
    mergeBaseRecovered: false,
    deepenAttempts: 0,
    unshallowAttempted: false,
    diffRange: "github-api:file-list",
  };
}

function createOctokitStub() {
  return {
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
  };
}

function createBaseDeps(params: {
  handlers: Map<string, (event: WebhookEvent) => Promise<void>>;
  jobQueue: JobQueue;
  workspaceDir: string;
  knowledgeStore: KnowledgeStore;
  telemetryStore?: typeof noopTelemetryStore;
  reviewWorkCoordinator?: ReturnType<typeof createReviewWorkCoordinator>;
  executor: { execute: (context: { eventType: string }) => Promise<Record<string, unknown>> };
}) {
  const eventRouter: EventRouter = {
    register: (eventKey, handler) => {
      params.handlers.set(eventKey, handler);
    },
    dispatch: async () => undefined,
  };

  const workspaceManager: WorkspaceManager = {
    create: async () => ({
      dir: params.workspaceDir,
      cleanup: async () => undefined,
    }),
    cleanupStale: async () => 0,
  } as WorkspaceManager;

  const githubApp = {
    getAppSlug: () => "kodiai",
    getInstallationOctokit: async () => createOctokitStub() as never,
  } as unknown as GitHubApp;

  createReviewHandler({
    eventRouter,
    jobQueue: params.jobQueue,
    workspaceManager,
    githubApp,
    executor: params.executor as never,
    telemetryStore: (params.telemetryStore ?? noopTelemetryStore) as never,
    knowledgeStore: params.knowledgeStore as never,
    diffContextCollector: async () => createDiffContext(),
    reviewWorkCoordinator: params.reviewWorkCoordinator as never,
    logger: createNoopLogger(),
  });
}

function buildBaseReviewOutputKey() {
  return buildReviewOutputKey({
    installationId: FIXTURE_INSTALLATION_ID,
    owner: FIXTURE_OWNER,
    repo: FIXTURE_REPO,
    prNumber: FIXTURE_PR_NUMBER,
    action: "review_requested",
    deliveryId: FIXTURE_DELIVERY_ID,
    headSha: FIXTURE_HEAD_SHA,
  });
}

async function runRetryEnqueueFailureScenario(): Promise<ScenarioHarnessResult> {
  const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
  const workspaceFixture = await createWorkspaceFixture();
  const canonical = createCanonicalStateStore();
  const familyKey = buildReviewFamilyKey(FIXTURE_OWNER, FIXTURE_REPO, FIXTURE_PR_NUMBER);
  const baseReviewOutputKey = buildBaseReviewOutputKey();

  try {
    const jobQueue: JobQueue = {
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
    } as unknown as JobQueue;

    createBaseDeps({
      handlers,
      jobQueue,
      workspaceDir: workspaceFixture.dir,
      knowledgeStore: createCheckpointBackedStore(canonical),
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
      },
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    return {
      familyKey,
      baseReviewOutputKey,
      state: await canonical.get({ familyKey, baseReviewOutputKey }),
    };
  } finally {
    await workspaceFixture.cleanup();
  }
}

async function runRetryExecutionFailureScenario(): Promise<ScenarioHarnessResult> {
  const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
  const workspaceFixture = await createWorkspaceFixture();
  const canonical = createCanonicalStateStore();
  const familyKey = buildReviewFamilyKey(FIXTURE_OWNER, FIXTURE_REPO, FIXTURE_PR_NUMBER);
  const baseReviewOutputKey = buildBaseReviewOutputKey();
  let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;

  try {
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
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    } as unknown as JobQueue;

    createBaseDeps({
      handlers,
      jobQueue,
      workspaceDir: workspaceFixture.dir,
      knowledgeStore: createCheckpointBackedStore(canonical),
      executor: {
        execute: async (context) => {
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
            sessionId: "session-canonical-retry-root",
            model: "test-model",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "timeout",
          };
        },
      },
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );
    if (!queuedRetryJob) {
      throw new Error("retry job was not queued");
    }
    await queuedRetryJob(createQueueRunMetadata());

    return {
      familyKey,
      baseReviewOutputKey,
      state: await canonical.get({ familyKey, baseReviewOutputKey }),
    };
  } finally {
    await workspaceFixture.cleanup();
  }
}

async function runTelemetryProjectionDegradedScenario(): Promise<ScenarioHarnessResult> {
  const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
  const workspaceFixture = await createWorkspaceFixture({ telemetryEnabled: true });
  const canonical = createCanonicalStateStore();
  const familyKey = buildReviewFamilyKey(FIXTURE_OWNER, FIXTURE_REPO, FIXTURE_PR_NUMBER);
  const baseReviewOutputKey = buildBaseReviewOutputKey();

  try {
    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) =>
        fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    } as unknown as JobQueue;

    createBaseDeps({
      handlers,
      jobQueue,
      workspaceDir: workspaceFixture.dir,
      knowledgeStore: createKnowledgeStoreStub({
        ...canonical.store,
        getCheckpoint: async (key: string) => ({
          reviewOutputKey: key,
          repo: `${FIXTURE_OWNER}/${FIXTURE_REPO}`,
          prNumber: FIXTURE_PR_NUMBER,
          filesReviewed: ["README.md"],
          findingCount: 1,
          summaryDraft: "Found one issue before timeout.",
          totalFiles: 1,
          partialCommentId: 2501,
        }),
        saveCheckpoint: async () => undefined,
      }) as KnowledgeStore,
      telemetryStore: {
        ...noopTelemetryStore,
        recordResilienceEvent: async () => {
          throw new Error("telemetry unavailable");
        },
      },
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
      },
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );

    return {
      familyKey,
      baseReviewOutputKey,
      state: await canonical.get({ familyKey, baseReviewOutputKey }),
    };
  } finally {
    await workspaceFixture.cleanup();
  }
}

async function runSupersededStaleRetryScenario(): Promise<ScenarioHarnessResult> {
  const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
  const workspaceFixture = await createWorkspaceFixture();
  const canonical = createCanonicalStateStore();
  const familyKey = buildReviewFamilyKey(FIXTURE_OWNER, FIXTURE_REPO, FIXTURE_PR_NUMBER);
  const baseReviewOutputKey = buildBaseReviewOutputKey();
  let queuedRetryJob: ((metadata: JobQueueRunMetadata) => Promise<unknown>) | undefined;
  const coordinator = createReviewWorkCoordinator({
    nowFn: (() => {
      let nowMs = 18_000;
      return () => ++nowMs;
    })(),
  });

  try {
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
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    } as unknown as JobQueue;

    createBaseDeps({
      handlers,
      jobQueue,
      workspaceDir: workspaceFixture.dir,
      knowledgeStore: createCheckpointBackedStore(canonical),
      reviewWorkCoordinator: coordinator,
      executor: {
        execute: async (context) => {
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
      },
    });

    await handlers.get("pull_request.review_requested")!(
      buildReviewRequestedEvent({
        requested_reviewer: { login: "kodiai[bot]" },
      }),
    );
    if (!queuedRetryJob) {
      throw new Error("retry job was not queued");
    }

    const supersedingAttempt = coordinator.claim({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-newer",
      phase: "claimed",
    });
    coordinator.setPhase(supersedingAttempt.attemptId, "executor-dispatch");

    await queuedRetryJob(createQueueRunMetadata());

    return {
      familyKey,
      baseReviewOutputKey,
      state: await canonical.get({ familyKey, baseReviewOutputKey }),
    };
  } finally {
    await workspaceFixture.cleanup();
  }
}

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  return [
    {
      scenarioId: "retry-enqueue-failure",
      expectedState: {
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      },
      run: runRetryEnqueueFailureScenario,
    },
    {
      scenarioId: "retry-execution-failure",
      expectedState: {
        authoritativeAttemptId: "review-work-2",
        authoritativeAttemptOrdinal: 2,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "canonical",
        supersededByAttemptId: null,
      },
      run: runRetryExecutionFailureScenario,
    },
    {
      scenarioId: "telemetry-projection-degraded",
      expectedState: {
        authoritativeAttemptId: "review-work-1",
        authoritativeAttemptOrdinal: 1,
        authoritativeOutcome: "blocked",
        finalStopReason: "no-follow-up",
        projectionStatus: "degraded",
        supersededByAttemptId: null,
      },
      run: runTelemetryProjectionDegradedScenario,
    },
    {
      scenarioId: "superseded-stale-retry",
      expectedState: {
        authoritativeAttemptId: "review-work-3",
        authoritativeAttemptOrdinal: 3,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId: "review-work-3",
      },
      run: runSupersededStaleRetryScenario,
    },
  ];
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M064S02Report {
  return {
    command: "verify:m064:s02",
    generated_at: generatedAt,
    scenario_count: 0,
    success: false,
    status_code: "m064_s02_invalid_arg",
    scenarios: [],
    issues: [issue],
  };
}

function statusCodeForOutcome(
  outcome: ContinuationFamilyStateRecord["authoritativeOutcome"] | null,
  projectionStatus: ContinuationFamilyStateRecord["projectionStatus"] | null,
): M064S02ScenarioStatusCode {
  if (outcome === "superseded") {
    return "canonical-superseded";
  }
  if (outcome === "blocked" && projectionStatus === "degraded") {
    return "canonical-blocked-degraded";
  }
  if (outcome === "blocked") {
    return "canonical-blocked";
  }
  return "invalid-contract";
}

export async function evaluateScenario(params: EvaluateScenarioInput): Promise<M064S02ScenarioRecord> {
  const scenarioResult = await params.run();
  let state = scenarioResult.state;
  if (params.mutateState) {
    state = params.mutateState(state);
  }

  const issues: string[] = [];
  const checks: M064S02Check[] = [];

  const rowPresent = state !== null;
  checks.push({
    key: "canonical-row-present",
    status: rowPresent ? "pass" : "fail",
    detail: rowPresent
      ? "Canonical family row was returned directly from durable-state queries."
      : "Canonical family row was missing for the requested family/base reviewOutputKey.",
  });
  if (!rowPresent) {
    issues.push("Canonical family row was missing for the requested family/base reviewOutputKey.");
  }

  const authoritativeAttemptPass = state?.authoritativeAttemptId === params.expectedState.authoritativeAttemptId
    && state?.authoritativeAttemptOrdinal === params.expectedState.authoritativeAttemptOrdinal;
  checks.push({
    key: "authoritative-attempt",
    status: authoritativeAttemptPass ? "pass" : "fail",
    detail: authoritativeAttemptPass
      ? `Authoritative attempt resolved to ${params.expectedState.authoritativeAttemptId}.`
      : `Expected authoritative attempt ${params.expectedState.authoritativeAttemptId} (#${params.expectedState.authoritativeAttemptOrdinal}) but received ${state?.authoritativeAttemptId ?? "missing"} (#${state?.authoritativeAttemptOrdinal ?? "missing"}).`,
  });
  if (!authoritativeAttemptPass) {
    issues.push(`Expected authoritative attempt ${params.expectedState.authoritativeAttemptId} (#${params.expectedState.authoritativeAttemptOrdinal}) but received ${state?.authoritativeAttemptId ?? "missing"} (#${state?.authoritativeAttemptOrdinal ?? "missing"}).`);
  }

  const stopReasonPass = state?.authoritativeOutcome === params.expectedState.authoritativeOutcome
    && state?.finalStopReason === params.expectedState.finalStopReason;
  checks.push({
    key: "final-stop-reason",
    status: stopReasonPass ? "pass" : "fail",
    detail: stopReasonPass
      ? `Canonical row reported outcome=${params.expectedState.authoritativeOutcome} stopReason=${params.expectedState.finalStopReason}.`
      : `Expected outcome=${params.expectedState.authoritativeOutcome} stopReason=${params.expectedState.finalStopReason} but received outcome=${state?.authoritativeOutcome ?? "missing"} stopReason=${state?.finalStopReason ?? "missing"}.`,
  });
  if (!stopReasonPass) {
    issues.push(`Expected outcome=${params.expectedState.authoritativeOutcome} stopReason=${params.expectedState.finalStopReason} but received outcome=${state?.authoritativeOutcome ?? "missing"} stopReason=${state?.finalStopReason ?? "missing"}.`);
  }

  const projectionPass = state?.projectionStatus === params.expectedState.projectionStatus;
  checks.push({
    key: "projection-status",
    status: projectionPass ? "pass" : "fail",
    detail: projectionPass
      ? `Projection status remained ${params.expectedState.projectionStatus}.`
      : `Expected projection status ${params.expectedState.projectionStatus} but received ${state?.projectionStatus ?? "missing"}.`,
  });
  if (!projectionPass) {
    issues.push(`Expected projection status ${params.expectedState.projectionStatus} but received ${state?.projectionStatus ?? "missing"}.`);
  }

  const supersessionExpected = params.expectedState.authoritativeOutcome === "superseded";
  const supersessionPass = supersessionExpected
    ? state?.supersededByAttemptId === params.expectedState.supersededByAttemptId
    : state?.supersededByAttemptId === null;
  checks.push({
    key: "supersession-shield",
    status: supersessionExpected ? (supersessionPass ? "pass" : "fail") : "expected-negative",
    detail: supersessionExpected
      ? supersessionPass
        ? `Stale-attempt overwrite stayed suppressed by ${params.expectedState.supersededByAttemptId}.`
        : `Expected supersededByAttemptId=${params.expectedState.supersededByAttemptId} but received ${state?.supersededByAttemptId ?? "missing"}.`
      : "Scenario does not exercise superseded-state shielding.",
  });
  if (supersessionExpected && !supersessionPass) {
    issues.push(`Expected supersededByAttemptId=${params.expectedState.supersededByAttemptId} but received ${state?.supersededByAttemptId ?? "missing"}.`);
  }

  return {
    scenarioId: params.scenarioId,
    success: issues.length === 0,
    statusCode: issues.length === 0
      ? statusCodeForOutcome(state?.authoritativeOutcome ?? null, state?.projectionStatus ?? null)
      : "invalid-contract",
    familyKey: scenarioResult.familyKey,
    baseReviewOutputKey: scenarioResult.baseReviewOutputKey,
    authoritativeAttemptId: state?.authoritativeAttemptId ?? null,
    authoritativeAttemptOrdinal: state?.authoritativeAttemptOrdinal ?? null,
    authoritativeOutcome: state?.authoritativeOutcome ?? null,
    finalStopReason: state?.finalStopReason ?? null,
    projectionStatus: state?.projectionStatus ?? null,
    supersededByAttemptId: state?.supersededByAttemptId ?? null,
    checks,
    issues,
  };
}

export async function evaluateM064S02(params?: {
  generatedAt?: string;
  scenarioId?: M064S02ScenarioId | null;
}): Promise<M064S02Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;
  const scenarios = await Promise.all(selectedDefinitions.map((definition) => evaluateScenario(definition)));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m064:s02",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m064_s02_ok" : "m064_s02_verifier_failed",
    scenarios,
    issues,
  };
}

export function parseVerifyM064S02Args(args: string[]): VerifyM064S02Args {
  let scenarioId: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scenario") {
      const candidate = args[index + 1];
      if (candidate && !candidate.startsWith("--")) {
        scenarioId = candidate;
        index += 1;
      }
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    scenarioId,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m064:s02 -- [--scenario <id>] [--json]",
    "",
    "Scenario ids:",
    ...M064_S02_SCENARIO_IDS.map((id) => `  ${id}`),
    "",
    "Options:",
    "  --scenario   Run one deterministic orchestration-failure scenario instead of the full matrix",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM064S02Report(report: M064S02Report): string {
  const lines = [
    "# M064 S02 — Canonical Orchestration Failure Verifier",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      lines.push(`- ${scenario.scenarioId}: ${scenario.statusCode}`);
      lines.push(`  - familyKey=${scenario.familyKey} baseReviewOutputKey=${scenario.baseReviewOutputKey}`);
      lines.push(
        `  - authoritativeAttemptId=${scenario.authoritativeAttemptId ?? "missing"} ordinal=${scenario.authoritativeAttemptOrdinal ?? "missing"} outcome=${scenario.authoritativeOutcome ?? "missing"}`,
      );
      lines.push(
        `  - finalStopReason=${scenario.finalStopReason ?? "missing"} projectionStatus=${scenario.projectionStatus ?? "missing"} supersededByAttemptId=${scenario.supersededByAttemptId ?? "none"}`,
      );
      for (const check of scenario.checks) {
        lines.push(`  - ${check.key}: ${check.status} — ${check.detail}`);
      }
    }
  }

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const options = parseVerifyM064S02Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId)) {
    const report = buildInvalidArgReport(`Unknown scenario id: ${options.scenarioId}.`);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM064S02Report(report));
    return 1;
  }

  const report = await evaluateM064S02({ scenarioId: (options.scenarioId as M064S02ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM064S02Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
