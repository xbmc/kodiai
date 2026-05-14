import { $ } from "bun";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";

import { createReviewHandler } from "./review.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { ExecutionResult } from "../execution/types.ts";
import type { JobQueue, JobQueueRunMetadata, WorkspaceManager } from "../jobs/types.ts";
import { getEmptyActiveJobs } from "../jobs/queue.test-helpers.ts";
import type { ShadowSpecialistSubflowInput, ShadowSpecialistSubflowResult } from "../specialists/shadow-specialist-subflow.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

export const specialistCanary = "SPECIALIST_SHOULD_NEVER_PUBLISH";
export const specialistInlineCanary = "SPECIALIST_INLINE_FINDING_SHOULD_NOT_EXIST";

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

function createCaptureLogger() {
  const entries: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const capture = (data: unknown, message?: string) => {
    if (typeof data === "string") {
      entries.push({ message: data });
      return;
    }
    entries.push({ message: message ?? "", data: (data ?? {}) as Record<string, unknown> });
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

async function createWorkspaceFixture(options: { autoApprove: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-review-shadow-metrics-"));
  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();
  await mkdir(join(dir, "docs"), { recursive: true });
  await Bun.write(join(dir, "docs/runbook.md"), "base runbook\n");
  await Bun.write(
    join(dir, ".kodiai.yml"),
    `review:\n  enabled: true\n  autoApprove: ${options.autoApprove ? "true" : "false"}\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n  skipAuthors: []\n  skipPaths: []\n`,
  );
  await $`git -C ${dir} add docs/runbook.md .kodiai.yml`.quiet();
  await $`git -C ${dir} commit -m "base"`.quiet();
  await $`git -C ${dir} checkout -b feature`.quiet();
  await Bun.write(join(dir, "docs/runbook.md"), `base runbook\nnormal review change\n`);
  await $`git -C ${dir} add docs/runbook.md`.quiet();
  await $`git -C ${dir} commit -m "feature"`.quiet();
  await $`git -C ${dir} remote add origin ${dir}`.quiet();
  return { dir, cleanup: async () => rm(dir, { recursive: true, force: true }) };
}

function buildReviewRequestedEvent(): WebhookEvent {
  return {
    id: "delivery-shadow-metrics",
    name: "pull_request",
    installationId: 42,
    payload: {
      action: "review_requested",
      pull_request: {
        number: 101,
        draft: false,
        title: "Docs runbook update",
        body: "",
        user: { login: "octocat" },
        base: { ref: "main", sha: "base-sha" },
        head: {
          sha: "abcdef1234567890",
          ref: "feature",
          repo: { full_name: "acme/repo", name: "repo", owner: { login: "acme" } },
        },
      },
      requested_reviewer: { login: "kodiai[bot]" },
      repository: { full_name: "acme/repo", name: "repo", owner: { login: "acme" } },
    },
  } as WebhookEvent;
}

function createMaliciousShadowResult(input: ShadowSpecialistSubflowInput): ShadowSpecialistSubflowResult {
  return {
    trigger: {
      status: "triggered",
      laneId: "docs-config-truth",
      skipReason: null,
      degradedReason: null,
      errorKind: null,
      matchedPaths: ["docs/runbook.md"],
      candidateCount: 4,
      selectedLaneCount: 1,
      shadowOnly: true,
      publishesFindings: false,
      correlationKey: input.correlationKey ?? null,
      metrics: { decisionCount: 4, duplicateCount: 1, disagreementCount: 1, tokenCountAvailable: true, costAvailable: true, latencyMsAvailable: true },
    },
    output: {
      laneId: "docs-config-truth",
      status: "degraded",
      skipReason: null,
      degradedReasons: ["unsafe-publication-field"],
      errorKind: "unsafe-publication-field",
      candidates: [
        { fingerprint: "candidate-a", decision: "candidate", duplicate: false, privateOnly: true, body: specialistCanary },
        { fingerprint: "candidate-a", decision: "candidate", duplicate: true, privateOnly: true, inlineComment: specialistInlineCanary },
        { fingerprint: "candidate-disagree", decision: "disagreement", disagreementCategory: "operator-runbook-gap", duplicate: false, privateOnly: true, githubCommentBody: specialistCanary },
        { fingerprint: "candidate-dismissed", decision: "dismissed", duplicate: false, privateOnly: true, approval: true },
      ] as never,
      candidateCount: 4,
      truncatedCandidateCount: 0,
      decisionCounts: { candidate: 1, duplicate: 1, disagreement: 1, dismissed: 1, unclassifiable: 0 },
      duplicateCount: 1,
      disagreementCount: 1,
      metricAvailability: { tokenCount: "available", costUsd: "available", latencyMs: "available" },
      metrics: { decisionCount: 4, duplicateCount: 1, disagreementCount: 1, tokenCountAvailable: true, costAvailable: true, latencyMsAvailable: true },
      deliveryId: input.deliveryId ?? null,
      reviewOutputKey: input.reviewOutputKey ?? null,
      correlationKey: input.correlationKey ?? null,
      redactionFlags: { unsafeFieldCount: 6, discardedRawPayload: true, discardedPublicationFields: true, discardedApprovalFields: true },
      shadowOnly: true,
      publishesFindings: false,
      prompt: `raw prompt ${specialistCanary}`,
      modelOutput: `model text ${specialistCanary}`,
      toolPayload: { body: specialistCanary },
      approval: true,
    } as never,
    durationMs: 5,
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
    candidateCount: 4,
    decisionCount: 4,
    duplicateCount: 1,
    disagreementCount: 1,
    metricAvailability: { tokenCount: "available", costUsd: "available", latencyMs: "available" },
    redactionFlags: { unsafeFieldCount: 6, discardedRawPayload: true, discardedPublicationFields: true, discardedApprovalFields: true },
    shadowOnly: true,
    publishesFindings: false,
  };
}

export interface ReviewWithShadowMetricsExecutorParams {
  input: Parameters<ReturnType<typeof createExecutor>["execute"]>[0];
  octokit: unknown;
  logger: Logger;
  issueCreatePayloads: Array<Record<string, unknown>>;
  issueUpdatePayloads: Array<Record<string, unknown>>;
  reviewCreatePayloads: Array<Record<string, unknown>>;
  reviewUpdatePayloads: Array<Record<string, unknown>>;
  reviewCommentPayloads: Array<Record<string, unknown>>;
}

export interface ReviewWithShadowMetricsOptions {
  autoApprove: boolean;
  shadowSpecialistSubflow?: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
  executorExecute?: (params: ReviewWithShadowMetricsExecutorParams) => Promise<ExecutionResult>;
}

export interface ReviewWithShadowMetricsResult {
  entries: Array<{ message: string; data?: Record<string, unknown> }>;
  executorInputs: Array<Parameters<ReturnType<typeof createExecutor>["execute"]>[0]>;
  issueCreatePayloads: Array<Record<string, unknown>>;
  issueUpdatePayloads: Array<Record<string, unknown>>;
  reviewCreatePayloads: Array<Record<string, unknown>>;
  reviewUpdatePayloads: Array<Record<string, unknown>>;
  reviewCommentPayloads: Array<Record<string, unknown>>;
}

export async function runReviewWithShadowMetrics(options: ReviewWithShadowMetricsOptions): Promise<ReviewWithShadowMetricsResult> {
  const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
  const workspace = await createWorkspaceFixture({ autoApprove: options.autoApprove });
  const cleanups = [workspace.cleanup];
  const { logger, entries } = createCaptureLogger();
  const executorInputs: Array<Parameters<ReturnType<typeof createExecutor>["execute"]>[0]> = [];
  const issueCreatePayloads: Array<Record<string, unknown>> = [];
  const issueUpdatePayloads: Array<Record<string, unknown>> = [];
  const reviewCreatePayloads: Array<Record<string, unknown>> = [];
  const reviewUpdatePayloads: Array<Record<string, unknown>> = [];
  const reviewCommentPayloads: Array<Record<string, unknown>> = [];

  const octokit = {
    rest: {
      pulls: {
        listReviewComments: async () => ({ data: [] }),
        listReviews: async () => ({ data: [] }),
        get: async () => ({ data: { head: { sha: "abcdef1234567890" } } }),
        createReviewComment: async (payload: Record<string, unknown>) => {
          reviewCommentPayloads.push(payload);
          return { data: { id: 7001 + reviewCommentPayloads.length, html_url: "https://example.invalid/review-comment", path: payload.path, line: payload.line, original_line: payload.line } };
        },
        createReview: async (payload: Record<string, unknown>) => {
          reviewCreatePayloads.push(payload);
          return { data: { id: 9001, body: payload.body } };
        },
      },
      issues: {
        listComments: async () => ({ data: [] }),
        createComment: async (payload: Record<string, unknown>) => {
          issueCreatePayloads.push(payload);
          return { data: { id: 8001, body: payload.body } };
        },
        updateComment: async (payload: Record<string, unknown>) => {
          issueUpdatePayloads.push(payload);
          return { data: { id: payload.comment_id, body: payload.body } };
        },
      },
      reactions: { createForIssue: async () => ({ data: {} }) },
    },
    request: async (_route: string, payload: Record<string, unknown>) => {
      reviewUpdatePayloads.push(payload);
      return { data: { id: payload.review_id, body: payload.body } };
    },
  };

  createReviewHandler({
    eventRouter: {
      register: (eventKey, handler) => handlers.set(eventKey, handler),
      dispatch: async () => undefined,
    } as EventRouter,
    jobQueue: {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn({ queuedAtMs: 1, startedAtMs: 1, waitMs: 0 }),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    } as JobQueue,
    workspaceManager: {
      create: async () => ({ dir: workspace.dir, cleanup: async () => undefined }),
      cleanupStale: async () => 0,
    } as WorkspaceManager,
    githubApp: {
      getAppSlug: () => "kodiai",
      getInstallationOctokit: async () => octokit as never,
    } as unknown as GitHubApp,
    executor: {
      execute: async (input: Parameters<ReturnType<typeof createExecutor>["execute"]>[0]) => {
        executorInputs.push(input);
        if (options.executorExecute) {
          return await options.executorExecute({
            input,
            octokit,
            logger,
            issueCreatePayloads,
            issueUpdatePayloads,
            reviewCreatePayloads,
            reviewUpdatePayloads,
            reviewCommentPayloads,
          });
        }
        return { conclusion: "success", published: false, costUsd: 0, numTurns: 1, durationMs: 1, sessionId: "session-shadow-metrics", errorMessage: undefined, model: undefined, inputTokens: undefined, outputTokens: undefined, cacheReadTokens: undefined, cacheCreationTokens: undefined, stopReason: undefined };
      },
    } as never,
    telemetryStore: noopTelemetryStore,
    diffContextCollector: async () => ({
      changedFiles: ["docs/runbook.md"],
      numstatLines: ["1\t0\tdocs/runbook.md"],
      diffContent: "diff --git a/docs/runbook.md b/docs/runbook.md\n+normal review change\n",
      strategy: "github-file-list-fallback",
      mergeBaseRecovered: false,
      deepenAttempts: 0,
      unshallowAttempted: false,
      diffRange: "github-api:file-list",
    }),
    shadowSpecialistSubflow: options.shadowSpecialistSubflow ?? (async (input) => createMaliciousShadowResult(input)),
    logger,
  });

  const handler = handlers.get("pull_request.review_requested");
  if (!handler) {
    throw new Error("review handler did not register pull_request.review_requested");
  }

  try {
    await handler(buildReviewRequestedEvent());
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }

  return { entries, executorInputs, issueCreatePayloads, issueUpdatePayloads, reviewCreatePayloads, reviewUpdatePayloads, reviewCommentPayloads };
}
