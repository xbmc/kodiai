import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import { $ } from "bun";
import { createHash } from "node:crypto";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
  getGitStatusPorcelain,
  createBranchCommitAndPush,
  commitAndPushToRemoteRef,
  pushHeadToRemoteRef,
  fetchRemoteTrackingBranch,
  WritePolicyError,
  assertOriginIsFork,
  shouldUseGist,
} from "../jobs/workspace.ts";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
  type ReviewWorkPhase,
} from "../jobs/review-work-coordinator.ts";
import {
  type MentionEvent,
  normalizeIssueComment,
  normalizeReviewComment,
  normalizeReviewBody,
  stripMention,
} from "./mention-types.ts";
import {
  buildMentionContextDetails,
  buildMentionContextFingerprint,
} from "../execution/mention-context.ts";
import {
  buildMentionRetrievalBody,
  deriveMentionAdmissionPolicy,
  detectImplicitIssueIntent,
  detectImplicitPrPatchIntent,
  isCodeSeekingMentionRequest,
  isReviewRequest,
} from "./mention-request-classification.ts";
import {
  generateCommitSubject,
  generatePrBody,
  generatePrTitle,
  parseWriteIntent,
} from "./mention-write-formatters.ts";
import { summarizeWriteRequest } from "../lib/write-request-formatting.ts";
import {
  buildIssueWriteFailureReply,
  buildIssueWriteSuccessReply,
  type IssueWriteFailureStep,
  isLikelyWritePermissionFailure,
  summarizeErrorForDiagnostics,
} from "./mention-write-replies.ts";
import { buildWriteBranchName, buildWriteOutputKey } from "./mention-write-keys.ts";
import {
  collectPrReviewPromptDiff,
  scanDiffForFabricatedContent,
} from "./mention-pr-review-diff.ts";
import { buildIssueCodeContext } from "../execution/issue-code-context.ts";
import { buildMentionPromptDetails } from "../execution/mention-prompt.ts";
import { buildReviewPromptDetails, matchPathInstructions } from "../execution/review-prompt.ts";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import {
  resolveReviewRoutingLineCount,
  resolveReviewTaskRouting,
  resolveReviewMaxTurnsOverride,
  type ReviewTaskRouting,
} from "../lib/review-routing.ts";
import { toProductionLogTurnBudgetFields } from "../review-audit/production-log-projection.ts";
import { buildPromptSectionRecord, type PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import { buildRetrievalVariants } from "../knowledge/multi-query-retrieval.ts";
import { analyzeDiff, classifyFileLanguage, parseNumstatPerFile } from "../execution/diff-analysis.ts";
import { computeFileRiskScores, triageFilesByRisk } from "../lib/file-risk-scorer.ts";
import { computeLanguageComplexity, estimateTimeoutRisk } from "../lib/timeout-estimator.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { buildSearchCacheKey, createSearchCache, type SearchCacheOptions } from "../lib/search-cache.ts";
import {
  type ErrorCategory,
  classifyError,
  formatErrorComment,
  postOrUpdateErrorComment,
} from "../lib/errors.ts";
import { wrapInDetails } from "../lib/formatting.ts";
import { sanitizeOutgoingMentions, scanOutgoingForSecrets } from "../lib/sanitizer.ts";
import { validateIssue, generateGuidanceComment, generateLabelRecommendation, generateGenericNudge } from "../triage/triage-agent.ts";
import { runGuardrailPipeline } from "../lib/guardrail/pipeline.ts";
import { createGuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { mentionAdapter } from "../lib/guardrail/adapters/mention-adapter.ts";
import { FORK_WRITE_POLICY_INSTRUCTIONS } from "../execution/prompts.ts";
import { buildWritePolicyRefusalMessage } from "../lib/write-policy-formatting.ts";
import {
  createConversationTurnStore,
  createTriageCooldownStore,
  createWriteRateLimitStore,
} from "../lib/mention-state-stores.ts";
import { runCommandWithCappedOutput, type CappedProcessResult } from "../lib/capped-process.ts";
import { splitGitLines } from "../lib/review-git-utils.ts";
import {
  buildApprovedReviewBody,
  buildReviewOutputKey,
  buildReviewOutputPublicationLogFields,
  ensureReviewOutputNotPublished,
} from "../review-orchestration/review-idempotency.ts";
import {
  evaluateExplicitMentionReviewPublish,
  buildExplicitMentionReviewPublishFailureBody,
  buildExplicitReviewLifecycleEvidenceLine,
  buildExplicitReviewTextFallbackLines,
  logExplicitMentionReviewPublishSkipped,
  type ExplicitMentionReviewPublishSkipReason,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import {
  attachReviewFindingLifecycle,
  attachReviewValidationTruth,
} from "../review-lifecycle/handler-lifecycle.ts";
import { detectFormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";
import {
  runFormatterSuggestionSubflow,
  type FormatterSuggestionSubflowResult,
} from "./formatter-suggestion-orchestration.ts";
import { selectExplicitReviewPromptDiffContent } from "./mention-token-budget.ts";

async function prepareMentionCheckoutAndLoadConfig(params: {
  workspace: Workspace;
  usesPrRef: boolean;
  mention: Pick<MentionEvent, "prNumber" | "baseRef">;
  cloneDepth: number;
}): Promise<Awaited<ReturnType<typeof loadRepoConfig>>> {
  const trustedBaseRepoConfig = params.usesPrRef
    ? await loadRepoConfig(params.workspace.dir)
    : null;

  if (params.usesPrRef && params.mention.prNumber !== undefined) {
    await fetchAndCheckoutPullRequestHeadRef({
      dir: params.workspace.dir,
      prNumber: params.mention.prNumber,
      localBranch: "pr-mention",
      token: params.workspace.token,
      depth: params.cloneDepth,
    });

    if (params.mention.baseRef) {
      await fetchRemoteTrackingBranch({
        dir: params.workspace.dir,
        branch: params.mention.baseRef,
        token: params.workspace.token,
        depth: params.cloneDepth,
      });
    }
  }

  return trustedBaseRepoConfig ?? loadRepoConfig(params.workspace.dir);
}

type MentionRetrievalContext = {
  maxChars?: number;
  maxItems?: number;
  findings: Array<{
    findingText: string;
    severity: string;
    category: string;
    path: string;
    line?: number;
    snippet?: string;
    outcome: string;
    distance: number;
    sourceRepo: string;
  }>;
};

type MentionPublishResolution =
  | "none"
  | "executor"
  | "approval-bridge"
  | "comment-approval"
  | "idempotency-skip"
  | "duplicate-suppressed"
  | "publish-failure-fallback"
  | "publish-failure-comment-failed"
  | "error-fallback"
  | "error-comment-failed"
  | "turn-limit-fallback"
  | "turn-limit-fallback-failed"
  | "failure-fallback"
  | "failure-fallback-failed";
type MentionErrorDelivery =
  | "review-thread-reply"
  | "error-comment-created"
  | "error-comment-updated"
  | "error-comment-failed";
type MentionErrorPostResult = {
  posted: boolean;
  delivery: MentionErrorDelivery;
};

type MentionExecutionFailureSubtype = "usage_limit";

const FORMATTER_REVIEW_OUTPUT_ACTION = "mention-format-suggestions";

const FORMATTER_SUBFLOW_STATUSES = new Set([
  "setup-needed",
  "no-op",
  "pr-diff-unavailable",
  "mapped-no-suggestions",
  "posted",
  "duplicate",
  "blocked",
  "failed",
]);

function isExpectedTurnLimitMentionOutcome(params: {
  conclusion: string;
  stopReason?: string;
  failureSubtype?: string;
}): boolean {
  return params.conclusion === "failure"
    && (params.stopReason === "max_turns" || params.failureSubtype === "error_max_turns");
}

function mapTurnLimitFallbackDelivery(delivery: MentionErrorDelivery | null): string | null {
  switch (delivery) {
    case "error-comment-created":
      return "turn-limit-comment-created";
    case "error-comment-updated":
      return "turn-limit-comment-updated";
    case "error-comment-failed":
      return "turn-limit-comment-undelivered";
    default:
      return delivery;
  }
}

function cleanTurnLimitMentionPublishResolution(resolution: MentionPublishResolution): string {
  return resolution === "turn-limit-fallback-failed"
    ? "turn-limit-fallback-undelivered"
    : resolution;
}

function describeExplicitReviewPublishSkipReason(reason: ExplicitMentionReviewPublishSkipReason | undefined): string {
  switch (reason) {
    case "missing-inspection-evidence":
      return "the run did not provide the required repo-inspection evidence";
    case "missing-review-output-key":
      return "the run was missing its review publication key";
    case "execution-not-success":
      return "the review executor did not finish successfully";
    case "output-already-published":
      return "review output was already published for this request";
    case "result-text-findings":
      return "the run produced findings that were not safely publishable";
    case "not-eligible":
      return "the run did not satisfy the explicit-review publication gate";
    default:
      return "the run did not satisfy the explicit-review publication gate";
  }
}

function buildExplicitReviewNoOutputFallbackLines(reason: ExplicitMentionReviewPublishSkipReason | undefined): string[] {
  return [
    "I completed the review run, but couldn't publish a trustworthy review result from it.",
    "",
    `Reason: ${describeExplicitReviewPublishSkipReason(reason)}.`,
    "No code findings were published for this request.",
  ];
}

function isKnownFormatterSubflowStatus(status: unknown): boolean {
  return typeof status === "string" && FORMATTER_SUBFLOW_STATUSES.has(status);
}

function buildFormatterSubflowFallbackResult(params: {
  status?: unknown;
  commandStatus?: unknown;
  publisherStatus?: unknown;
  reason?: string;
}): FormatterSuggestionSubflowResult {
  const status = isKnownFormatterSubflowStatus(params.status) ? params.status as FormatterSuggestionSubflowResult["status"] : "failed";
  return {
    status,
    commandStatus: typeof params.commandStatus === "string" ? params.commandStatus as FormatterSuggestionSubflowResult["commandStatus"] : undefined,
    publisherStatus: typeof params.publisherStatus === "string" ? params.publisherStatus as FormatterSuggestionSubflowResult["publisherStatus"] : undefined,
    suggestions: 0,
    skipped: 0,
    capped: 0,
    reason: params.reason ?? "formatter subflow returned an unknown or malformed status",
    visibleMessage: "Formatter suggestions could not be completed because the formatter subflow returned an unexpected status. Please retry after checking the formatter configuration.",
    partialFailure: true,
  };
}

function classifyMentionExecutionFailureSubtype(errorMessage: string | undefined): MentionExecutionFailureSubtype | undefined {
  if (errorMessage === undefined) {
    return undefined;
  }
  return classifyError(new Error(errorMessage), false) === "usage_limit" ? "usage_limit" : undefined;
}

const MENTION_RETRIEVAL_MAX_CONTEXT_CHARS = 1200;
const GIST_PATCH_MAX_BYTES = 2 * 1024 * 1024;
const PR_DIFF_MAX_CHARS = 8_000;

async function collectMentionDiffFilePaths(params: {
  workspaceDir: string;
  baseRef: string;
}): Promise<CappedProcessResult> {
  let diffResult = await runCommandWithCappedOutput({
    command: "git",
    args: ["diff", `origin/${params.baseRef}...HEAD`, "--name-only"],
    cwd: params.workspaceDir,
    maxStdoutBytes: 256 * 1024,
  });
  if (diffResult.exitCode !== 0) {
    diffResult = await runCommandWithCappedOutput({
      command: "git",
      args: ["diff", `origin/${params.baseRef}..HEAD`, "--name-only"],
      cwd: params.workspaceDir,
      maxStdoutBytes: 256 * 1024,
    });
  }
  return diffResult;
}

async function collectCappedPrDiff(params: {
  workspaceDir: string;
  baseRef: string;
  logger: Logger;
  logContext: Record<string, unknown>;
}): Promise<{ stat: string; diff: string; truncated: boolean; fileCount: number } | undefined> {
  let statResult = await $`git -C ${params.workspaceDir} diff origin/${params.baseRef}...HEAD --stat`.quiet().nothrow();
  let diffResult = await runCommandWithCappedOutput({
    command: "git",
    args: ["diff", `origin/${params.baseRef}...HEAD`],
    cwd: params.workspaceDir,
    maxStdoutBytes: PR_DIFF_MAX_CHARS + 4096,
  });
  if (statResult.exitCode !== 0 || diffResult.exitCode !== 0) {
    params.logger.debug(
      {
        ...params.logContext,
        statExitCode: statResult.exitCode,
        diffExitCode: diffResult.exitCode,
      },
      "Three-dot diff failed, falling back to two-dot diff",
    );
    statResult = await $`git -C ${params.workspaceDir} diff origin/${params.baseRef}..HEAD --stat`.quiet().nothrow();
    diffResult = await runCommandWithCappedOutput({
      command: "git",
      args: ["diff", `origin/${params.baseRef}..HEAD`],
      cwd: params.workspaceDir,
      maxStdoutBytes: PR_DIFF_MAX_CHARS + 4096,
    });
  }

  if (statResult.exitCode !== 0 || (diffResult.exitCode !== 0 && !diffResult.stdoutTruncated)) {
    return undefined;
  }

  const stat = statResult.text().trim();
  const fullDiff = diffResult.stdout;
  const truncated = diffResult.stdoutTruncated || fullDiff.length > PR_DIFF_MAX_CHARS;
  const cutPoint = fullDiff.lastIndexOf("\n", PR_DIFF_MAX_CHARS);
  const diff = truncated
    ? fullDiff.slice(0, cutPoint > 0 ? cutPoint : PR_DIFF_MAX_CHARS)
    : fullDiff.trim();
  const fileCount = stat.split("\n").filter((line) => line.includes("|")).length;
  return { stat, diff, truncated, fileCount };
}

async function collectWorkspaceChangedFiles(workspaceDir: string): Promise<string[]> {
  const changedFilesRaw = (await $`git -C ${workspaceDir} diff --name-only HEAD`.quiet().nothrow()).text().trim();
  const stagedFilesRaw = (await $`git -C ${workspaceDir} diff --cached --name-only`.quiet().nothrow()).text().trim();
  const allChangedRaw = [changedFilesRaw, stagedFilesRaw].filter(Boolean).join("\n");
  return [...new Set(splitGitLines(allChangedRaw))];
}

async function buildStagedPatchForGist(workspaceDir: string): Promise<CappedProcessResult> {
  await $`git -C ${workspaceDir} add -A`.quiet();
  return runCommandWithCappedOutput({
    command: "git",
    args: ["diff", "--cached"],
    cwd: workspaceDir,
    maxStdoutBytes: GIST_PATCH_MAX_BYTES,
  });
}

function buildMentionQueueKey(owner: string, repo: string, issueOrPrNumber: number): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}#${issueOrPrNumber}`;
}

function findLatestReviewPredecessor(
  snapshot: ReturnType<ReviewWorkCoordinator["getSnapshot"]>,
  currentAttemptId: string,
) {
  if (!snapshot) {
    return null;
  }

  return snapshot.attempts
    .filter((attempt) => attempt.attemptId !== currentAttemptId)
    .sort((left, right) => {
      if (right.lastProgressAtMs !== left.lastProgressAtMs) {
        return right.lastProgressAtMs - left.lastProgressAtMs;
      }
      return right.claimedAtMs - left.claimedAtMs;
    })[0] ?? null;
}




/**
 * Create the mention handler and register it with the event router.
 *
 * Handles @kodiai mentions across all four comment surfaces:
 * - issue_comment.created (issues and PR general comments)
 * - pull_request_review_comment.created (inline diff comments)
 * - pull_request_review.submitted (review body)
 */
export function createMentionHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  telemetryStore: TelemetryStore;
  knowledgeStore?: KnowledgeStore;
  retriever?: ReturnType<typeof createRetriever>;
  /** Fork manager for fork-based write mode (Phase 127). */
  forkManager?: ForkManager;
  /** Gist publisher for patch output mode (Phase 127). */
  gistPublisher?: GistPublisher;
  /** Optional SQL client for guardrail audit logging (GUARD-06). */
  sql?: import("../db/client.ts").Sql;
  /** Optional in-memory coordinator for same-PR review-family publish rights. */
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  /** Optional derived-context cache store overrides for mention-context reuse tests/fail-open wiring. */
  mentionDerivedContextCacheOptions?: Pick<
    SearchCacheOptions<PromptBuildResult>,
    "ttlMs" | "maxSize" | "now" | "store" | "inFlightStore"
  >;
  /** Optional formatter-suggestion subflow override for mention orchestration tests. */
  formatterSuggestionSubflow?: typeof runFormatterSuggestionSubflow;
  logger: Logger;
}): void {
  const {
    eventRouter,
    jobQueue,
    workspaceManager,
    githubApp,
    executor,
    telemetryStore,
    retriever,
    forkManager,
    gistPublisher,
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    mentionDerivedContextCacheOptions,
    formatterSuggestionSubflow = runFormatterSuggestionSubflow,
    logger,
  } = deps;

  const guardrailAuditStore = sql ? createGuardrailAuditStore(sql) : undefined;
  const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();
  if (!injectedReviewWorkCoordinator) {
    logger.warn(
      {
        gate: "review-family-coordinator",
        gateResult: "private-fallback",
        coordinationScope: "handler-local",
        handler: "mention",
      },
      "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );
  }

  let mentionDerivedContextCacheErrorCount = 0;
  const mentionDerivedContextCache = createSearchCache<PromptBuildResult>({
    ...mentionDerivedContextCacheOptions,
    onError: (error) => {
      mentionDerivedContextCacheErrorCount += 1;
      logger.warn(
        {
          err: error,
          gate: "mention-derived-context-cache",
          gateResult: "degraded",
        },
        "Mention derived-context cache degraded; bypassing cache for this request",
      );
    },
  });

  const writeRateLimitStore = createWriteRateLimitStore();
  const conversationTurnStore = createConversationTurnStore();

  const inFlightWriteKeys = new Set<string>();

  const triageCooldownStore = createTriageCooldownStore();



  async function handleMention(event: WebhookEvent): Promise<void> {
    const appSlug = githubApp.getAppSlug();
    const possibleHandles = [appSlug, "kodai", "claude"];

    const action = (event.payload as Record<string, unknown>).action as string | undefined;

    // Normalize payload based on event type
    let mention: MentionEvent;

    if (event.name === "issue_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeIssueComment(event.payload as unknown as IssueCommentCreatedEvent);
    } else if (event.name === "pull_request_review_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeReviewComment(
        event.payload as unknown as PullRequestReviewCommentCreatedEvent,
      );
    } else if (event.name === "pull_request_review") {
      if ((event.payload as Record<string, unknown>).action !== "submitted") return;
      const payload = event.payload as unknown as PullRequestReviewSubmittedEvent;
      // Review body can be null (e.g. approval with no comment)
      if (!payload.review.body) return;
      mention = normalizeReviewBody(payload);
    } else {
      return;
    }

    // Fast filter: ignore if neither @appSlug nor @claude appear.
    // NOTE: Use a simple substring check here to avoid regex edge cases.
    // We still do the authoritative accepted-handles check inside the job after loading config.
    const bodyLower = mention.commentBody.toLowerCase();
    const appHandle = `@${appSlug.toLowerCase()}`;
    if (!bodyLower.includes(appHandle) && !bodyLower.includes("@kodai") && !bodyLower.includes("@claude")) return;

    const normalizedCommentAuthor = mention.commentAuthor.toLowerCase();
    if (
      normalizedCommentAuthor === appSlug.toLowerCase() ||
      normalizedCommentAuthor.endsWith("[bot]")
    ) {
      logger.debug(
        {
          owner: mention.owner,
          repo: mention.repo,
          commentAuthor: mention.commentAuthor,
          issueNumber: mention.issueNumber,
          prNumber: mention.prNumber,
        },
        "Skipping mention from self (comment-author defense)",
      );
      return;
    }

    // No tracking comment. Tracking is via eyes reaction only.
    // The response will be posted as a new comment.

    const provisionalUserQuestion = stripMention(mention.commentBody, possibleHandles);
    const provisionalFormatterSuggestionRequest = detectFormatterSuggestionRequest(provisionalUserQuestion);
    const reviewPrNumber = mention.prNumber;
    const isExplicitReviewRequest =
      reviewPrNumber !== undefined &&
      (isReviewRequest(provisionalUserQuestion) || provisionalFormatterSuggestionRequest?.mode === "review-and-format");
    const mentionQueueKey = buildMentionQueueKey(
      mention.owner,
      mention.repo,
      reviewPrNumber ?? mention.issueNumber,
    );
    const queuedReviewWorkAttempt = reviewPrNumber !== undefined && isExplicitReviewRequest
      ? reviewWorkCoordinator.claim({
          familyKey: buildReviewFamilyKey(mention.owner, mention.repo, reviewPrNumber),
          source: "explicit-review",
          lane: "interactive-review",
          deliveryId: event.id,
          phase: "claimed",
        })
      : undefined;
    if (queuedReviewWorkAttempt) {
      const predecessor = findLatestReviewPredecessor(
        reviewWorkCoordinator.getSnapshot(queuedReviewWorkAttempt.familyKey),
        queuedReviewWorkAttempt.attemptId,
      );
      if (predecessor) {
        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: reviewPrNumber,
            gate: "review-family-coordinator",
            gateResult: "claimed-with-predecessor",
            reviewFamilyKey: queuedReviewWorkAttempt.familyKey,
            reviewWorkAttemptId: queuedReviewWorkAttempt.attemptId,
            predecessorAttemptId: predecessor.attemptId,
            predecessorPhase: predecessor.phase,
            predecessorAgeMs: Math.max(
              0,
              queuedReviewWorkAttempt.claimedAtMs - predecessor.lastProgressAtMs,
            ),
          },
          "Explicit review claim found a stale predecessor attempt",
        );
      }
    }
    let reviewWorkAttemptCommitted = false;
    let reviewWorkAttemptFinalized = false;

    function finalizeQueuedReviewWorkAttempt(): void {
      if (!queuedReviewWorkAttempt || reviewWorkAttemptFinalized) {
        return;
      }

      reviewWorkAttemptFinalized = true;
      if (reviewWorkAttemptCommitted) {
        reviewWorkCoordinator.complete(queuedReviewWorkAttempt.attemptId);
        return;
      }

      reviewWorkCoordinator.release(queuedReviewWorkAttempt.attemptId);
    }

    try {
      await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      let acquiredWriteKey: string | undefined;
      const reviewWorkAttempt = queuedReviewWorkAttempt;
      let reviewPublishRightsLost = false;
      let explicitReviewRequest = false;
      let reviewOutputKey: string | undefined;
      const explicitReviewUsesCanonicalHandle =
        reviewWorkAttempt !== undefined && (
          mention.commentBody.toLowerCase().includes(`@${appSlug.toLowerCase()}`)
          || mention.commentBody.toLowerCase().includes("@kodai")
        );

      function setReviewWorkPhase(phase: ReviewWorkPhase): void {
        if (!reviewWorkAttempt) {
          return;
        }
        reviewWorkAttemptCommitted = true;
        reviewWorkCoordinator.setPhase(reviewWorkAttempt.attemptId, phase);
      }

      function canPublishExplicitReviewOutput(outputLabel: string, reviewOutputKey?: string): boolean {
        if (!reviewWorkAttempt) {
          return true;
        }
        const attempt = reviewWorkAttempt;
        if (reviewWorkCoordinator.canPublish(attempt.attemptId)) {
          return true;
        }

        reviewPublishRightsLost = true;
        const currentAttempt = reviewWorkCoordinator
          .getSnapshot(attempt.familyKey)
          ?.attempts.find((candidateAttempt) => candidateAttempt.attemptId === attempt.attemptId);
        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            gate: "review-family-coordinator",
            gateResult: "skipped",
            skipReason: "publish-rights-lost",
            reviewOutputKey: reviewOutputKey ?? null,
            reviewFamilyKey: attempt.familyKey,
            reviewWorkAttemptId: attempt.attemptId,
            supersededByAttemptId: currentAttempt?.supersededByAttemptId ?? null,
          },
          `Skipping ${outputLabel} because publish rights were superseded`,
        );
        return false;
      }

      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        async function postMentionReply(
          replyBody: string,
          options?: { sanitizeMentions?: boolean },
        ): Promise<void> {
          let sanitizedBody =
            options?.sanitizeMentions === false
              ? replyBody
              : sanitizeOutgoingMentions(replyBody, possibleHandles);

          // Guardrail pipeline: filter LLM-prose output before publishing (GUARD-07)
          // Only run on substantive LLM prose; skip template/status messages
          // (wrapped in <details> tags or short messages).
          // Fail-open: on error, use original sanitized body.
          const isTemplateBased = sanitizedBody.trimStart().startsWith("<details>") || sanitizedBody.length <= 500;
          if (!isTemplateBased) {
            try {
              const guardResult = await runGuardrailPipeline({
                adapter: mentionAdapter,
                input: {
                  issueBody: mention.commentBody,
                  prDescription: undefined,
                  conversationHistory: [],
                  retrievalResults: [],
                },
                output: sanitizedBody,
                config: { strictness: "standard" },
                repo: `${mention.owner}/${mention.repo}`,
                auditStore: guardrailAuditStore,
              });
              if (guardResult.output !== null && !guardResult.suppressed) {
                sanitizedBody = guardResult.output;
              }
              // If suppressed, keep original body (fail-open)
            } catch {
              // Guardrail error: fail-open, use original sanitized body
            }
          }

          const scanResult = scanOutgoingForSecrets(sanitizedBody);
          if (scanResult.blocked) {
            logger.warn(
              { secretScanRuleId: scanResult.matchedPattern },
              "Outgoing secret scan blocked original mention reply content; publishing placeholder",
            );
            sanitizedBody = "[Response blocked by security policy]";
          }

          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await octokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedBody,
              });
              return;
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, commentId: mention.commentId },
                "Failed to post in-thread reply; falling back to top-level comment",
              );
            }
          }

          await octokit.rest.issues.createComment({
            owner: mention.owner,
            repo: mention.repo,
            issue_number: mention.issueNumber,
            body: sanitizedBody,
          });
        }

        async function postMentionError(errorBody: string): Promise<MentionErrorPostResult> {
          const sanitizedBody = sanitizeOutgoingMentions(errorBody, possibleHandles);
          // Prefer replying in-thread for inline review comment mentions, but only
          // after proving the parent still exists. GitHub returns 404 when users
          // delete stale review comments between webhook receipt and error
          // publication; probing first avoids a noisy failed reply attempt.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            let parentReviewCommentExists = true;
            try {
              await octokit.rest.pulls.getReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                comment_id: mention.commentId,
              });
            } catch (err) {
              const status = typeof err === "object" && err !== null
                ? (err as { status?: unknown }).status
                : undefined;
              if (status === 404) {
                parentReviewCommentExists = false;
                logger.info(
                  { prNumber: mention.prNumber, commentId: mention.commentId },
                  "Skipping in-thread error reply because parent review comment no longer exists",
                );
              } else {
                logger.warn(
                  { err, prNumber: mention.prNumber, commentId: mention.commentId },
                  "Could not verify parent review comment before posting error reply; falling back to top-level error comment",
                );
                parentReviewCommentExists = false;
              }
            }

            if (parentReviewCommentExists) {
              try {
                await octokit.rest.pulls.createReplyForReviewComment({
                  owner: mention.owner,
                  repo: mention.repo,
                  pull_number: mention.prNumber,
                  comment_id: mention.commentId,
                  body: sanitizedBody,
                });
                return { posted: true, delivery: "review-thread-reply" };
              } catch (err) {
                logger.warn(
                  { err, prNumber: mention.prNumber, commentId: mention.commentId },
                  "Failed to post in-thread error reply; falling back to top-level error comment",
                );
              }
            }
          }

          const commentStatus = await postOrUpdateErrorComment(
            octokit,
            {
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
            },
            sanitizedBody,
            logger,
          );

          if (commentStatus.ok) {
            return {
              posted: true,
              delivery:
                commentStatus.resolution === "updated"
                  ? "error-comment-updated"
                  : "error-comment-created",
            };
          }

          return { posted: false, delivery: "error-comment-failed" };
        }

        // Determine clone parameters
        let cloneOwner = mention.owner;
        let cloneRepo = mention.repo;
        let cloneRef: string | undefined;
        let cloneDepth = 1;
        let usesPrRef = false;

        if (mention.prNumber !== undefined) {
          cloneDepth = 50; // PR mentions need diff context

          // Ensure PR details are available (issue_comment on PR requires a pulls.get fetch).
          if (!mention.baseRef || !mention.headRef) {
            const { data: pr } = await octokit.rest.pulls.get({
              owner: mention.owner,
              repo: mention.repo,
              pull_number: mention.prNumber,
            });
            mention.headRef = pr.head.ref;
            mention.baseRef = pr.base.ref;
            mention.headRepoOwner = pr.head.repo?.owner.login;
            mention.headRepoName = pr.head.repo?.name;
          }

          // Fork-safe workspace strategy: clone base repo at base ref, then fetch+checkout
          // refs/pull/<n>/head from the base repo.
          // This avoids relying on access to contributor forks and mirrors the review handler.
          cloneOwner = mention.owner;
          cloneRepo = mention.repo;
          cloneRef = mention.baseRef;
          usesPrRef = true;
        } else {
          // Pure issue mention -- clone default branch
          const repoPayload = event.payload as Record<string, unknown>;
          const repository = repoPayload.repository as Record<string, unknown> | undefined;
          cloneRef = (repository?.default_branch as string) ?? "main";
        }

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            cloneOwner,
            cloneRepo,
            cloneRef,
            cloneDepth,
            usesPrRef,
            workspaceStrategy: usesPrRef
              ? "base-clone+pull-ref-fetch"
              : "direct-branch-clone",
          },
          "Creating workspace for mention execution",
        );

        // Fork-based write mode: ensure fork exists and sync before cloning (Phase 127)
        // Preliminary write intent check before config is available -- fork setup is
        // harmless if config later disables write, so we gate only on user intent.
        const prelimWriteIntent = parseWriteIntent(
          stripMention(mention.commentBody, [appSlug, "claude"]),
        );
        const maybeWriteMode = prelimWriteIntent.writeIntent && prelimWriteIntent.keyword !== "plan";
        let forkContext: { forkOwner: string; forkRepo: string; botPat: string } | undefined;
        if (maybeWriteMode && !forkManager?.enabled) {
          logger.warn(
            { owner: mention.owner, repo: mention.repo },
            "Write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
          );
        }
        if (forkManager?.enabled && maybeWriteMode && !usesPrRef) {
          try {
            const fork = await forkManager.ensureFork(mention.owner, mention.repo);
            await forkManager.syncFork(fork.forkOwner, fork.forkRepo, cloneRef!);
            forkContext = {
              forkOwner: fork.forkOwner,
              forkRepo: fork.forkRepo,
              botPat: forkManager.getBotPat(),
            };
            logger.info(
              { owner: mention.owner, repo: mention.repo, forkOwner: fork.forkOwner, forkRepo: fork.forkRepo },
              "Fork ensured and synced for write-mode",
            );
          } catch (forkErr) {
            logger.warn(
              { err: forkErr, owner: mention.owner, repo: mention.repo },
              "Fork setup failed; will fall back to gist or legacy mode",
            );
            // forkContext stays undefined -- handled later in output routing
          }
        }

        // Clone workspace
        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("workspace-create");
        }
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef!,
          depth: cloneDepth,
          forkContext,
        });

        if (explicitReviewUsesCanonicalHandle) {
          setReviewWorkPhase("load-config");
        }
        const { config, warnings } = await prepareMentionCheckoutAndLoadConfig({
          workspace,
          usesPrRef,
          mention,
          cloneDepth,
        });
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config warning detected",
          );
        }

        // Check mention.enabled
        if (!config.mention.enabled) {
          logger.info(
            { owner: mention.owner, repo: mention.repo },
            "Mentions disabled in config, skipping",
          );
          return;
        }

        const findingLookup = deps.knowledgeStore?.getFindingByCommentId
          ? async (repo: string, commentId: number) =>
              deps.knowledgeStore!.getFindingByCommentId!({ repo, commentId })
          : undefined;

        // Check mention.allowedUsers (CONFIG-07)
        if (config.mention.allowedUsers.length > 0) {
          const normalizedAuthor = mention.commentAuthor.toLowerCase();
          const allowed = config.mention.allowedUsers.map((u) => u.toLowerCase());
          if (!allowed.includes(normalizedAuthor)) {
            logger.info(
              {
                owner: mention.owner,
                repo: mention.repo,
                commentAuthor: mention.commentAuthor,
                gate: "mention-allowed-users",
                gateResult: "skipped",
                skipReason: "user-not-allowlisted",
              },
              "Mention author not in allowedUsers, skipping",
            );
            return;
          }
        }

        // Global alias: treat @claude as an always-on alias for mentions.
        // (Repo-level opt-out remains possible via mention.acceptClaudeAlias=false,
        // but the alias is enabled by default to support immediate cutover.)
        const acceptClaudeAlias = config.mention.acceptClaudeAlias !== false;
        const acceptedHandles = acceptClaudeAlias ? [appSlug, "kodai", "claude"] : [appSlug, "kodai"];

        // Ensure the mention is actually allowed for this repo (e.g. @claude opt-out).
        // Use substring match to align with the fast filter.
        const acceptedBodyLower = mention.commentBody.toLowerCase();
        const accepted = acceptedHandles
          .map((h) => (h.startsWith("@") ? h : `@${h}`))
          .map((h) => h.toLowerCase());
        if (!accepted.some((h) => acceptedBodyLower.includes(h))) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention does not match accepted handles for repo; skipping",
          );
          return;
        }

        const userQuestion = stripMention(mention.commentBody, acceptedHandles);
        const formatterSuggestionRequest = detectFormatterSuggestionRequest(userQuestion);
        if (userQuestion.trim().length === 0) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention contained no question after stripping mention; skipping",
          );
          return;
        }

        const isIssueThreadComment = event.name === "issue_comment" && mention.prNumber === undefined;
        const isPrSurface = mention.prNumber !== undefined;
        explicitReviewRequest = isPrSurface && (
          isReviewRequest(userQuestion) || formatterSuggestionRequest?.mode === "review-and-format"
        );
        const parsedWriteIntent = parseWriteIntent(userQuestion);

        // Issue surfaces: broad implicit intent detection (existing behavior)
        const implicitIntent =
          isIssueThreadComment && !parsedWriteIntent.writeIntent
            ? detectImplicitIssueIntent(parsedWriteIntent.request)
            : undefined;

        // PR surfaces: broad write intent detection (implementation verbs, confirmations, patches)
        // Guard: explicit review requests must never trigger write mode — they are always read-only.
        const prWriteIntent =
          isPrSurface && !isIssueThreadComment && !parsedWriteIntent.writeIntent &&
          formatterSuggestionRequest === undefined &&
          !isReviewRequest(parsedWriteIntent.request)
            ? detectImplicitPrPatchIntent(parsedWriteIntent.request)
            : undefined;

        const effectiveImplicit = implicitIntent ?? prWriteIntent;

        const writeIntent =
          effectiveImplicit !== undefined && !parsedWriteIntent.writeIntent
            ? {
                writeIntent: true,
                keyword: effectiveImplicit,
                request: parsedWriteIntent.request,
              }
            : parsedWriteIntent;

        const isWriteRequest = writeIntent.writeIntent;
        const isPlanOnly = writeIntent.keyword === "plan";
        const writeEnabled = isWriteRequest && !isPlanOnly && config.write.enabled;
        const writeSource =
          mention.prNumber !== undefined
            ? { type: "pr" as const, number: mention.prNumber }
            : { type: "issue" as const, number: mention.issueNumber };

        const writeKeyword = writeIntent.keyword ?? "apply";
        const retryCommand =
          writeIntent.request.trim().length > 0
            ? `@${appSlug} ${writeKeyword}: ${writeIntent.request}`
            : `@${appSlug} ${writeKeyword}: <same request>`;

        const buildWritePermissionFailureReply = (): string =>
          wrapInDetails(
            [
              "I couldn't complete this write request because of missing GitHub App permissions.",
              "",
              "Minimum required permissions for write-mode PR creation:",
              "- `Contents: Read and write`",
              "- `Pull requests: Read and write`",
              "- `Issues: Read and write`",
              "",
              "After updating permissions on the app installation, re-run the same command:",
              `- \`${retryCommand}\``,
            ].join("\n"),
            "kodiai response",
          );

        const maybeReplyWritePermissionFailure = async (err: unknown): Promise<boolean> => {
          if (!isLikelyWritePermissionFailure(err)) {
            return false;
          }
          await postMentionReply(buildWritePermissionFailureReply(), { sanitizeMentions: false });
          return true;
        };

        const writeOutputKey =
          writeEnabled
            ? buildWriteOutputKey({
                installationId: event.installationId,
                owner: mention.owner,
                repo: mention.repo,
                sourceType: writeSource.type,
                sourceNumber: writeSource.number,
                commentId: mention.commentId,
                keyword: writeKeyword,
              })
            : undefined;

        const writeBranchName =
          writeOutputKey
            ? buildWriteBranchName({
                sourceType: writeSource.type,
                sourceNumber: writeSource.number,
                commentId: mention.commentId,
                writeOutputKey,
              })
            : undefined;

        const triggerCommentUrl =
          mention.prNumber !== undefined
            ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}#issuecomment-${mention.commentId}`
            : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}#issuecomment-${mention.commentId}`;

        const runFormatterSuggestionForMention = async (
          formatterMode: "format-only" | "review-and-format",
        ): Promise<FormatterSuggestionSubflowResult> => {
          const formatterWorkspace = workspace;
          if (!formatterWorkspace || !mention.baseRef || !mention.headRef || mention.prNumber === undefined) {
            return buildFormatterSubflowFallbackResult({
              status: "pr-diff-unavailable",
              reason: !formatterWorkspace
                ? "missing workspace for formatter suggestion request"
                : "missing PR base/head ref for formatter suggestion mapping",
            });
          }

          try {
            const fallbackDiffProvider = async () => fetchAllPullRequestFiles({
              octokit,
              owner: mention.owner,
              repo: mention.repo,
              pullNumber: mention.prNumber!,
            });
            const formatterResult = await formatterSuggestionSubflow({
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              workspaceDir: formatterWorkspace.dir,
              baseRef: mention.baseRef,
              headRef: mention.headRef,
              formatterCommand: config.review.formatterSuggestions.command,
              maxSuggestions: config.review.formatterSuggestions.maxSuggestions,
              installationId: event.installationId,
              deliveryId: event.id,
              reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
              octokit: octokit as never,
              token: formatterWorkspace.token,
              botHandles: possibleHandles,
              fallbackFileProvider: async () => (await fallbackDiffProvider()).map((file) => file.filename),
              fallbackDiffProvider,
              logger,
            });

            if (!isKnownFormatterSubflowStatus(formatterResult.status)) {
              return buildFormatterSubflowFallbackResult({
                status: formatterResult.status,
                commandStatus: formatterResult.commandStatus,
                publisherStatus: formatterResult.publisherStatus,
                reason: formatterResult.reason,
              });
            }

            return formatterResult;
          } catch (err) {
            logger.warn(
              {
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                formatterSuggestionRequest: true,
                formatterMode,
                formatterStatus: "failed",
                failureCategory: classifyError(err, false),
              },
              formatterMode === "format-only"
                ? "Format-only formatter suggestion subflow threw before returning a structured result"
                : "Combined review-and-format formatter suggestion subflow threw before returning a structured result",
            );
            return buildFormatterSubflowFallbackResult({
              status: "failed",
              reason: "formatter subflow threw before returning a structured result",
            });
          }
        };

        const postFormatterVisibleDiagnostic = async (
          formatterResult: FormatterSuggestionSubflowResult,
          formatterMode: "format-only" | "review-and-format",
        ): Promise<{ visibleReplyPosted: boolean; visibleReplyFailed: boolean }> => {
          let visibleReplyPosted = false;
          let visibleReplyFailed = false;
          if (formatterResult.visibleMessage) {
            try {
              await postMentionReply(formatterResult.visibleMessage);
              visibleReplyPosted = true;
            } catch (err) {
              visibleReplyFailed = true;
              logger.warn(
                {
                  err,
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  formatterSuggestionRequest: true,
                  formatterMode,
                  formatterStatus: formatterResult.status,
                  failureCategory: classifyError(err, false),
                },
                formatterMode === "format-only"
                  ? "Failed to post format-only formatter suggestion visible diagnostic"
                  : "Failed to post combined review-and-format formatter suggestion visible diagnostic",
              );
            }
          }
          return { visibleReplyPosted, visibleReplyFailed };
        };

        if (isPrSurface && formatterSuggestionRequest?.mode === "format-only") {
          const formatterResult = await runFormatterSuggestionForMention("format-only");
          const { visibleReplyPosted, visibleReplyFailed } = await postFormatterVisibleDiagnostic(
            formatterResult,
            "format-only",
          );

          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              deliveryId: event.id,
              reviewOutputKey: formatterResult.reviewOutputKey,
              reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
              formatterSuggestionRequest: true,
              formatterMode: "format-only",
              formatterStatus: formatterResult.status,
              commandStatus: formatterResult.commandStatus,
              publisherStatus: formatterResult.publisherStatus,
              suggestions: formatterResult.suggestions,
              skipped: formatterResult.skipped,
              capped: formatterResult.capped,
              posted: formatterResult.posted,
              publisherSkipped: formatterResult.publisherSkipped,
              publisherFailed: formatterResult.publisherFailed,
              partialFailure: formatterResult.partialFailure ?? false,
              visibleReplyPosted,
              visibleReplyFailed,
            },
            "Format-only formatter suggestion request completed",
          );
          return;
        }

        if (writeEnabled && writeOutputKey && writeBranchName) {
          // Idempotency: if a PR already exists for this deterministic head branch, reuse it.
          try {
            const { data: prs } = await octokit.rest.pulls.list({
              owner: mention.owner,
              repo: mention.repo,
              state: "all",
              head: `${mention.owner}:${writeBranchName}`,
              per_page: 5,
            });

            const existing = prs[0];
            if (existing?.html_url) {
              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "reused-pr",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  sourcePrNumber: mention.prNumber,
                  triggerCommentId: mention.commentId,
                  triggerCommentUrl,
                  writeOutputKey,
                  branchName: writeBranchName,
                  prUrl: existing.html_url,
                },
                "Evidence bundle",
              );

              const replyBody = wrapInDetails(
                [`Existing PR: ${existing.html_url}`].join("\n"),
                "kodiai response",
              );
              await postMentionReply(replyBody);
              return;
            }
          } catch (err) {
            logger.warn(
              { err, writeBranchName, writeOutputKey, prNumber: mention.prNumber },
              "Failed to look up existing PR for write idempotency; continuing",
            );
          }

          // Best-effort lock: prevent duplicate work for the same trigger.
          if (inFlightWriteKeys.has(writeOutputKey)) {
            const replyBody = wrapInDetails(
              [
                "Write request already in progress.",
                "",
                "If no PR appears shortly, retry the same comment.",
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }
          inFlightWriteKeys.add(writeOutputKey);
          acquiredWriteKey = writeOutputKey;
        }

        if (writeEnabled && config.write.minIntervalSeconds > 0) {
          const key = `${event.installationId}:${mention.owner}/${mention.repo}`;
          const now = Date.now();
          const last = writeRateLimitStore.getLastWriteAt(key);
          const minMs = config.write.minIntervalSeconds * 1000;

          if (last !== undefined && now - last < minMs) {
            const replyBody = wrapInDetails(
              [
                "Write request rate-limited.",
                "",
                `Try again in ${Math.ceil((minMs - (now - last)) / 1000)}s.`,
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }
        }

        if (isWriteRequest && mention.prNumber === undefined && !isIssueThreadComment) {
          const replyBody = wrapInDetails(
            [
              "I can only apply changes in a PR context.",
              "",
              "Try mentioning me on a pull request (top-level comment or inline diff thread).",
            ].join("\n"),
            "kodiai response",
          );
          await postMentionReply(replyBody, { sanitizeMentions: false });
          return;
        }

        if (isWriteRequest && !isPlanOnly && !config.write.enabled) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              commentAuthor: mention.commentAuthor,
              keyword: writeIntent.keyword,
              gate: "write-mode",
              gateResult: "skipped",
              skipReason: "write-disabled",
            },
            "Write intent detected but write-mode disabled; refusing to apply changes",
          );

          const retryCommand =
            writeIntent.request.trim().length > 0
              ? `@${appSlug} ${writeKeyword}: ${writeIntent.request}`
              : `@${appSlug} ${writeKeyword}: <same request>`;

          const replyBody = wrapInDetails(
            [
              "Write mode is disabled for this repo.",
              "",
              "Update `.kodiai.yml`:",
              "```yml",
              "write:",
              "  enabled: true",
              "```",
              "",
              `Then re-run the same \`${retryCommand}\` command.`,
            ].join("\n"),
            "kodiai response",
          );

          await postMentionReply(replyBody, { sanitizeMentions: false });
          return;
        }

        if (mention.inReplyToId !== undefined) {
          const conversationKey = `${mention.owner}/${mention.repo}#${mention.prNumber ?? mention.issueNumber}`;
          const turns = conversationTurnStore.getTurns(conversationKey);
          if (turns >= config.mention.conversation.maxTurnsPerPr) {
            await postMentionReply(
              [
                `Conversation limit reached (${config.mention.conversation.maxTurnsPerPr} turns per PR).`,
                "Start a new thread or open a new issue for further questions.",
              ].join("\n"),
            );
            return;
          }
        }

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            commentAuthor: mention.commentAuthor,
            acceptClaudeAlias,
          },
          "Processing mention",
        );

        // Add eyes reaction to trigger comment for immediate visual acknowledgment
        try {
          if (mention.surface === "pr_review_comment") {
            await octokit.rest.reactions.createForPullRequestReviewComment({
              owner: mention.owner,
              repo: mention.repo,
              comment_id: mention.commentId,
              content: "eyes",
            });
          } else if (mention.surface === "pr_review_body") {
            // PR review bodies don't support reactions -- skip silently
            // (the review ID is not a comment ID, so the reaction endpoints would 404)
          } else {
            // issue_comment and pr_comment both use the issue comment reaction endpoint
            await octokit.rest.reactions.createForIssueComment({
              owner: mention.owner,
              repo: mention.repo,
              comment_id: mention.commentId,
              content: "eyes",
            });
          }
        } catch (err) {
          // Non-fatal: don't block processing if reaction fails
          logger.warn({ err, surface: mention.surface }, "Failed to add eyes reaction");
        }

        // Build mention context (conversation + PR metadata + inline diff context)
        // Non-fatal: if context fails to load, still attempt an answer with minimal prompt.
        let mentionContext = "";
        let mentionContextSectionMetrics: import("../telemetry/types.ts").PromptSectionMetric[] = [];
        let mentionDerivedContextCacheStatus: "hit" | "miss" | "degraded" | "bypass" = "bypass";
        let mentionDerivedContextCacheReason: string | null = null;
        const mentionAdmissionPolicy = deriveMentionAdmissionPolicy({
          explicitReviewRequest,
          mentionAdmission: config.mention.admission,
        });
        const allowIssueCodePointers = isIssueThreadComment && isCodeSeekingMentionRequest(writeIntent.request);
        // A mention on a PR is about that PR. Two consequences, both keyed off the
        // single fact "is this on a PR?":
        //  - always ground the reply in the PR diff — without it a vague follow-up
        //    ("provide additional details") had no code to anchor on and fixated on
        //    whatever retrieval surfaced (once an unrelated issue);
        //  - suppress the repo issue corpus — issue BM25 has no relevance floor and
        //    can inject an unrelated issue on common-word matches.
        const isPrMention = mention.prNumber !== undefined;
        const allowPrDiffContext = isPrMention;
        const includeIssueCorpus = !isPrMention;
        try {
          const fingerprintResult = await buildMentionContextFingerprint(octokit, mention, {
            admissionPolicy: mentionAdmissionPolicy,
            findingLookup,
            maxThreadChars: config.mention.conversation.contextBudgetChars,
            logger,
          });

          if (fingerprintResult.fingerprint) {
            const cacheKey = buildSearchCacheKey({
              repo: `${mention.owner}/${mention.repo}`,
              searchType: "mention-derived-context",
              query: `${mention.surface}:${mention.issueNumber}:${mention.commentId}`,
              extra: {
                fingerprint: fingerprintResult.fingerprint,
              },
            });
            const cacheErrorsBeforeLookup = mentionDerivedContextCacheErrorCount;
            let loaderExecuted = false;
            const mentionContextResult = await mentionDerivedContextCache.getOrLoad(
              cacheKey,
              async () => {
                loaderExecuted = true;
                return await buildMentionContextDetails(octokit, mention, {
                  admissionPolicy: mentionAdmissionPolicy,
                  findingLookup,
                  maxThreadChars: config.mention.conversation.contextBudgetChars,
                });
              },
            );
            mentionContext = mentionContextResult.text;
            mentionContextSectionMetrics = mentionContextResult.sections;
            const cacheDegraded = mentionDerivedContextCacheErrorCount > cacheErrorsBeforeLookup;
            mentionDerivedContextCacheStatus = cacheDegraded
              ? "degraded"
              : loaderExecuted
                ? "miss"
                : "hit";
          } else {
            mentionDerivedContextCacheStatus = "bypass";
            mentionDerivedContextCacheReason = fingerprintResult.missingSignals.join(",") || "incomplete-fingerprint";
            const mentionContextResult = await buildMentionContextDetails(octokit, mention, {
              admissionPolicy: mentionAdmissionPolicy,
              findingLookup,
              maxThreadChars: config.mention.conversation.contextBudgetChars,
            });
            mentionContext = mentionContextResult.text;
            mentionContextSectionMetrics = mentionContextResult.sections;
          }
        } catch (err) {
          mentionDerivedContextCacheStatus = "degraded";
          mentionDerivedContextCacheReason = "context-build-failed";
          logger.warn(
            { err, surface: mention.surface, issueNumber: mention.issueNumber },
            "Failed to build mention context; proceeding with empty context",
          );
        }

        if (allowIssueCodePointers) {
          try {
            const issueCodeContext = await buildIssueCodeContext({
              workspaceDir: workspace.dir,
              question: writeIntent.request,
            });

            if (issueCodeContext.contextBlock.trim().length > 0) {
              const codePointerSection = [
                "## Candidate Code Pointers",
                "",
                issueCodeContext.contextBlock.trim(),
              ].join("\n");
              const contextParts = [
                mentionContext.trim(),
                codePointerSection,
              ].filter((part) => part.length > 0);
              mentionContext = `${contextParts.join("\n")}`;
              mentionContextSectionMetrics.push({
                sectionName: "candidate-code-pointers",
                sectionPosition: mentionContextSectionMetrics.length,
                charCount: codePointerSection.length,
                estimatedTokens: Math.ceil(codePointerSection.length / 4),
              });
            }
          } catch (err) {
            logger.warn(
              { err, surface: mention.surface, issueNumber: mention.issueNumber },
              "Failed to build issue code context; proceeding without code pointers",
            );
          }
        }

        // Triage validation for issue mentions when enabled
        let triageContext = "";
        if (isIssueThreadComment && config.triage.enabled) {
          const cooldownKey = `${mention.owner}/${mention.repo}#${mention.issueNumber}`;
          const bodyHash = createHash("sha256")
            .update(mention.issueBody ?? "")
            .digest("hex")
            .slice(0, 16);
          const now = Date.now();
          const cooldownEntry = triageCooldownStore.get(cooldownKey);
          const cooldownMs = (config.triage.cooldownMinutes ?? 30) * 60 * 1000;

          const withinCooldown =
            cooldownEntry &&
            cooldownEntry.bodyHash === bodyHash &&
            now - cooldownEntry.lastTriagedAt < cooldownMs;

          if (!withinCooldown) {
            try {
              const validationResult = await validateIssue({
                workspaceDir: workspace.dir,
                issueBody: mention.issueBody,
              });

              if (validationResult === null) {
                // No template matched
                triageContext = generateGenericNudge();
              } else if (!validationResult.valid) {
                const guidance = generateGuidanceComment(validationResult);
                const labelRec = generateLabelRecommendation({
                  result: validationResult,
                  labelAllowlist: config.triage.labelAllowlist ?? [],
                });

                triageContext = guidance;
                if (labelRec) {
                  triageContext += `\n\nRecommended label: \`${labelRec}\``;
                }
              }
              // If valid, triageContext stays empty -- no nudge needed

              // Update cooldown
              triageCooldownStore.set(cooldownKey, { lastTriagedAt: now, bodyHash });
            } catch (err) {
              logger.warn(
                { err, issueNumber: mention.issueNumber },
                "Triage validation failed (fail-open)",
              );
            }
          }
        }

        let findingContext:
          | {
              severity: string;
              category: string;
              filePath: string;
              startLine: number | null;
              title: string;
            }
          | undefined;
        if (mention.inReplyToId !== undefined && findingLookup) {
          try {
            findingContext =
              (await findingLookup(`${mention.owner}/${mention.repo}`, mention.inReplyToId)) ?? undefined;
          } catch (err) {
            logger.warn(
              {
                err,
                owner: mention.owner,
                repo: mention.repo,
                inReplyToId: mention.inReplyToId,
              },
              "Failed to hydrate finding context; proceeding without finding metadata",
            );
          }
        }

        let retrievalContext: MentionRetrievalContext | undefined;
        let unifiedResultsForPrompt: import("../knowledge/cross-corpus-rrf.ts").UnifiedRetrievalChunk[] = [];
        let contextWindowForPrompt: string | undefined;
        let reviewPrecedentsForPrompt: import("../knowledge/review-comment-retrieval.ts").ReviewCommentMatch[] = [];
        let wikiKnowledgeForPrompt: import("../knowledge/wiki-retrieval.ts").WikiKnowledgeMatch[] = [];
        if (retriever && config.knowledge?.retrieval?.enabled) {
          try {
            const retrievalBody = buildMentionRetrievalBody({
              userQuestion: writeIntent.request,
              mentionContext,
              allowHeavyContext: allowIssueCodePointers,
              allowDiffContext: allowPrDiffContext,
              explicitReviewRequest,
            });
            let filePaths: string[] = [];
            if ((explicitReviewRequest || allowPrDiffContext) && mention.prNumber !== undefined && mention.baseRef) {
              const diffResult = await collectMentionDiffFilePaths({
                workspaceDir: workspace.dir,
                baseRef: mention.baseRef,
              });
              if (diffResult.exitCode === 0) {
                filePaths = splitGitLines(diffResult.stdout);
              } else {
                logger.warn(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    baseRef: mention.baseRef,
                    exitCode: diffResult.exitCode,
                  },
                  "Failed to collect mention retrieval file paths (fail-open)",
                );
              }
            }

            const prLanguages = Array.from(
              new Set(
                filePaths
                  .map((filePath) => classifyFileLanguage(filePath))
                  .filter((language) => language !== "Unknown")
                  // Normalize to lowercase for language-aware boosting in retrieval (LANG-01)
                  .map((language) => language.toLowerCase()
                    .replace("c++", "cpp")
                    .replace("c#", "csharp")
                    .replace("objective-c++", "objectivecpp")
                    .replace("objective-c", "objectivec")
                    .replace("f#", "fsharp")),
              ),
            );
            const retrievalTopK = Math.max(1, Math.min(config.knowledge?.retrieval?.topK ?? 5, 3));
            const variants = buildRetrievalVariants({
              title: writeIntent.request,
              body: retrievalBody,
              conventionalType: null,
              prLanguages,
              riskSignals: [mention.surface, mention.inReplyToId !== undefined ? "reply-thread" : "single-mention"],
              filePaths,
            });

            const result = await retriever.retrieve({
              repo: `${mention.owner}/${mention.repo}`,
              owner: mention.owner,
              queries: variants.map((v) => v.query),
              workspaceDir: workspace.dir,
              prLanguages,
              topK: retrievalTopK,
              logger,
              triggerType: "question",
              includeIssues: includeIssueCorpus,
            });

            if (config.telemetry.enabled) {
              try {
                const totalEmbeddingLookups = (result?.provenance.embeddingRequests ?? 0) + (result?.provenance.embeddingCacheHits ?? 0);
                await telemetryStore.recordRateLimitEvent({
                  deliveryId: event.id,
                  executionIdentity: `${event.id}:reuse.retrieval-query-embedding.mention`,
                  repo: `${mention.owner}/${mention.repo}`,
                  prNumber: mention.prNumber,
                  eventType: "reuse.retrieval-query-embedding.mention",
                  cacheHitRate: totalEmbeddingLookups > 0
                    ? (result?.provenance.embeddingCacheHits ?? 0) / totalEmbeddingLookups
                    : 0,
                  skippedQueries: result?.provenance.embeddingCacheHits ?? 0,
                  retryAttempts: result?.provenance.embeddingRequests ?? 0,
                  degradationPath: result == null
                    ? "degraded"
                    : (result.provenance.embeddingCacheHits > 0 ? "hit" : "miss"),
                });
              } catch (err) {
                logger.warn(
                  { err, surface: mention.surface, issueNumber: mention.issueNumber },
                  "Mention retrieval reuse telemetry write failed (non-blocking)",
                );
              }
            }

            // Capture unified cross-corpus results (KI-11/KI-12)
            if (result && result.unifiedResults && result.unifiedResults.length > 0) {
              unifiedResultsForPrompt = result.unifiedResults;
              contextWindowForPrompt = result.contextWindow;
            }
            if (result && result.reviewPrecedents.length > 0) {
              reviewPrecedentsForPrompt = result.reviewPrecedents;
            }
            if (result && result.wikiKnowledge.length > 0) {
              wikiKnowledgeForPrompt = result.wikiKnowledge;
            }

            if (result && result.findings.length > 0) {
              retrievalContext = {
                maxChars: MENTION_RETRIEVAL_MAX_CONTEXT_CHARS,
                maxItems: retrievalTopK,
                findings: result.findings.slice(0, retrievalTopK).map((finding, index) => {
                  const anchor = result.snippetAnchors[index];
                  return {
                    findingText: finding.record.findingText,
                    severity: finding.record.severity,
                    category: finding.record.category,
                    path: anchor?.path ?? finding.record.filePath,
                    line: anchor?.line,
                    snippet: anchor?.snippet,
                    outcome: finding.record.outcome,
                    distance: finding.distance,
                    sourceRepo: finding.sourceRepo,
                  };
                }),
              };
            }
          } catch (err) {
            logger.warn(
              {
                err,
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
              },
              "Mention retrieval context generation failed (fail-open)",
            );
          }
        }

        const planOnlyInstructions = isPlanOnly
          ? [
              "Plan-only request detected (plan:).",
              "In this run:",
              "- Do NOT edit files.",
              "- Do NOT run git commands.",
              "- Do NOT propose opening a PR.",
              "- Do NOT claim any change was completed.",
              "- Do NOT ask for `apply:` / `change:` prefixes.",
              "- Never use status phrases like: 'Done', 'Implemented', 'Updated', or 'Appended'.",
              "Return a concise plan with 3-7 steps and a list of files you would touch.",
              "End by asking whether they want you to implement the plan next.",
            ].join("\n")
          : undefined;

        const writeInstructions = writeEnabled
          ? [
              "Write-intent request detected (apply/change).",
              "Write-mode is enabled.",
              "",
              "In this run:",
              "- Make the requested changes by editing files in the workspace.",
              "- Do NOT run git commands (no branch/commit/push).",
              "- Do NOT publish any GitHub comments/reviews; publish tools are disabled.",
              "- Keep changes minimal and focused on the request.",
              "- NEVER fabricate checksums, hashes, version numbers, download URLs, or any verifiable data. If you need a real value (e.g. a SHA512 of a download), leave a clearly-marked TODO placeholder like `SHA512=TODO_REPLACE_WITH_REAL_HASH` instead of generating a fake one.",
              "- NEVER invent API endpoints, package names, or configuration values that you have not verified exist in the codebase.",
              "- Verify completeness: if you add a new module/component, trace it through the build system and make sure it is actually wired in (e.g., find_package calls, CMakeLists.txt, imports, etc.).",
              FORK_WRITE_POLICY_INSTRUCTIONS,
            ].join("\n")
            : isWriteRequest
              ? [
                  "Write-intent request detected (apply/change).",
                  "In this run: do NOT create branches/commits/PRs and do NOT push changes.",
                  "Instead, propose a concrete, minimal plan (files + steps) and ask for confirmation.",
                  "Keep it concise.",
                ].join("\n")
              : undefined;

        // Pre-fetch PR diff for PR mentions — prevents turn exhaustion by giving the model
        // the diff upfront so it does not need to tool-call git to read it.
        // Cap at 8000 chars; truncate at the last newline to avoid splitting mid-line.
        let prDiffContext: { stat: string; diff: string; truncated: boolean; fileCount: number } | undefined;
        // mention.baseRef is the PR base branch (e.g. "main"), set by the event parser.
        if (allowPrDiffContext && mention.prNumber !== undefined && mention.baseRef && !writeEnabled) {
          try {
            prDiffContext = await collectCappedPrDiff({
              workspaceDir: workspace.dir,
              baseRef: mention.baseRef,
              logger,
              logContext: {
                surface: mention.surface,
                prNumber: mention.prNumber,
                baseRef: mention.baseRef,
              },
            });
            if (prDiffContext) {
              logger.debug(
                {
                  surface: mention.surface,
                  prNumber: mention.prNumber,
                  fileCount: prDiffContext.fileCount,
                  truncated: prDiffContext.truncated,
                },
                "Pre-fetched PR diff for mention context",
              );
            }
          } catch {
            // fail-open — model falls back to tool calls if this fails
          }
        }

        setReviewWorkPhase("prompt-build");
        let prompt: string;
        let promptSections: import("../telemetry/types.ts").PromptSectionRecord[] = [];
        let explicitReviewPromptFileCount: number | undefined;
        let explicitReviewDynamicTimeoutSeconds: number | undefined;
        let explicitReviewMaxTurnsOverride: number | undefined;
        let explicitReviewPrDiffCommentabilityIndex: PrDiffCommentabilityIndex | undefined;
        let explicitReviewHeadSha: string | undefined;
        let explicitReviewBaseSha: string | undefined;
        let explicitReviewRouting: ReviewTaskRouting = {
          taskType: TASK_TYPES.REVIEW_FULL,
          routingReason: "standard",
        };
        if (explicitReviewRequest && mention.prNumber !== undefined) {
          const explicitReviewPrNumber = mention.prNumber;
          const { data: explicitReviewPr } = await octokit.rest.pulls.get({
            owner: mention.owner,
            repo: mention.repo,
            pull_number: explicitReviewPrNumber,
          });
          explicitReviewHeadSha = explicitReviewPr.head.sha;
          explicitReviewBaseSha = explicitReviewPr.base.sha;

          const promptDiffContext = mention.baseRef
            ? await collectPrReviewPromptDiff({
                workspaceDir: workspace.dir,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: explicitReviewPrNumber,
                baseRef: mention.baseRef,
                surface: mention.surface,
                logger,
                token: workspace.token,
                fallbackDiffProvider: async () => await fetchAllPullRequestFiles({
                  octokit,
                  owner: mention.owner,
                  repo: mention.repo,
                  pullNumber: explicitReviewPrNumber,
                }),
              })
            : { changedFiles: [], numstatLines: [], diffRange: "unknown" };
          const promptChangedFiles = promptDiffContext.changedFiles;
          explicitReviewPrDiffCommentabilityIndex = promptDiffContext.diffContent
            ? buildPrDiffCommentabilityIndex(promptDiffContext.diffContent)
            : undefined;
          explicitReviewPromptFileCount = promptChangedFiles.length;
          const explicitReviewPromptDiffContent = selectExplicitReviewPromptDiffContent({
            diffContent: promptDiffContext.diffContent,
            changedFileCount: promptChangedFiles.length,
          });

          const diffAnalysis = analyzeDiff({
            changedFiles: promptChangedFiles,
            numstatLines: promptDiffContext.numstatLines,
            fileCategories: config.review.fileCategories as Record<string, string[]> | undefined,
          });
          const diffAnalysisLinesChanged = (diffAnalysis.metrics.totalLinesAdded ?? 0) +
            (diffAnalysis.metrics.totalLinesRemoved ?? 0);
          const prApiLinesChanged = (explicitReviewPr.additions ?? 0) + (explicitReviewPr.deletions ?? 0);
          const explicitReviewLinesChanged = resolveReviewRoutingLineCount({
            diffLinesChanged: diffAnalysisLinesChanged,
            prApiLinesChanged,
          });
          explicitReviewRouting = resolveReviewTaskRouting({
            changedFileCount: promptChangedFiles.length,
            linesChanged: explicitReviewLinesChanged,
          });
          const languageComplexity = computeLanguageComplexity(diffAnalysis.filesByLanguage);
          const timeoutEstimate = estimateTimeoutRisk({
            fileCount: promptChangedFiles.length,
            linesChanged: explicitReviewLinesChanged,
            languageComplexity,
            isLargePR: diffAnalysis.isLargePR,
            baseTimeoutSeconds: config.timeoutSeconds,
          });
          explicitReviewDynamicTimeoutSeconds = config.timeout.dynamicScaling !== false
            ? timeoutEstimate.totalTimeoutSeconds
            : undefined;
          explicitReviewMaxTurnsOverride = resolveReviewMaxTurnsOverride({
            taskType: explicitReviewRouting.taskType,
            routingMaxTurnsOverride: explicitReviewRouting.maxTurnsOverride,
            timeoutRiskLevel: timeoutEstimate.riskLevel,
            baseMaxTurns: config.maxTurns,
            changedFiles: promptChangedFiles,
          });
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              gate: "review-routing",
              taskType: explicitReviewRouting.taskType,
              routingReason: explicitReviewRouting.routingReason,
              changedFiles: promptChangedFiles.length,
              linesChanged: explicitReviewLinesChanged,
              ...toProductionLogTurnBudgetFields(
                explicitReviewMaxTurnsOverride,
                explicitReviewMaxTurnsOverride !== undefined ? "dynamic-risk" : "config",
              ),
              timeoutSeconds: explicitReviewDynamicTimeoutSeconds ?? null,
              timeoutRiskLevel: timeoutEstimate.riskLevel,
              remoteRuntimeBudgetSeconds: timeoutEstimate.remoteRuntimeBudgetSeconds,
              infraOverheadBudgetSeconds: timeoutEstimate.infraOverheadBudgetSeconds,
              lane: "interactive-review",
            },
            "Mention review routing decision",
          );
          const matchedPathInstructions = matchPathInstructions(
            config.review.pathInstructions,
            promptChangedFiles,
          );
          const perFileStats = parseNumstatPerFile(promptDiffContext.numstatLines);
          const riskScores = computeFileRiskScores({
            files: promptChangedFiles,
            perFileStats,
            filesByCategory: diffAnalysis.filesByCategory,
            weights: config.largePR.riskWeights,
          });
          const tieredFiles = triageFilesByRisk({
            riskScores,
            fileThreshold: config.largePR.fileThreshold,
            fullReviewCount: config.largePR.fullReviewCount,
            abbreviatedCount: config.largePR.abbreviatedCount,
            totalFileCount: promptChangedFiles.length,
          });
          const promptFiles = tieredFiles.isLargePR
            ? [
                ...tieredFiles.full.map((file) => file.filePath),
                ...tieredFiles.abbreviated.map((file) => file.filePath),
              ]
            : promptChangedFiles;

          const prLabels = (explicitReviewPr.labels ?? [])
            .map((label) => typeof label === "string" ? label : label.name)
            .filter((label): label is string => typeof label === "string" && label.length > 0);

          const reviewPromptResult = buildReviewPromptDetails({
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            prTitle: explicitReviewPr.title,
            prBody: explicitReviewPr.body ?? "",
            prAuthor: explicitReviewPr.user?.login ?? "unknown",
            baseBranch: explicitReviewPr.base.ref,
            headBranch: explicitReviewPr.head.ref,
            changedFiles: promptFiles,
            customInstructions: config.review.prompt,
            mode: config.review.mode,
            severityMinLevel: config.review.severity.minLevel,
            focusAreas: config.review.focusAreas,
            ignoredAreas: config.review.ignoredAreas,
            maxComments: config.review.maxComments,
            suppressions: config.review.suppressions,
            minConfidence: config.review.minConfidence,
            diffAnalysis,
            diffContent: explicitReviewPromptDiffContent,
            matchedPathInstructions,
            retrievalContext,
            reviewPrecedents: reviewPrecedentsForPrompt.length > 0 ? reviewPrecedentsForPrompt : undefined,
            wikiKnowledge: wikiKnowledgeForPrompt.length > 0 ? wikiKnowledgeForPrompt : undefined,
            unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
            contextWindow: contextWindowForPrompt,
            filesByLanguage: diffAnalysis.filesByLanguage,
            outputLanguage: config.review.outputLanguage,
            prLabels,
            isDraft: explicitReviewPr.draft,
            smallDiffReview: explicitReviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
            largePRContext: tieredFiles.isLargePR ? {
              fullReviewFiles: tieredFiles.full.map((file) => file.filePath),
              abbreviatedFiles: tieredFiles.abbreviated.map((file) => file.filePath),
              mentionOnlyCount: tieredFiles.mentionOnly.length,
              totalFiles: tieredFiles.totalFiles,
            } : null,
            gitDiffInstructionsAvailable: false,
            publishToolNames: [
              "mcp__github_comment__create_comment",
              "mcp__github_inline_comment__create_inline_comment",
            ],
            candidateFindingToolName: "record_candidate_finding",
            candidateFindingMode: "preferred",
          });
          prompt = reviewPromptResult.text;
          promptSections = [
            buildPromptSectionRecord({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              taskType: explicitReviewRouting.taskType,
              promptKind: "review.user-prompt",
              sections: reviewPromptResult.sections,
            }),
          ];
        } else {
          const mentionPromptResult = buildMentionPromptDetails({
            mention,
            mentionContext,
            retrievalContext,
            userQuestion: writeIntent.request,
            findingContext,
            customInstructions: [config.mention.prompt, planOnlyInstructions, writeInstructions]
              .filter((s) => (s ?? "").trim().length > 0)
              .join("\n\n"),
            outputLanguage: config.review.outputLanguage,
            unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
            contextWindow: contextWindowForPrompt,
            triageContext: triageContext.trim().length > 0 ? triageContext : undefined,
            prDiffContext,
          });
          prompt = mentionPromptResult.text;
          promptSections = [
            buildPromptSectionRecord({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              taskType: "mention.response",
              promptKind: "mention.context",
              sections: mentionContextSectionMetrics,
            }),
            buildPromptSectionRecord({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              taskType: "mention.response",
              promptKind: "mention.user-prompt",
              sections: mentionPromptResult.sections,
            }),
          ].filter((record) => record.sections.length > 0);
        }

        // Cap max turns for read-only conversational PR mentions.
        // Explicit `@kodiai review` requests should use the full review budget so
        // large PRs do not terminate mid-tool-call before any publish step occurs.
        const mentionMaxTurns =
          explicitReviewRequest
            ? explicitReviewMaxTurnsOverride
            : (!writeEnabled && mention.prNumber !== undefined)
              ? (prDiffContext !== undefined ? 12 : 20)
              : undefined; // undefined → falls through to config.maxTurns

        reviewOutputKey = explicitReviewRequest && mention.prNumber !== undefined
          ? buildReviewOutputKey({
              installationId: event.installationId,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              action: "mention-review",
              deliveryId: event.id,
              headSha: mention.headRef ?? "unknown-head-sha",
            })
          : undefined;

        // Execute via Claude. Combined review-and-format requests run Claude first so
        // formatter workspace mutations cannot affect review prompt/executor context;
        // if Claude throws, the formatter subflow still gets an independent attempt.
        if (reviewWorkAttempt) {
          setReviewWorkPhase("executor-dispatch");
        }
        const isCombinedFormatterSuggestionRequest =
          isPrSurface && formatterSuggestionRequest?.mode === "review-and-format";
        let result: Awaited<ReturnType<typeof executor.execute>>;
        try {
          result = await executor.execute({
            workspace,
            installationId: event.installationId,
            owner: mention.owner,
            repo: mention.repo,
            prNumber: mention.prNumber,
            issueNumber: mention.issueNumber,
            // For inline review comment mentions, provide the triggering review comment id
            // so the executor can enable the in-thread reply MCP tool.
            commentId: mention.surface === "pr_review_comment" ? mention.commentId : undefined,
            deliveryId: event.id,
            botHandles: possibleHandles,
            writeMode: writeEnabled,
            taskType: explicitReviewRequest ? explicitReviewRouting.taskType : "mention.response",
            eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
            triggerBody: explicitReviewRequest ? userQuestion : mention.commentBody,
            prompt,
            promptSections,
            reviewOutputKey,
            maxTurnsOverride: mentionMaxTurns,
            dynamicTimeoutSeconds: explicitReviewDynamicTimeoutSeconds,
            knowledgeStore: deps.knowledgeStore,
            formatterSuggestionRequest,
            totalFiles: explicitReviewPromptFileCount,
            enableInlineTools: explicitReviewRequest ? true : undefined,
            enableCandidateFindingTool: explicitReviewRequest ? true : undefined,
            prDiffCommentabilityIndex: explicitReviewRequest ? explicitReviewPrDiffCommentabilityIndex : undefined,
          });
        } catch (err) {
          if (isCombinedFormatterSuggestionRequest) {
            logger.warn(
              {
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                formatterSuggestionRequest: true,
                formatterMode: "review-and-format",
                reviewConclusion: "threw",
                failureCategory: classifyError(err, false),
              },
              "Combined review-and-format review executor threw before formatter subflow",
            );
            const formatterResult = await runFormatterSuggestionForMention("review-and-format");
            const { visibleReplyPosted, visibleReplyFailed } = await postFormatterVisibleDiagnostic(
              formatterResult,
              "review-and-format",
            );
            logger.info(
              {
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
                deliveryId: event.id,
                reviewOutputKey: formatterResult.reviewOutputKey,
                reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
                formatterSuggestionRequest: true,
                formatterMode: "review-and-format",
                reviewConclusion: "threw",
                formatterStatus: formatterResult.status,
                commandStatus: formatterResult.commandStatus,
                publisherStatus: formatterResult.publisherStatus,
                suggestions: formatterResult.suggestions,
                skipped: formatterResult.skipped,
                capped: formatterResult.capped,
                posted: formatterResult.posted,
                publisherSkipped: formatterResult.publisherSkipped,
                publisherFailed: formatterResult.publisherFailed,
                formatterPartialFailure: formatterResult.partialFailure ?? false,
                formatterVisibleReplyPosted: visibleReplyPosted,
                formatterVisibleReplyFailed: visibleReplyFailed,
                combinedPartialFailure: true,
              },
              "Combined review-and-format formatter subflow completed after review executor threw",
            );
          }
          throw err;
        }

        // Explicit PR review mentions bypass the pull_request review handler's
        // deterministic clean-review publish path. Bridge that gap here so a
        // successful no-issues run still produces a GitHub-visible approval.
        let mentionOutputPublished = Boolean(result.published);
        let publishResolution: MentionPublishResolution = mentionOutputPublished ? "executor" : "none";
        let publishFailureCategory: ErrorCategory | null = null;
        let publishFallbackDelivery: MentionErrorDelivery | null = null;
        const explicitReviewFindingLifecycleResult = explicitReviewRequest && mention.prNumber !== undefined && reviewOutputKey
          ? attachReviewFindingLifecycle({
              source: "mention",
              trigger: event.name === "issue_comment"
                ? "issue_comment"
                : event.name === "pull_request_review_comment"
                  ? "review_comment"
                  : event.name === "pull_request_review"
                    ? "review_comment"
                    : "manual",
              correlation: {
                repo: `${mention.owner}/${mention.repo}`,
                pullNumber: mention.prNumber,
                reviewOutputKey,
                deliveryId: event.id,
                commitSha: explicitReviewHeadSha ?? mention.headRef,
                headSha: explicitReviewHeadSha,
                baseSha: explicitReviewBaseSha,
                headRef: mention.headRef,
                baseRef: mention.baseRef,
              },
              findings: [],
              candidateFinding: result.candidateFinding,
            })
          : null;
        if (explicitReviewFindingLifecycleResult) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              ...explicitReviewFindingLifecycleResult.logEvidence,
              source: "explicit-mention-review",
            },
            "Projected explicit mention review finding lifecycle evidence",
          );
          try {
            const explicitReviewValidationTruth = attachReviewValidationTruth({
              lifecycle: explicitReviewFindingLifecycleResult.lifecycle,
              correlation: {
                repo: `${mention.owner}/${mention.repo}`,
                pullNumber: mention.prNumber,
                reviewOutputKey,
                deliveryId: event.id,
                commitSha: explicitReviewHeadSha ?? mention.headRef,
                headSha: explicitReviewHeadSha,
                baseSha: explicitReviewBaseSha,
                headRef: mention.headRef,
                baseRef: mention.baseRef,
              },
              publicationFixes: [],
              requireRevalidation: true,
            });
            logger.info(
              {
                surface: mention.surface,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                ...explicitReviewValidationTruth.logEvidence,
                gateResult: explicitReviewValidationTruth.status,
                source: "explicit-mention-review",
              },
              "Projected explicit mention review validation truth evidence",
            );
          } catch (err) {
            try {
              logger.warn(
                {
                  err,
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "review-validation-truth",
                  gateResult: "degraded",
                  reviewOutputKey,
                  deliveryId: event.id,
                },
                "Explicit mention review validation truth diagnostics failed; continuing review publication",
              );
            } catch {
              // Diagnostics are fail-open for review execution and must not block publication.
            }
          }
        }
        const explicitReviewPublishEvaluation = evaluateExplicitMentionReviewPublish({
          explicitReviewRequest,
          prNumber: mention.prNumber,
          reviewOutputKey,
          result: {
            conclusion: result.conclusion,
            published: result.published,
            usedRepoInspectionTools: result.usedRepoInspectionTools,
            resultText: result.resultText,
            toolUseNames: result.toolUseNames,
          },
        });
        const explicitReviewResultFindingLines = explicitReviewPublishEvaluation.findingLines;
        const explicitReviewPublishEligible = explicitReviewPublishEvaluation.eligible;

        if (explicitReviewRequest && mention.prNumber !== undefined && !explicitReviewPublishEligible) {
          logExplicitMentionReviewPublishSkipped({
            logger,
            baseLog: {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
            },
            evaluation: explicitReviewPublishEvaluation,
            reviewOutputKey,
            result: {
              conclusion: result.conclusion,
              published: result.published,
              usedRepoInspectionTools: result.usedRepoInspectionTools,
              toolUseNames: result.toolUseNames,
            },
            autoApprove: config.review.autoApprove,
          });
        }

        if (explicitReviewPublishEligible && reviewOutputKey && mention.prNumber !== undefined) {
          const publishOctokit = await githubApp.getInstallationOctokit(event.installationId);
          try {
            const idempotencyCheck = await ensureReviewOutputNotPublished({
              octokit: publishOctokit,
              owner: mention.owner,
              repo: mention.repo,
              prNumber: mention.prNumber,
              reviewOutputKey,
            });

            if (!idempotencyCheck.shouldPublish) {
              mentionOutputPublished = true;
              publishResolution = "idempotency-skip";
              logger.info(
                {
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "review-output-idempotency",
                  gateResult: "skipped",
                  skipReason: "already-published",
                  ...buildReviewOutputPublicationLogFields(idempotencyCheck),
                },
                "Skipping explicit mention review publish because output already exists",
              );
            } else {
              logger.info(
                {
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "review-output-idempotency",
                  gateResult: "accepted",
                  ...buildReviewOutputPublicationLogFields(idempotencyCheck),
                },
                "Explicit mention review idempotency check passed",
              );

              const appSlug = githubApp.getAppSlug();
              logger.info(
                {
                  surface: mention.surface,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  gate: "explicit-review-publish",
                  gateResult: "attempt",
                  publishAttemptOutcome: "attempting-approval",
                  reviewOutputKey,
                },
                "Attempting explicit mention review approval publish",
              );
              const explicitReviewLifecycleEvidenceLine = buildExplicitReviewLifecycleEvidenceLine(
                explicitReviewFindingLifecycleResult,
              );
              const approvalEvidence = [
                typeof explicitReviewPromptFileCount === "number"
                  ? `Review prompt covered ${explicitReviewPromptFileCount} changed file${explicitReviewPromptFileCount === 1 ? "" : "s"}.`
                  : null,
                result.usedRepoInspectionTools === true
                  ? "Repo inspection tools were used to verify the changed code."
                  : null,
                explicitReviewLifecycleEvidenceLine,
              ].filter((line): line is string => Boolean(line));

              if (!canPublishExplicitReviewOutput("explicit mention review publish", reviewOutputKey)) {
                logger.info(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    gate: "explicit-review-publish",
                    gateResult: "skipped",
                    skipReason: "publish-rights-lost",
                    reviewOutputKey,
                  },
                  "Skipping explicit mention review publish because publish rights were superseded",
                );
              } else {
                setReviewWorkPhase("publish");
                const cleanReviewBody = sanitizeOutgoingMentions(
                  buildApprovedReviewBody({ reviewOutputKey, evidence: approvalEvidence }),
                  [appSlug, "claude", "kodai"],
                );
                if (config.review.autoApprove) {
                  await publishOctokit.rest.pulls.createReview({
                    owner: mention.owner,
                    repo: mention.repo,
                    pull_number: mention.prNumber,
                    event: "APPROVE",
                    body: cleanReviewBody,
                  });
                  publishResolution = "approval-bridge";
                } else {
                  await publishOctokit.rest.issues.createComment({
                    owner: mention.owner,
                    repo: mention.repo,
                    issue_number: mention.prNumber,
                    body: cleanReviewBody,
                  });
                  publishResolution = "comment-approval";
                }
                mentionOutputPublished = true;
                logger.info(
                  {
                    evidenceType: "review",
                    outcome: config.review.autoApprove ? "submitted-approval" : "published-comment-approval",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    prNumber: mention.prNumber,
                    reviewOutputKey,
                    publishAttemptOutcome: config.review.autoApprove ? "submitted-approval" : "submitted-comment",
                  },
                  config.review.autoApprove
                    ? "Submitted approval review for explicit mention request"
                    : "Submitted approval-shaped comment for explicit mention request",
                );
              }
            }
          } catch (publishErr) {
            publishFailureCategory = classifyError(publishErr, false);
            logger.warn(
              {
                err: publishErr,
                deliveryId: event.id,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                reviewOutputKey,
                publishAttemptOutcome:
                  publishFailureCategory === "api_error" ? "github-api-rejected" : "failed",
                publishFailureCategory,
              },
              "Failed to submit approval review for explicit mention request",
            );

            let outputDetectedAfterError = false;
            try {
              const recheck = await ensureReviewOutputNotPublished({
                octokit: publishOctokit,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                reviewOutputKey,
              });

              if (!recheck.shouldPublish) {
                mentionOutputPublished = true;
                publishResolution = "duplicate-suppressed";
                outputDetectedAfterError = true;
                logger.info(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    gate: "review-output-idempotency",
                    gateResult: "recovered",
                    skipReason: "output-detected-after-error",
                    ...buildReviewOutputPublicationLogFields(recheck),
                  },
                  "Explicit mention review publish error still produced output; suppressing fallback",
                );
              }
            } catch (recheckErr) {
              logger.warn(
                {
                  err: recheckErr,
                  deliveryId: event.id,
                  owner: mention.owner,
                  repo: mention.repo,
                  prNumber: mention.prNumber,
                  reviewOutputKey,
                  publishAttemptOutcome: "recheck-failed",
                  publishFailureCategory,
                },
                "Failed to recheck explicit mention review output after publish error",
              );
            }

            if (!outputDetectedAfterError) {
              if (!canPublishExplicitReviewOutput("explicit mention review fallback comment", reviewOutputKey)) {
                logger.info(
                  {
                    surface: mention.surface,
                    owner: mention.owner,
                    repo: mention.repo,
                    prNumber: mention.prNumber,
                    gate: "explicit-review-publish",
                    gateResult: "skipped",
                    skipReason: "publish-rights-lost",
                    reviewOutputKey,
                    publishFailureCategory,
                  },
                  "Skipping explicit mention review fallback because publish rights were superseded",
                );
              } else {
                setReviewWorkPhase("publish");
                const fallbackResult = await postMentionError(
                  buildExplicitMentionReviewPublishFailureBody({
                    publishErr,
                    summarizeError: summarizeErrorForDiagnostics,
                  }),
                );
                publishFallbackDelivery = fallbackResult.delivery;

                if (fallbackResult.posted) {
                  mentionOutputPublished = true;
                  publishResolution = "publish-failure-fallback";
                } else {
                  mentionOutputPublished = false;
                  publishResolution = "publish-failure-comment-failed";
                  logger.warn(
                    {
                      deliveryId: event.id,
                      owner: mention.owner,
                      repo: mention.repo,
                      prNumber: mention.prNumber,
                      reviewOutputKey,
                      publishAttemptOutcome: "fallback-comment-failed",
                      publishFailureCategory,
                      publishFallbackDelivery,
                    },
                    "Explicit mention review publish fallback could not be delivered",
                  );
                }
              }
            }
          }
        }

        const mentionExecutionErrorCategory = result.errorMessage !== undefined
          ? classifyError(new Error(result.errorMessage), result.isTimeout ?? false, result.published)
          : undefined;
        const mentionFailureSubtype = result.failureSubtype
          ?? classifyMentionExecutionFailureSubtype(result.errorMessage);

        const logMentionExecutionCompleted = (): void => {
          const expectedTurnLimitOutcome = isExpectedTurnLimitMentionOutcome({
            conclusion: result.conclusion,
            stopReason: result.stopReason,
            failureSubtype: mentionFailureSubtype,
          });
          logger.info(
            {
              surface: mention.surface,
              issueNumber: mention.issueNumber,
              conclusion: expectedTurnLimitOutcome ? "expected_bounded" : result.conclusion,
              ...(expectedTurnLimitOutcome
                ? { boundedOutcomeReason: "max_turns" }
                : { failureSubtype: mentionFailureSubtype }),
              published: mentionOutputPublished,
              executorPublished: result.published,
              publishResolution: expectedTurnLimitOutcome
                ? cleanTurnLimitMentionPublishResolution(publishResolution)
                : publishResolution,
              ...(expectedTurnLimitOutcome ? {} : { publishFailureCategory }),
              publishFallbackDelivery: expectedTurnLimitOutcome
                ? mapTurnLimitFallbackDelivery(publishFallbackDelivery)
                : publishFallbackDelivery,
              writeEnabled,
              costUsd: result.costUsd,
              numTurns: result.numTurns,
              durationMs: result.durationMs,
              sessionId: result.sessionId,
              stopReason: result.stopReason,
              ...(expectedTurnLimitOutcome ? {} : { errorCategory: mentionExecutionErrorCategory }),
              usedRepoInspectionTools: result.usedRepoInspectionTools ?? false,
              toolUseNames: result.toolUseNames ?? [],
              mentionDerivedContextCacheStatus,
              ...(mentionDerivedContextCacheReason
                ? { mentionDerivedContextCacheReason }
                : {}),
              ...(explicitReviewRequest
                ? {
                  explicitReviewRequest: true,
                  taskType: "review.full",
                  lane: "interactive-review",
                }
                : {}),
              ...(reviewOutputKey ? { reviewOutputKey } : {}),
            },
            "Mention execution completed",
          );
        };
        const shouldDeferMentionCompletionLog =
          !mentionOutputPublished
          && !reviewPublishRightsLost
          && (result.conclusion === "failure" || result.conclusion === "error");
        if (!shouldDeferMentionCompletionLog) {
          logMentionExecutionCompleted();
        }

        if (mention.inReplyToId !== undefined && result.conclusion === "success") {
          const conversationKey = `${mention.owner}/${mention.repo}#${mention.prNumber ?? mention.issueNumber}`;
          conversationTurnStore.recordSuccessfulTurn(conversationKey);
        }

        // Telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          try {
            await telemetryStore.recordRateLimitEvent({
              deliveryId: event.id,
              executionIdentity: `${event.id}:reuse.mention-derived-context`,
              repo: `${mention.owner}/${mention.repo}`,
              prNumber: mention.prNumber,
              eventType: "reuse.mention-derived-context",
              cacheHitRate: mentionDerivedContextCacheStatus === "hit" ? 1 : 0,
              skippedQueries: mentionDerivedContextCacheStatus === "hit" ? 1 : 0,
              retryAttempts: mentionDerivedContextCacheStatus === "hit" ? 0 : 1,
              degradationPath: mentionDerivedContextCacheReason
                ? `${mentionDerivedContextCacheStatus}:${mentionDerivedContextCacheReason}`
                : mentionDerivedContextCacheStatus,
            });
          } catch (err) {
            logger.warn({ err }, "Mention reuse telemetry write failed (non-blocking)");
          }

          try {
            await telemetryStore.record({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              prNumber: mention.prNumber,
              eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
              model: result.model ?? "unknown",
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              cacheReadTokens: result.cacheReadTokens,
              cacheCreationTokens: result.cacheCreationTokens,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              conclusion: result.conclusion,
              sessionId: result.sessionId,
              numTurns: result.numTurns,
              stopReason: result.stopReason,
            });
          } catch (err) {
            logger.warn({ err }, "Telemetry write failed (non-blocking)");
          }

          try {
            await mapWithConcurrency(
              result.promptSections ?? promptSections,
              4,
              (promptSectionRecord) => telemetryStore.recordPromptSections(promptSectionRecord),
            );
          } catch (err) {
            logger.warn({ err }, "Prompt-section telemetry write failed (non-blocking)");
          }

          // Cost warning (CONFIG-11)
          if (
            config.telemetry.costWarningUsd > 0 &&
            result.costUsd !== undefined &&
            result.costUsd > config.telemetry.costWarningUsd
          ) {
            logger.warn(
              {
                costUsd: result.costUsd,
                threshold: config.telemetry.costWarningUsd,
                repo: `${mention.owner}/${mention.repo}`,
                prNumber: mention.prNumber,
              },
              "Execution cost exceeded warning threshold",
            );
            try {
              if (
                !explicitReviewRequest ||
                canPublishExplicitReviewOutput("explicit mention review cost warning comment", reviewOutputKey)
              ) {
                const warnOctokit = await githubApp.getInstallationOctokit(event.installationId);
                await warnOctokit.rest.issues.createComment({
                  owner: mention.owner,
                  repo: mention.repo,
                  issue_number: mention.issueNumber,
                  body: `> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, exceeding the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``,
                });
              }
            } catch (err) {
              logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
            }
          }
        }

        // Write-mode: trusted code publishes the branch + PR and replies with a link.
        if (writeEnabled && writeOutputKey && writeBranchName) {
          const isIssueWritePublishFlow = isIssueThreadComment;
          const publishFailureStatus = "pr_creation_failed" as const;

          const postIssueWriteFailure = async (
            failedStep: IssueWriteFailureStep,
            err: unknown,
          ): Promise<void> => {
            if (!isIssueWritePublishFlow) {
              throw err instanceof Error ? err : new Error(String(err));
            }

            const replyBody = buildIssueWriteFailureReply({
              failedStep,
              diagnostics: summarizeErrorForDiagnostics(err),
              retryCommand,
            });

            await postMentionReply(replyBody, { sanitizeMentions: false });

            logger.warn(
              {
                evidenceType: "write-mode",
                outcome: publishFailureStatus,
                deliveryId: event.id,
                installationId: event.installationId,
                owner: mention.owner,
                repoName: mention.repo,
                repo: `${mention.owner}/${mention.repo}`,
                sourcePrNumber: mention.prNumber,
                triggerCommentId: mention.commentId,
                triggerCommentUrl,
                writeOutputKey,
                failedStep,
                diagnostics: summarizeErrorForDiagnostics(err),
              },
              "Issue write-mode publish failed",
            );
          };

          const status = await getGitStatusPorcelain(workspace.dir);
          if (status.trim().length === 0) {
            const replyBody = wrapInDetails(
              [
                "I didn't end up making any file changes.",
                "",
                "If you still want a change, re-run with a more specific request.",
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }

          // Fork-based output routing: determine gist vs PR (Phase 127)
          if (forkContext && gistPublisher?.enabled) {
            const changedFiles = await collectWorkspaceChangedFiles(workspace.dir);
            const useGist = shouldUseGist({ keyword: writeIntent.keyword }, changedFiles);

            if (useGist) {
              // Gist path: generate patch and create gist
              try {
                const patchResult = await buildStagedPatchForGist(workspace.dir);
                const patch = patchResult.stdout;

                if (patch.trim().length === 0) {
                  const replyBody = wrapInDetails(
                    "No diff content to create a patch from.",
                    "kodiai response",
                  );
                  await postMentionReply(replyBody);
                  return;
                }
                if (patchResult.stdoutTruncated) {
                  const replyBody = wrapInDetails(
                    "The generated patch is too large to publish as a gist. Please split the request into smaller changes.",
                    "kodiai response",
                  );
                  await postMentionReply(replyBody);
                  return;
                }

                const requestSummary = summarizeWriteRequest(writeIntent.request);
                const gist = await gistPublisher.createPatchGist({
                  owner: mention.owner,
                  repo: mention.repo,
                  summary: requestSummary,
                  patch,
                });

                // Post gist link as comment with apply instructions
                const gistReplyBody = wrapInDetails(
                  [
                    `Patch gist: ${gist.htmlUrl}`,
                    "",
                    "To apply this patch locally:",
                    "```bash",
                    `curl -sL ${gist.htmlUrl}.patch | git apply`,
                    "```",
                    "",
                    `Files changed: ${changedFiles.join(", ")}`,
                  ].join("\n"),
                  "kodiai response",
                );
                await postMentionReply(gistReplyBody);

                logger.info(
                  {
                    evidenceType: "write-mode",
                    outcome: "created-gist",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    gistUrl: gist.htmlUrl,
                    gistId: gist.id,
                    changedFiles,
                    writeOutputKey,
                    triggerCommentUrl,
                  },
                  "Evidence bundle",
                );
                return;
              } catch (gistErr) {
                logger.warn(
                  { err: gistErr, owner: mention.owner, repo: mention.repo },
                  "Gist creation failed; falling through to PR path",
                );
                // Fall through to PR path
              }
            }

            // PR path with fork: commit, push to fork, create cross-fork PR
            try {
              await assertOriginIsFork(workspace.dir, forkContext.forkOwner);

              const branchName = writeBranchName;
              const sourceRef = mention.prNumber !== undefined
                ? `PR #${mention.prNumber}`
                : `#${mention.issueNumber}`;
              const commitRequestSummary = summarizeWriteRequest(writeIntent.request);
              const commitSubject = generateCommitSubject({
                issueTitle: mention.issueTitle,
                requestSummary: commitRequestSummary,
                isFromPr: mention.prNumber !== undefined,
                ref: sourceRef,
              });
              const commitMessage = [
                commitSubject,
                "",
                `kodiai-write-output-key: ${writeOutputKey}`,
                `deliveryId: ${event.id}`,
              ].join("\n");

              const pushed = await createBranchCommitAndPush({
                dir: workspace.dir,
                branchName,
                commitMessage,
                policy: {
                  allowPaths: config.write.allowPaths,
                  denyPaths: config.write.denyPaths,
                  secretScanEnabled: config.write.secretScan.enabled,
                },
                token: forkContext.botPat,
              });

              // Cross-fork PR: head uses forkOwner:branchName format
              const crossForkHead = `${forkContext.forkOwner}:${pushed.branchName}`;
              const prBaseRef = mention.prNumber !== undefined ? (mention.baseRef ?? "main") : (cloneRef ?? "main");

              let diffStat = "";
              try {
                diffStat = (await $`git -C ${workspace.dir} diff --stat HEAD~1 HEAD`.quiet()).text().trim();
              } catch {
                // diff stat is best-effort
              }

              let fabricationWarnings: string[] = [];
              try {
                fabricationWarnings = await scanDiffForFabricatedContent(workspace.dir);
              } catch {
                // best-effort scan
              }

              const requestSummary = summarizeWriteRequest(writeIntent.request);
              const prTitle = generatePrTitle(mention.issueTitle, requestSummary, mention.prNumber !== undefined);
              const sourceUrl =
                mention.prNumber !== undefined
                  ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
                  : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;
              const prBody = generatePrBody({
                summary: requestSummary,
                issueTitle: mention.issueTitle,
                sourceUrl,
                triggerCommentUrl,
                deliveryId: event.id,
                headSha: pushed.headSha,
                isFromPr: mention.prNumber !== undefined,
                issueNumber: mention.issueNumber,
                prNumber: mention.prNumber,
                diffStat,
                warnings: fabricationWarnings,
              });

              const response = await octokit.rest.pulls.create({
                owner: mention.owner,
                repo: mention.repo,
                title: prTitle,
                head: crossForkHead,
                base: prBaseRef,
                body: prBody,
              });

              const createdPrUrl = response.data.html_url;
              const issueLinkbackUrl =
                mention.prNumber !== undefined
                  ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
                  : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;

              const replyBody = buildIssueWriteSuccessReply({
                prUrl: createdPrUrl,
                issueLinkbackUrl,
              });
              await postMentionReply(replyBody);

              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "created-cross-fork-pr",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  forkOwner: forkContext.forkOwner,
                  crossForkHead,
                  prUrl: createdPrUrl,
                  commitSha: pushed.headSha,
                  writeOutputKey,
                  triggerCommentUrl,
                },
                "Evidence bundle",
              );
              return;
            } catch (forkPrErr) {
              // Fallback to gist on fork/PR failure
              logger.warn(
                { err: forkPrErr, owner: mention.owner, repo: mention.repo },
                "Fork-based PR creation failed; falling back to gist",
              );

              if (forkPrErr instanceof WritePolicyError) {
                const refusal = buildWritePolicyRefusalMessage(forkPrErr, config.write.allowPaths);
                const replyBody = wrapInDetails(refusal, "kodiai response");
                await postMentionReply(replyBody);
                return;
              }

              if (gistPublisher.enabled) {
                try {
                  const patchResult = await buildStagedPatchForGist(workspace.dir);
                  const patch = patchResult.stdout;
                  if (patchResult.stdoutTruncated) {
                    throw new Error("Generated patch exceeds gist publication limit");
                  }
                  if (patch.trim().length > 0) {
                    const requestSummary = summarizeWriteRequest(writeIntent.request);
                    const gist = await gistPublisher.createPatchGist({
                      owner: mention.owner,
                      repo: mention.repo,
                      summary: requestSummary,
                      patch,
                    });

                    const gistReplyBody = wrapInDetails(
                      [
                        "Could not create a PR from the fork, but here is the patch as a gist:",
                        "",
                        `Patch gist: ${gist.htmlUrl}`,
                        "",
                        "To apply this patch locally:",
                        "```bash",
                        `curl -sL ${gist.htmlUrl}.patch | git apply`,
                        "```",
                      ].join("\n"),
                      "kodiai response",
                    );
                    await postMentionReply(gistReplyBody);

                    logger.info(
                      {
                        evidenceType: "write-mode",
                        outcome: "fallback-gist",
                        deliveryId: event.id,
                        owner: mention.owner,
                        repo: `${mention.owner}/${mention.repo}`,
                        gistUrl: gist.htmlUrl,
                        writeOutputKey,
                      },
                      "Evidence bundle",
                    );
                    return;
                  }
                } catch (fallbackErr) {
                  logger.error(
                    { err: fallbackErr },
                    "Fallback gist creation also failed",
                  );
                }
              }

              // If gist fallback failed too, fall through to legacy behavior
              logger.warn(
                { owner: mention.owner, repo: mention.repo },
                "Fork-based write mode failed completely; falling through to legacy direct-push path",
              );
            }
          }

          const sourcePrUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : undefined;

          const normalizeName = (s: string | undefined): string => (s ?? "").trim().toLowerCase();
          const sameRepoHead =
            normalizeName(mention.headRepoOwner) === normalizeName(mention.owner) &&
            normalizeName(mention.headRepoName) === normalizeName(mention.repo) &&
            typeof mention.headRef === "string" &&
            mention.headRef.length > 0;

          // Preferred path: update existing PR branch when possible.
          if (mention.prNumber !== undefined && sameRepoHead && mention.headRef) {
            const headRef = mention.headRef;
            const idempotencyMarker = `kodiai-write-output-key: ${writeOutputKey}`;

            // NOTE: The in-flight lock is acquired earlier for all write-mode requests.
            // It is in-process only; in multi-replica deployments, two replicas can still
            // do duplicate work concurrently. This project currently deploys with max-replicas=1.

            try {
              await fetchRemoteTrackingBranch({
                dir: workspace.dir,
                branch: headRef,
                token: workspace.token,
                depth: 50,
              });
              const recentMessages = (
                await $`git -C ${workspace.dir} log -n 50 --pretty=%B refs/remotes/origin/${headRef}`.quiet()
              )
                .text();
              if (recentMessages.includes(idempotencyMarker)) {
                logger.info(
                  {
                    evidenceType: "write-mode",
                    outcome: "skipped-idempotent",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    sourcePrNumber: mention.prNumber,
                    triggerCommentId: mention.commentId,
                    triggerCommentUrl,
                    writeOutputKey,
                    prUrl: sourcePrUrl,
                  },
                  "Evidence bundle",
                );

                const replyBody = wrapInDetails(
                  [`Already applied (idempotent): ${sourcePrUrl}`].join("\n"),
                  "kodiai response",
                );
                await postMentionReply(replyBody);
                return;
              }
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, headRef },
                "Failed to check idempotency marker on head ref; continuing",
              );
            }

            try {
              await $`git -C ${workspace.dir} checkout -B pr-head refs/remotes/origin/${headRef}`.quiet();

              const requestSummary = summarizeWriteRequest(writeIntent.request);
              const commitSubject = generateCommitSubject({
                issueTitle: mention.issueTitle,
                requestSummary,
                isFromPr: true,
                ref: `PR #${mention.prNumber}`,
              });
              const commitMessage = [
                commitSubject,
                "",
                idempotencyMarker,
                `deliveryId: ${event.id}`,
              ].join("\n");

              const pushed = await commitAndPushToRemoteRef({
                dir: workspace.dir,
                remoteRef: headRef,
                commitMessage,
                policy: {
                  allowPaths: config.write.allowPaths,
                  denyPaths: config.write.denyPaths,
                  secretScanEnabled: config.write.secretScan.enabled,
                },
                token: workspace.token,
              });

              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "updated-pr-branch",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  sourcePrNumber: mention.prNumber,
                  triggerCommentId: mention.commentId,
                  triggerCommentUrl,
                  writeOutputKey,
                  headRef,
                  commitSha: pushed.headSha,
                  prUrl: sourcePrUrl,
                },
                "Evidence bundle",
              );

              const replyBody = wrapInDetails(
                [`Updated PR: ${sourcePrUrl}`].join("\n"),
                "kodiai response",
              );
              try {
                await postMentionReply(replyBody);
              } catch (replyErr) {
                logger.warn(
                  { err: replyErr, prNumber: mention.prNumber, headRef },
                  "Applied changes but failed to post confirmation reply",
                );
              }
              return;
            } catch (err) {
              if (err instanceof WritePolicyError) {
                const refusal = buildWritePolicyRefusalMessage(err, config.write.allowPaths);
                const replyBody = wrapInDetails(refusal, "kodiai response");
                await postMentionReply(replyBody);
                return;
              }

              if (await maybeReplyWritePermissionFailure(err)) {
                return;
              }

              // If another concurrent run already pushed an idempotent commit, treat this as a no-op.
              try {
                await fetchRemoteTrackingBranch({
                  dir: workspace.dir,
                  branch: headRef,
                  token: workspace.token,
                  depth: 50,
                });
                const recentMessages = (
                  await $`git -C ${workspace.dir} log -n 50 --pretty=%B refs/remotes/origin/${headRef}`.quiet()
                )
                  .text();
                if (recentMessages.includes(idempotencyMarker)) {
                  logger.info(
                    {
                      evidenceType: "write-mode",
                      outcome: "skipped-idempotent",
                      deliveryId: event.id,
                      installationId: event.installationId,
                      owner: mention.owner,
                      repoName: mention.repo,
                      repo: `${mention.owner}/${mention.repo}`,
                      sourcePrNumber: mention.prNumber,
                      triggerCommentId: mention.commentId,
                      triggerCommentUrl,
                      writeOutputKey,
                      prUrl: sourcePrUrl,
                    },
                    "Evidence bundle",
                  );

                  const replyBody = wrapInDetails(
                    [`Already applied (idempotent): ${sourcePrUrl}`].join("\n"),
                    "kodiai response",
                  );
                  await postMentionReply(replyBody);
                  return;
                }
              } catch (lookupErr) {
                logger.warn(
                  { err: lookupErr, prNumber: mention.prNumber, headRef },
                  "Failed to re-check idempotency marker after push failure",
                );
              }

              logger.warn(
                { err, prNumber: mention.prNumber, headRef },
                "Failed to push to PR head branch; falling back to bot PR",
              );

              // Fallback: push current HEAD to deterministic bot branch and open bot PR.
              try {
                await pushHeadToRemoteRef({
                  dir: workspace.dir,
                  remoteRef: writeBranchName,
                  token: workspace.token,
                });
              } catch (pushErr) {
                if (await maybeReplyWritePermissionFailure(pushErr)) {
                  return;
                }
                logger.error(
                  { err: pushErr, prNumber: mention.prNumber, branchName: writeBranchName },
                  "Fallback push to bot branch failed",
                );
                throw err;
              }
              // Continue into bot PR creation below.
            }
          }

          const branchName = writeBranchName;
          const sourceRef = mention.prNumber !== undefined
            ? `PR #${mention.prNumber}`
            : `#${mention.issueNumber}`;
          const commitRequestSummary = summarizeWriteRequest(writeIntent.request);
          const commitSubject = generateCommitSubject({
            issueTitle: mention.issueTitle,
            requestSummary: commitRequestSummary,
            isFromPr: mention.prNumber !== undefined,
            ref: sourceRef,
          });
          const commitMessage = [
            commitSubject,
            "",
            `kodiai-write-output-key: ${writeOutputKey}`,
            `deliveryId: ${event.id}`,
          ].join("\n");

          let pushed: { branchName: string; headSha: string };
          try {
            pushed = await createBranchCommitAndPush({
              dir: workspace.dir,
              branchName,
              commitMessage,
              policy: {
                allowPaths: config.write.allowPaths,
                denyPaths: config.write.denyPaths,
                secretScanEnabled: config.write.secretScan.enabled,
              },
              token: workspace.token,
            });
          } catch (err) {
            if (err instanceof WritePolicyError) {
              const refusal = buildWritePolicyRefusalMessage(err, config.write.allowPaths);
              const replyBody = wrapInDetails(refusal, "kodiai response");
              await postMentionReply(replyBody);
              return;
            }

            if (await maybeReplyWritePermissionFailure(err)) {
              return;
            }

            // If the branch already exists (e.g. replay), try to find the existing PR.
            if (err instanceof Error) {
              const msg = err.message.toLowerCase();
              const looksLikeBranchExists =
                msg.includes("non-fast-forward") ||
                msg.includes("fetch first") ||
                msg.includes("rejected") ||
                msg.includes("already exists");
              if (looksLikeBranchExists) {
                try {
                  const { data: prs } = await octokit.rest.pulls.list({
                    owner: mention.owner,
                    repo: mention.repo,
                    state: "all",
                    head: `${mention.owner}:${branchName}`,
                    per_page: 5,
                  });
                  const existing = prs[0];
                  if (existing?.html_url) {
                    const replyBody = wrapInDetails(
                      [`Existing PR: ${existing.html_url}`].join("\n"),
                      "kodiai response",
                    );
                    await postMentionReply(replyBody);
                    return;
                  }
                } catch (lookupErr) {
                  logger.warn(
                    { err: lookupErr, prNumber: mention.prNumber, branchName },
                    "Failed to look up existing PR after push failure",
                  );
                }
              }
            }

            await postIssueWriteFailure("branch-push", err);
            return;
          }

          let diffStat = "";
          try {
            diffStat = (await $`git -C ${workspace.dir} diff --stat HEAD~1 HEAD`.quiet()).text().trim();
          } catch {
            // diff stat is best-effort
          }

          let fabricationWarnings: string[] = [];
          try {
            fabricationWarnings = await scanDiffForFabricatedContent(workspace.dir);
          } catch {
            // best-effort scan, do not block PR creation
          }

          const requestSummary = summarizeWriteRequest(writeIntent.request);
          const prTitle = generatePrTitle(mention.issueTitle, requestSummary, mention.prNumber !== undefined);
          const sourceUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;
          const prBody = generatePrBody({
            summary: requestSummary,
            issueTitle: mention.issueTitle,
            sourceUrl,
            triggerCommentUrl,
            deliveryId: event.id,
            headSha: pushed.headSha,
            isFromPr: mention.prNumber !== undefined,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            diffStat,
            warnings: fabricationWarnings,
          });

          const prBaseRef = mention.prNumber !== undefined ? (mention.baseRef ?? "main") : (cloneRef ?? "main");

          let createdPr: { html_url: string } | undefined;
          const maxPrCreateAttempts = isIssueWritePublishFlow ? 2 : 1;
          for (let attempt = 1; attempt <= maxPrCreateAttempts; attempt++) {
            try {
              const response = await octokit.rest.pulls.create({
                owner: mention.owner,
                repo: mention.repo,
                title: prTitle,
                head: pushed.branchName,
                base: prBaseRef,
                body: prBody,
              });
              createdPr = response.data;
              break;
            } catch (err) {
              if (await maybeReplyWritePermissionFailure(err)) {
                return;
              }

              if (attempt < maxPrCreateAttempts) {
                logger.warn(
                  {
                    err,
                    owner: mention.owner,
                    repo: mention.repo,
                    issueNumber: mention.issueNumber,
                    attempt,
                    maxAttempts: maxPrCreateAttempts,
                    branchName: pushed.branchName,
                    writeOutputKey,
                  },
                  "Issue write-mode PR creation failed, retrying once",
                );
                continue;
              }

              await postIssueWriteFailure("create-pr", err);
              return;
            }
          }

          if (!createdPr?.html_url) {
            await postIssueWriteFailure(
              "create-pr",
              new Error("GitHub pulls.create response did not include html_url"),
            );
            return;
          }

          const issueLinkbackUrl =
            mention.prNumber !== undefined
              ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
              : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;

          const replyBody = buildIssueWriteSuccessReply({
            prUrl: createdPr.html_url,
            issueLinkbackUrl,
          });
          try {
            await postMentionReply(replyBody);
          } catch (err) {
            await postIssueWriteFailure("issue-linkback", err);
            return;
          }

          logger.info(
            {
              evidenceType: "write-mode",
              outcome: "created-pr",
              deliveryId: event.id,
              installationId: event.installationId,
              owner: mention.owner,
              repoName: mention.repo,
              repo: `${mention.owner}/${mention.repo}`,
              sourcePrNumber: mention.prNumber,
              triggerCommentId: mention.commentId,
              triggerCommentUrl,
              writeOutputKey,
              branchName,
              prUrl: createdPr.html_url,
              commitSha: pushed.headSha,
            },
            "Evidence bundle",
          );

          // Record successful publish time for rate limiting.
          if (config.write.minIntervalSeconds > 0) {
            const key = `${event.installationId}:${mention.owner}/${mention.repo}`;
            writeRateLimitStore.recordWrite(key);
          }

          return;
        }

        // If Claude finished successfully but did not publish any output, post a fallback reply.
        // This prevents "silent success" where the model chose not to call any comment tools.
        // Explicit review publish failures that already exhausted the comment fallback path must
        // not fall through here, or we spam the same broken comment surface with a less specific reply.
        if (
          !writeEnabled &&
          result.conclusion === "success" &&
          !mentionOutputPublished &&
          publishResolution !== "publish-failure-comment-failed" &&
          !reviewPublishRightsLost
        ) {
          const fallbackLines = explicitReviewRequest
            ? explicitReviewPublishEvaluation.hasUnpublishedFindings
              ? explicitReviewResultFindingLines.length > 0
                ? ["Decision: NOT APPROVED", "Issues:", ...explicitReviewResultFindingLines]
                // No parseable finding lines, but the agent's review text holds the
                // findings — surface it rather than hide it behind a generic apology.
                : buildExplicitReviewTextFallbackLines(result.resultText)
              : buildExplicitReviewNoOutputFallbackLines(explicitReviewPublishEvaluation.skipReason)
            : [
                "I can answer this, but I need one detail first.",
                "",
                "Could you share the exact outcome you want and the primary file/path I should focus on first?",
              ];

          const fallbackBody = wrapInDetails(
            fallbackLines.join("\n"),
            "kodiai response",
          );
          const sanitizedFallbackBody = sanitizeOutgoingMentions(fallbackBody, possibleHandles);

          if (
            !explicitReviewRequest
            || canPublishExplicitReviewOutput("explicit mention review fallback reply", reviewOutputKey)
          ) {
            const replyOctokit = await githubApp.getInstallationOctokit(event.installationId);
            if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
              await replyOctokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedFallbackBody,
              });
            } else {
              await replyOctokit.rest.issues.createComment({
                owner: mention.owner,
                repo: mention.repo,
                issue_number: mention.issueNumber,
                body: sanitizedFallbackBody,
              });
            }
          }
        }

        // If execution errored, post or update error comment with classified message
        if (result.conclusion === "error" && !reviewPublishRightsLost) {
          const category = result.isTimeout
            ? "timeout"
            : classifyError(new Error(result.errorMessage ?? "Unknown error"), false);
          const errorBody = wrapInDetails(
            formatErrorComment(
              category,
              result.errorMessage ?? "An unexpected error occurred while processing your request.",
            ),
            "Kodiai encountered an error",
          );
          if (
            !explicitReviewRequest
            || canPublishExplicitReviewOutput("explicit mention review error fallback", reviewOutputKey)
          ) {
            const fallbackResult = await postMentionError(errorBody);
            publishFallbackDelivery = fallbackResult.delivery;
            if (fallbackResult.posted) {
              mentionOutputPublished = true;
              publishResolution = "error-fallback";
            } else {
              mentionOutputPublished = false;
              publishResolution = "error-comment-failed";
            }
          }
        }

        // If execution failed without publishing, always post a user-visible fallback.
        // The SDK can return conclusion="failure" with stop reasons other than max_turns,
        // and previously those paths could finish silently.
        if (result.conclusion === "failure" && !mentionOutputPublished && !reviewPublishRightsLost) {
          const exhaustedTurnBudget =
            result.stopReason === "max_turns"
            || result.failureSubtype === "error_max_turns";
          if (exhaustedTurnBudget) {
            const turnLimitBody = wrapInDetails(
              [
                "I ran out of steps analyzing this and wasn't able to post a complete response.",
                "",
                ...(explicitReviewRouting.routingReason === "tiny-diff"
                  ? [
                      "This was a tiny-diff review, so this indicates an execution-budget or tool-loop problem rather than PR size. The run has been recorded with small-diff routing diagnostics.",
                    ]
                  : [
                      "No review findings were published for this request.",
                      "",
                      "This usually means the agent got stuck in tool use or exceeded its step budget for this run.",
                      "Try a narrower request such as `@kodiai review path/to/file.cpp` if it repeats.",
                    ]),
              ].join("\n"),
              "kodiai response",
            );
            try {
              if (
                !explicitReviewRequest
                || canPublishExplicitReviewOutput("explicit mention review failure fallback", reviewOutputKey)
              ) {
                const fallbackResult = await postMentionError(turnLimitBody);
                publishFallbackDelivery = fallbackResult.delivery;
                if (fallbackResult.posted) {
                  mentionOutputPublished = true;
                  publishResolution = "turn-limit-fallback";
                } else {
                  mentionOutputPublished = false;
                  publishResolution = "turn-limit-fallback-failed";
                }
              }
            } catch (postErr) {
              logger.warn(
                { err: postErr, surface: mention.surface, issueNumber: mention.issueNumber },
                "Failed to post turn-limit notice (non-blocking)",
              );
            }
          } else {
            const detailLines = explicitReviewRequest
              ? [
                  "I couldn't publish a trustworthy review result for this request.",
                  "",
                  "No code findings were published.",
                  "",
                  "The run was recorded with failure diagnostics for operators.",
                  "Try a narrower request such as `@kodiai review path/to/file.cpp` if it repeats.",
                ]
              : [
                  "I couldn't publish a response for this request.",
                  "",
                  "The run was recorded with failure diagnostics for operators.",
                  "Try a more targeted question with the main file/path I should inspect first.",
                ];
            const failureBody = wrapInDetails(detailLines.join("\n"), "kodiai response");
            try {
              if (
                !explicitReviewRequest
                || canPublishExplicitReviewOutput("explicit mention review failure fallback", reviewOutputKey)
              ) {
                const fallbackResult = await postMentionError(failureBody);
                publishFallbackDelivery = fallbackResult.delivery;
                if (fallbackResult.posted) {
                  mentionOutputPublished = true;
                  publishResolution = "failure-fallback";
                } else {
                  mentionOutputPublished = false;
                  publishResolution = "failure-fallback-failed";
                }
              }
            } catch (postErr) {
              logger.warn(
                { err: postErr, surface: mention.surface, issueNumber: mention.issueNumber, stopReason: result.stopReason },
                "Failed to post failure fallback notice (non-blocking)",
              );
            }
          }
        }

        if (shouldDeferMentionCompletionLog) {
          logMentionExecutionCompleted();
        }

        if (isCombinedFormatterSuggestionRequest) {
          const formatterResult = await runFormatterSuggestionForMention("review-and-format");
          const { visibleReplyPosted, visibleReplyFailed } = await postFormatterVisibleDiagnostic(
            formatterResult,
            "review-and-format",
          );
          const expectedTurnLimitOutcome = isExpectedTurnLimitMentionOutcome({
            conclusion: result.conclusion,
            stopReason: result.stopReason,
            failureSubtype: result.failureSubtype,
          });
          const reviewPartialFailure =
            result.conclusion !== "success"
            || publishResolution === "publish-failure-fallback"
            || publishResolution === "publish-failure-comment-failed"
            || publishFailureCategory !== null;
          const formatterPartialFailure =
            formatterResult.partialFailure === true
            || formatterResult.status === "failed"
            || formatterResult.status === "blocked"
            || formatterResult.status === "pr-diff-unavailable"
            || formatterResult.status === "setup-needed";
          const expectedBoundedCleanFormatter =
            expectedTurnLimitOutcome && !formatterPartialFailure && !visibleReplyFailed;

          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              deliveryId: event.id,
              reviewOutputKey: formatterResult.reviewOutputKey,
              reviewOutputAction: FORMATTER_REVIEW_OUTPUT_ACTION,
              formatterSuggestionRequest: true,
              formatterMode: "review-and-format",
              reviewConclusion: expectedTurnLimitOutcome ? "expected_bounded" : result.conclusion,
              ...(expectedTurnLimitOutcome ? { boundedOutcomeReason: "max_turns" } : {}),
              publishResolution: expectedTurnLimitOutcome
                ? cleanTurnLimitMentionPublishResolution(publishResolution)
                : publishResolution,
              ...(expectedBoundedCleanFormatter ? {} : { publishFailureCategory }),
              publishFallbackDelivery: expectedTurnLimitOutcome
                ? mapTurnLimitFallbackDelivery(publishFallbackDelivery)
                : publishFallbackDelivery,
              formatterStatus: formatterResult.status,
              commandStatus: formatterResult.commandStatus,
              publisherStatus: formatterResult.publisherStatus,
              suggestions: formatterResult.suggestions,
              skipped: formatterResult.skipped,
              capped: formatterResult.capped,
              posted: formatterResult.posted,
              publisherSkipped: formatterResult.publisherSkipped,
              ...(expectedBoundedCleanFormatter ? {} : { publisherFailed: formatterResult.publisherFailed }),
              ...(expectedBoundedCleanFormatter ? {} : { formatterPartialFailure }),
              formatterVisibleReplyPosted: visibleReplyPosted,
              ...(expectedBoundedCleanFormatter ? {} : { formatterVisibleReplyFailed: visibleReplyFailed }),
              ...(expectedBoundedCleanFormatter
                ? { combinedOutcome: "expected_bounded" }
                : { combinedPartialFailure: reviewPartialFailure || formatterPartialFailure || visibleReplyFailed }),
            },
            "Combined review-and-format mention request completed",
          );
        }
      } catch (err) {
        logger.error(
          { err, surface: mention.surface, issueNumber: mention.issueNumber },
          "Mention handler failed",
        );

        // Post or update error comment with classified message
        const category = classifyError(err, false);
        const detail = err instanceof Error ? err.message : "An unexpected error occurred";
        const errorBody = wrapInDetails(formatErrorComment(category, detail), "Kodiai encountered an error");
        const sanitizedErrorBody = sanitizeOutgoingMentions(errorBody, possibleHandles);
        try {
          if (
            !explicitReviewRequest
            || canPublishExplicitReviewOutput("explicit mention review handler failure error comment", reviewOutputKey)
          ) {
            // Prefer in-thread reply for inline review comments.
            if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
              const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
              await errOctokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: sanitizedErrorBody,
              });
            } else {
              const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
              await postOrUpdateErrorComment(
                errOctokit,
                {
                  owner: mention.owner,
                  repo: mention.repo,
                  issueNumber: mention.issueNumber,
                },
                sanitizedErrorBody,
                logger,
              );
            }
          }
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment");
        }
      } finally {
        if (acquiredWriteKey) {
          inFlightWriteKeys.delete(acquiredWriteKey);
        }
        if (workspace) {
          await workspace.cleanup();
        }
      }
      }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      lane: isExplicitReviewRequest ? "interactive-review" : "sync",
      key: mentionQueueKey,
      jobType: "mention",
      prNumber: mention.prNumber,
    });
    } finally {
      finalizeQueuedReviewWorkAttempt();
    }
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
