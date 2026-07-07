import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
  PullRequestSynchronizeEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type {
  ExecutorPhaseTiming,
  ReviewPhaseName,
  ReviewPhaseTiming,
} from "../execution/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import type {
  KnowledgeStore,
  ContinuationFamilyProjectionStatus,
} from "../knowledge/types.ts";
import type { LearningMemoryStore, EmbeddingProvider } from "../knowledge/types.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import { classifyFindingDeltas, type DeltaClassification } from "../lib/delta-classifier.ts";
import { type FindingClaimClassification } from "../lib/claim-classifier.ts";
import { createGuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { analyzeDiff, classifyFileLanguageWithContext } from "../execution/diff-analysis.ts";
import { buildPrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import { createStructuralImpactCache } from "../structural-impact/cache.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";
import { buildPromptSectionRecord, type PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import { evaluateFeedbackSuppressions } from "../feedback/index.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import { formatErrorComment } from "../lib/errors.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { estimateTimeoutRisk } from "../lib/timeout-estimator.ts";
import { formatPartialReviewComment } from "../lib/partial-review-formatter.ts";
import {
  normalizeReviewFirstPass,
  type ReviewFirstPassPayload,
} from "../lib/review-first-pass.ts";
import {
  planReviewContinuation,
  settleReviewContinuation,
} from "../lib/review-continuation-lifecycle.ts";
import { computeRetryScope } from "../lib/retry-scope-reducer.ts";
import { type createRetriever } from "../knowledge/retrieval.ts";
import {
  buildReviewOutputKey,
} from "../review-orchestration/review-idempotency.ts";
import {
  writeReviewLearningMemoryBatch,
} from "./review-learning-memory.ts";
import {
  classifyRetryFailure,
  type TimeoutReviewDetailsProgress,
  type TimeoutBudgetDetails,
} from "../lib/review-details-formatting.ts";
import {
  type ReviewArea,
  type FindingSeverity,
  type FindingCategory,
  fingerprintFindingTitle,
} from "../lib/review-finding-metadata.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import { fetchAndCheckoutPullRequestHeadRef, fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import {
  createDegradedReviewReducerResult,
  reduceReviewFindings,
  type ProcessedReviewFinding,
  type ReviewReducerInput,
  type ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import {
  buildReviewPlan,
  type ReviewPlanBuilder,
} from "../review-orchestration/review-plan.ts";
import {
  type ReviewCandidateApprovalResult,
} from "../review-orchestration/review-candidate-approval.ts";
import {
  type ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import { createReviewContinuationFamilyStateManager } from "../review-orchestration/review-continuation-family-state.ts";
import { classifyReviewTimeoutOutcome } from "../review-orchestration/review-timeout-classification.ts";
import { logReviewTimeoutClassification } from "../review-orchestration/review-timeout-classification-log.ts";
import {
  buildExecutorUnavailablePhases,
  buildQueueWaitPhase,
  buildReviewDetailsPhaseTimingSummary,
  createReviewPhaseTiming,
  formatTimeoutErrorDetail,
  isValidQueueWaitMetadata,
} from "../review-orchestration/review-phase-timing.ts";
export { formatTimeoutErrorDetail } from "../review-orchestration/review-phase-timing.ts";
import {
  buildPromptReviewCacheEvent,
  type ReviewPromptCacheState,
} from "../review-orchestration/review-prompt-cache-events.ts";
import {
  buildPromptBudgetOutcomes,
} from "../review-orchestration/review-visible-budget-evidence.ts";
import {
  type CanonicalReviewSurface,
  type CanonicalSurfaceKind,
  upsertCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import {
  type ExtractedFinding,
  extractFindingsFromReviewComments,
  removeFilteredInlineComments,
} from "../review-orchestration/review-comment-finding-extraction.ts";
import {
  detectCommentSlopInDiff,
  toCommentSlopReducerFindings,
} from "../review-orchestration/comment-slop-detector.ts";
export { resolveAuthorTierFromSources } from "../review-orchestration/review-author-tier.ts";
import {
  buildShadowSpecialistCorrelationKey,
} from "../review-orchestration/review-specialist-publication-log.ts";
import {
  buildReviewPromptFingerprint,
  type ReviewPromptBuildContext,
} from "../review-orchestration/review-prompt-fingerprint.ts";
export { buildReviewPromptFingerprint, type ReviewPromptBuildContext, type ReviewPromptFingerprintResult } from "../review-orchestration/review-prompt-fingerprint.ts";
import {
  collectDiffContext,
  REVIEW_WORKSPACE_FETCH_DEPTH,
} from "../review-orchestration/review-diff-collection.ts";
export { collectDiffContext, REVIEW_WORKSPACE_FETCH_DEPTH } from "../review-orchestration/review-diff-collection.ts";
import {
  buildRepoDoctrineLogFields,
  serializeReviewPlanBuilderError,
  toReviewPlanConfigSnapshot,
} from "../review-orchestration/review-plan-doctrine-log.ts";
import {
  isTrustedReviewReducerResult,
  logReviewReducerResult,
} from "../review-orchestration/review-reducer-log.ts";
import {
  toReviewCandidateReducerDrafts,
} from "../review-orchestration/review-candidate-finding-handler.ts";
import {
  toProductionLogBudgetReasoning,
} from "../review-audit/production-log-projection.ts";
import { type DepBumpContext } from "../lib/dep-bump-detector.ts";
import { analyzePackageUsage } from "../lib/usage-analyzer.ts";
import { detectScopeCoordination } from "../lib/scope-coordinator.ts";
import {
  createSearchCache,
  type SearchCache,
  type SearchCacheOptions,
} from "../lib/search-cache.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import {
  runShadowSpecialistSubflow,
  type ShadowSpecialistSubflowInput,
  type ShadowSpecialistSubflowResult,
} from "../specialists/shadow-specialist-subflow.ts";
import {
  type ShadowSpecialistReviewDetailsProjection,
} from "../specialists/shadow-specialist-review-details.ts";
import {
  discardCheckpointsFailOpen,
  recordReviewCacheEventFailOpen,
} from "./review-handler-utils.ts";
import {
  createReviewExecutionCompletedLogger,
} from "./review-publication-state.ts";
import {
  type ReviewDetailsBodyBaseParams,
} from "./review-details-body.ts";
import {
  createReviewDetailsPublicationRuntime,
} from "./review-details-publication-runtime.ts";
import { buildReviewPromptResultWithCache } from "./review-prompt-cache-runtime.ts";
import { publishReviewFailureFallback } from "./review-failure-publication.ts";
import {
  publishReviewExecutionErrorFallback,
  publishReviewHandlerFailureError,
} from "./review-error-publication.ts";
import { createReviewWorkRuntime } from "./review-work-runtime.ts";
import { postNoReviewSkipAcknowledgment } from "./review-no-review-skip.ts";
import { maybePostReviewCostWarning } from "./review-cost-warning.ts";
import { publishBoundedFirstPassReview } from "./review-partial-publication.ts";
import { buildReviewRetryCustomInstructions } from "./review-retry-instructions.ts";
import { publishCleanReviewApproval } from "./review-clean-approval-publication.ts";
import { evaluateReviewOutputIdempotencyGate } from "./review-idempotency-gate.ts";
import { buildReviewRetrievalContext } from "./review-retrieval-context.ts";
import { buildReviewDepBumpContext } from "./review-dep-bump-context.ts";
import { buildReviewRuntimePlan } from "./review-runtime-plan.ts";
import { buildReviewPromptEnrichment } from "./review-prompt-enrichment.ts";
import { persistReviewKnowledge } from "./review-knowledge-persistence.ts";
import {
  completeReviewRunFailOpen,
  scheduleContributorExpertiseUpdate,
  scheduleReviewHunkEmbedding,
} from "./review-post-execution-side-effects.ts";
import { recordReviewResilienceEventFailOpen } from "./review-resilience-telemetry.ts";
import { recordReviewExecutionTelemetry } from "./review-telemetry.ts";
import { postReviewRequestedEyesReaction } from "./review-reactions.ts";
import { resolveReviewPrIntent } from "./review-pr-intent.ts";
import { resolveReviewAuthorContext } from "./review-author-context.ts";
import { resolveReviewDependsFlow } from "./review-depends-flow.ts";
import { resolveReviewStructuralImpactSelection } from "./review-structural-impact-selection.ts";
import { evaluateReviewRequestedGate } from "./review-requested-gate.ts";
import { resolveReviewClonePlan } from "./review-clone-plan.ts";
import { evaluateReviewTriggerConfigGate } from "./review-trigger-config-gate.ts";
import { evaluateReviewSkipAuthorGate } from "./review-skip-author-gate.ts";
import {
  resolveReviewFilesForIncrementalReview,
  resolveReviewIncrementalDiff,
} from "./review-incremental-diff.ts";
import { evaluateReviewSkipPathsGate } from "./review-skip-paths-gate.ts";
import { resolveReviewShadowSpecialistContext } from "./review-shadow-specialist.ts";
import { resolveReviewPriorFindingContext } from "./review-prior-finding-context.ts";
import { resolveReviewRepoDoctrineContext } from "./review-repo-doctrine-context.ts";
import { resolveReviewPathInstructions } from "./review-path-instructions.ts";
import {
  buildReviewFileRiskScores,
  resolveReviewLargePrTriage,
} from "./review-large-pr-triage.ts";
import { buildReviewPlanPublication } from "./review-plan-publication-context.ts";
import { projectReviewExecutorState } from "./review-executor-state.ts";
import { resolveReviewHandlerCandidatePublicationBridge } from "./review-candidate-publication-bridge.ts";
import { resolveReviewCandidateFindingContext } from "./review-candidate-finding-context.ts";
import { resolveReviewCandidateApprovalContext } from "./review-candidate-approval-context.ts";
import { publishReviewCandidateInlineComments } from "./review-candidate-inline-publication.ts";
import { resolveReviewCandidatePublicationRuntimeContext } from "./review-candidate-publication-runtime-context.ts";
import { resolveReviewFindingPublicationContext } from "./review-finding-publication-context.ts";
import { resolveReviewFindingLifecycleContext } from "./review-finding-lifecycle-context.ts";
import { logReviewCandidatePublicationAdapterContext } from "./review-candidate-publication-adapter-context.ts";
import { resolveReviewDetailsRuntimeContext } from "./review-details-runtime-context.ts";
import { resolveReviewExecutionOutcomeContext } from "./review-execution-outcome.ts";
import { handleReviewHandlerFailureRecovery } from "./review-handler-failure-recovery.ts";
import { finalizeReviewPhaseSummary } from "./review-phase-summary-finalization.ts";
import { resolveReviewRetryExecutionOutcome } from "./review-retry-execution-outcome.ts";
import { resolveReviewContinuationRevisionCounts } from "./review-continuation-revision-counts.ts";
import { resolveReviewContinuationMergeContext } from "./review-continuation-merge-context.ts";
import { publishPublishedReviewDetailsMerge } from "./review-details-published-merge.ts";
import { publishMovedToDetailsReviewDetailsMerge } from "./review-details-moved-to-details-merge.ts";
import { publishStandaloneReviewDetailsFallback } from "./review-details-standalone-fallback.ts";
import { publishDegradedReviewDetailsFallbackFailOpen } from "./review-details-degraded-fallback.ts";


type ProcessedFinding = ExtractedFinding & {
  suppressed: boolean;
  confidence: number;
  suppressionPattern?: string;
  deprioritized?: boolean;
  claimClassification?: FindingClaimClassification;
  preDemotionSeverity?: FindingSeverity;
  severityDemoted?: boolean;
  demotionReason?: string;
  filterAction?: "rewritten" | "suppressed" | "guardrail-suppressed" | "guardrail-rewritten";
  originalTitle?: string;
};








/**
 * Create the review handler and register it with the event router.
 *
 * Handles `pull_request.opened`, `pull_request.ready_for_review`, and
 * `pull_request.review_requested` events.
 *
 * Trigger model: initial review events plus explicit re-request only.
 * Re-requested reviews run only when kodiai itself is the requested reviewer.
 * Team-only review requests are skipped so manual rereview stays anchored on the
 * explicit `@kodiai review` mention path.
 * Clones the repo, builds a review prompt, runs Claude via the executor,
 * and optionally submits a silent approval if no issues were found.
 */
type ReviewReducer = (input: ReviewReducerInput) => Promise<ReviewReducerResult>;



export function createReviewHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  telemetryStore: TelemetryStore;
  knowledgeStore?: KnowledgeStore;
  learningMemoryStore?: LearningMemoryStore;
  embeddingProvider?: EmbeddingProvider;
  retriever?: ReturnType<typeof createRetriever>;
  /** Optional injection for deterministic tests. */
  usageAnalyzer?: { analyzePackageUsage: typeof analyzePackageUsage };
  /** Optional injection for deterministic tests. */
  scopeCoordinator?: { detectScopeCoordination: typeof detectScopeCoordination };
  /** Optional injection for deterministic tests. */
  searchCache?: SearchCache<number>;
  /** Optional injection for deterministic tests. */
  searchCacheFactory?: () => SearchCache<number>;
  /** Optional derived prompt cache store overrides for review prompt reuse tests/fail-open wiring. */
  reviewPromptDerivedCacheOptions?: Pick<
    SearchCacheOptions<PromptBuildResult>,
    "ttlMs" | "maxSize" | "now" | "store" | "inFlightStore"
  >;
  /** Optional prompt builder override for review prompt reuse tests. */
  reviewPromptBuilder?: typeof buildReviewPromptDetails;
  /** Optional code snippet store for hunk embedding. */
  codeSnippetStore?: CodeSnippetStore;
  /** Optional contributor profile store for 4-tier expertise-based reviews. */
  contributorProfileStore?: ContributorProfileStore;
  /** Optional Slack bot token for identity suggestion DMs. */
  slackBotToken?: string;
  /** Optional cluster pattern matcher (Phase 100: CLST-03). */
  clusterMatcher?: (opts: { prEmbedding: Float32Array | null; prFilePaths: string[]; repo: string }) => Promise<ClusterPatternMatch[]>;
  /** Optional issue store for PR-issue linking (Phase 108: PRLINK). */
  issueStore?: IssueStore;
  /** Optional review-graph blast-radius query for graph-aware large-PR selection. */
  reviewGraphQuery?: (input: {
    repo: string;
    workspaceKey: string;
    changedPaths: string[];
    limit?: number;
  }) => Promise<ReviewGraphBlastRadiusResult>;
  /** Optional SQL client for guardrail audit logging (GUARD-06). */
  sql?: import("../db/client.ts").Sql;
  /** Optional in-memory coordinator for same-PR review-family publish rights. */
  reviewWorkCoordinator?: ReviewWorkCoordinator;
  /** Optional cluster model store for thematic finding scoring (M037/S02). */
  clusterModelStore?: SuggestionClusterStore;
  /** Optional base-branch fetch override for deterministic tests. */
  fetchRemoteTrackingBranchFn?: typeof fetchRemoteTrackingBranch;
  /** Optional diff context collector for deterministic tests and bounded fallback behavior. */
  diffContextCollector?: typeof collectDiffContext;
  /** Optional same-job read-only shadow specialist subflow; fail-open and private by contract. */
  shadowSpecialistSubflow?: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
  /** Optional review plan builder override for fail-open contract tests. */
  reviewPlanBuilder?: ReviewPlanBuilder;
  /** Optional review reducer override for fail-open contract tests. */
  reviewReducer?: ReviewReducer;
  logger: Logger;
}): void {
  const {
    eventRouter,
    jobQueue,
    workspaceManager,
    githubApp,
    executor,
    telemetryStore,
    knowledgeStore,
    learningMemoryStore,
    embeddingProvider,
    retriever,
    usageAnalyzer,
    scopeCoordinator,
    searchCache: injectedSearchCache,
    searchCacheFactory,
    reviewPromptDerivedCacheOptions,
    reviewPromptBuilder = buildReviewPromptDetails,
    codeSnippetStore,
    contributorProfileStore,
    slackBotToken,
    clusterMatcher,
    issueStore,
    reviewGraphQuery,
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    clusterModelStore,
    fetchRemoteTrackingBranchFn = fetchRemoteTrackingBranch,
    diffContextCollector = collectDiffContext,
    shadowSpecialistSubflow = runShadowSpecialistSubflow,
    reviewPlanBuilder = buildReviewPlan,
    reviewReducer = reduceReviewFindings,
    logger,
  } = deps;

  const guardrailAuditStore = sql ? createGuardrailAuditStore(sql) : undefined;
  const structuralImpactCache = createStructuralImpactCache();
  const reviewWorkCoordinator = injectedReviewWorkCoordinator ?? createReviewWorkCoordinator();
  if (!injectedReviewWorkCoordinator) {
    logger.warn(
      {
        gate: "review-family-coordinator",
        gateResult: "private-fallback",
        coordinationScope: "handler-local",
        handler: "review",
      },
      "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );
  }

  let reviewPromptDerivedCacheErrorCount = 0;
  const reviewPromptDerivedCache = createSearchCache<PromptBuildResult>({
    ...reviewPromptDerivedCacheOptions,
    onError: (error) => {
      reviewPromptDerivedCacheErrorCount += 1;
      logger.warn(
        {
          err: error,
          gate: "review-derived-prompt-cache",
          gateResult: "degraded",
        },
        "Review derived prompt cache degraded; bypassing cache for this request",
      );
    },
  });

  let authorPrCountSearchCache: SearchCache<number> | undefined;
  if (injectedSearchCache) {
    authorPrCountSearchCache = injectedSearchCache;
  } else {
    try {
      authorPrCountSearchCache = searchCacheFactory
        ? searchCacheFactory()
        : createSearchCache<number>();
    } catch (err) {
      logger.warn(
        { err },
        "Search cache initialization failed (fail-open, continuing without search cache)",
      );
      authorPrCountSearchCache = undefined;
    }
  }

  async function handleReview(event: WebhookEvent): Promise<void> {
    const payload = event.payload as unknown as
      | PullRequestOpenedEvent
      | PullRequestReadyForReviewEvent
      | PullRequestReviewRequestedEvent
      | PullRequestSynchronizeEvent;

    const pr = payload.pull_request;
    const action = payload.action;
    const baseLog = {
      deliveryId: event.id,
      installationId: event.installationId,
      action,
      prNumber: pr.number,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
    };
    const reviewOutputKey = buildReviewOutputKey({
      installationId: event.installationId,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: pr.number,
      action,
      deliveryId: event.id,
      headSha: pr.head.sha ?? "unknown-head-sha",
    });

    // Draft PR handling: review with softer tone instead of skipping.
    // When action is "ready_for_review", the PR is no longer a draft — use normal tone
    // regardless of pr.draft (which may still be truthy in the payload).
    const isDraft = action === "ready_for_review" ? false : Boolean(pr.draft);
    if (isDraft) {
      logger.info({ ...baseLog, isDraft: true }, "Reviewing draft PR with draft tone");
    }

    if (/\[no-review\]/i.test(pr.title)) {
      logger.info(
        { ...baseLog, gate: "keyword-skip", gateResult: "skipped" },
        "Review skipped via [no-review] keyword in PR title",
      );
      try {
        const skipOctokit = await githubApp.getInstallationOctokit(event.installationId);
        await postNoReviewSkipAcknowledgment({
          octokit: skipOctokit,
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          prNumber: pr.number,
          botHandles: [githubApp.getAppSlug(), "claude"],
        });
      } catch (commentErr) {
        logger.warn(
          { ...baseLog, err: commentErr },
          "Failed to publish no-review skip acknowledgment (non-fatal)",
        );
      }
      return;
    }

    if (action === "review_requested") {
      const reviewRequestedGate = evaluateReviewRequestedGate({
        payload: payload as unknown as Record<string, unknown>,
        appSlug: githubApp.getAppSlug(),
        baseLog,
        logger,
      });
      if (reviewRequestedGate.action === "skip") return;
    }

    // API target is always the base (upstream) repo
    const apiOwner = payload.repository.owner.login;
    const apiRepo = payload.repository.name;

    const reviewClonePlan = resolveReviewClonePlan({
      apiOwner,
      apiRepo,
      repositoryFullName: payload.repository.full_name,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      headRepo: pr.head.repo,
    });
    const {
      cloneOwner,
      cloneRepo,
      cloneRef,
      isFork,
      isDeletedFork,
      usesPrRef,
      workspaceStrategy,
    } = reviewClonePlan;

    logger.info(
      {
        prNumber: pr.number,
        apiOwner,
        apiRepo,
        cloneOwner,
        cloneRepo,
        cloneRef,
        isFork,
        isDeletedFork,
        usesPrRef,
        workspaceStrategy,
        action,
        deliveryId: event.id,
        installationId: event.installationId,
      },
      "Processing PR review",
    );

    logger.info(
      { ...baseLog, gate: "enqueue", gateResult: "started" },
      "Review enqueue started",
    );

    const reviewFamilyKey = buildReviewFamilyKey(apiOwner, apiRepo, pr.number);
    const reviewWorkAttempt = reviewWorkCoordinator.claim({
      familyKey: reviewFamilyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: event.id,
      phase: "claimed",
    });
    const reviewWorkRuntime = createReviewWorkRuntime({
      attempt: reviewWorkAttempt,
      coordinator: reviewWorkCoordinator,
    });
    const {
      setPhase: setReviewWorkPhase,
      setPhaseForAttempt: setReviewWorkPhaseForAttempt,
    } = reviewWorkRuntime;

    try {
      await jobQueue.enqueue(event.installationId, async (queueMetadata) => {
      const reviewPhaseTimings = new Map<ReviewPhaseName, ReviewPhaseTiming>();
      reviewPhaseTimings.set("queue wait", buildQueueWaitPhase(queueMetadata));
      const reviewStartedAt = Date.now();
      const totalPhaseStartAt = isValidQueueWaitMetadata(queueMetadata)
        ? queueMetadata.queuedAtMs
        : reviewStartedAt;
      let workspacePhaseStartedAt: number | undefined;
      let retrievalPhaseStartedAt: number | undefined;
      let publicationPhaseStartedAt: number | undefined;
      let executorPhaseTimings: ExecutorPhaseTiming[] = buildExecutorUnavailablePhases(
        "executor phase timings unavailable",
      );
      let executorResult: Awaited<ReturnType<typeof executor.execute>> | undefined;
      let reviewOutputPublished = false;
      let reviewExecutorPublished = false;
      let reviewPublishResolution = "none";
      let reviewPublishFallbackDelivery: string | undefined;

      const logReviewExecutionCompleted = createReviewExecutionCompletedLogger({
        logger,
        getState: () => ({
          prNumber: pr.number,
          executorResult,
          reviewOutputPublished,
          reviewExecutorPublished,
          reviewPublishResolution,
          reviewPublishFallbackDelivery,
        }),
      });

      const continuationFamilyState = createReviewContinuationFamilyStateManager({
        logger,
        baseLog,
        reviewFamilyKey,
        reviewOutputKey,
        knowledgeStore,
        reviewWorkCoordinator,
      });
      const {
        persistContinuationFamilyState,
        settleRetryWithoutCanonicalUpdate,
        finalizeContinuationAttempt,
        canPublishReviewWorkOutput,
      } = continuationFamilyState;

      const canPublishVisibleOutput = reviewWorkRuntime.createVisibleOutputGate({
        deliveryId: event.id,
        canPublishReviewWorkOutput,
      });

      // Durable run state idempotency check (REL-01)
      // Check before expensive workspace creation. Uses SHA pair as identity key.
      // Fail-open: if knowledgeStore is undefined or query throws, proceed with review.
      if (knowledgeStore) {
        try {
          const runCheck = await knowledgeStore.checkAndClaimRun({
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
            baseSha: pr.base.sha,
            headSha: pr.head.sha,
            deliveryId: event.id,
            action,
          });

          if (!runCheck.shouldProcess) {
            logger.info(
              {
                ...baseLog,
                gate: 'run-state-idempotency',
                gateResult: 'skipped',
                skipReason: runCheck.reason,
                runKey: runCheck.runKey,
              },
              'Skipping review: run state indicates duplicate or already processed',
            );
            return;
          }

          if (runCheck.supersededRunKeys.length > 0) {
            logger.info(
              {
                ...baseLog,
                gate: 'run-state-idempotency',
                gateResult: 'accepted',
                runKey: runCheck.runKey,
                supersededRunKeys: runCheck.supersededRunKeys,
              },
              'New run superseded prior runs (force-push detected)',
            );
          }
        } catch (err) {
          logger.warn(
            { ...baseLog, err },
            'Run state idempotency check failed (fail-open, proceeding with review)',
          );
        }
      }

      let workspace: Workspace | undefined;
      try {
        setReviewWorkPhase("workspace-create");
        workspacePhaseStartedAt = Date.now();
        // Create workspace with enough shallow history to usually include the base merge point.
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef,
          depth: REVIEW_WORKSPACE_FETCH_DEPTH,
        });

        const trustedBaseRepoConfig = usesPrRef
          ? await loadRepoConfig(workspace.dir)
          : null;

        // Fork PR / deleted fork: fetch PR head ref from base repo
        if (usesPrRef) {
          await fetchAndCheckoutPullRequestHeadRef({
            dir: workspace.dir,
            prNumber: pr.number,
            localBranch: "pr-review",
            token: workspace.token,
            fallbackRemoteUrl: pr.head.repo ? `https://github.com/${pr.head.repo.full_name}.git` : undefined,
            fallbackRef: pr.head.ref,
            depth: REVIEW_WORKSPACE_FETCH_DEPTH,
          });
        }

        // Fetch base branch so git diff origin/BASE...HEAD works.
        // Explicit refspec needed because --single-branch clones don't track other branches.
        await fetchRemoteTrackingBranchFn({
          dir: workspace.dir,
          branch: pr.base.ref,
          token: workspace.token,
          depth: REVIEW_WORKSPACE_FETCH_DEPTH,
        });

        setReviewWorkPhase("load-config");
        // Load repo config (.kodiai.yml) with defaults. For fork PRs, the active
        // policy comes from the trusted base checkout, not the untrusted PR head.
        const { config, warnings } = trustedBaseRepoConfig ?? (await loadRepoConfig(workspace.dir));
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config warning detected",
          );
        }
        reviewPhaseTimings.set(
          "workspace preparation",
          createReviewPhaseTiming({
            name: "workspace preparation",
            status: "completed",
            durationMs: Math.max(0, Date.now() - (workspacePhaseStartedAt ?? Date.now())),
          }),
        );

        const triggerConfigGate = evaluateReviewTriggerConfigGate({
          action,
          reviewConfig: config.review,
          apiOwner,
          apiRepo,
          baseLog,
          logger,
        });
        if (triggerConfigGate.action === "skip") return;

        const idempotencyOctokit = await githubApp.getInstallationOctokit(event.installationId);
        const idempotencyGate = await evaluateReviewOutputIdempotencyGate({
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
          baseLog,
          logger,
        });
        if (idempotencyGate.action === "skip") return;
        const acceptedCanonicalSurface: CanonicalReviewSurface | null =
          idempotencyGate.acceptedCanonicalSurface;

        const prIntent = await resolveReviewPrIntent({
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          commitCount: pr.commits,
          prTitle: pr.title,
          prBody: pr.body ?? null,
          baseLog,
          logger,
        });
        const parsedIntent = prIntent.parsedIntent;
        const commitMessagesForLinking = prIntent.commitMessagesForLinking;

        // Add eyes reaction only for explicit re-review requests.
        // Do not react on opened/ready_for_review to avoid noise on the PR description.
        if (action === "review_requested") {
          await postReviewRequestedEyesReaction({
            octokit: await githubApp.getInstallationOctokit(event.installationId),
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            logger,
          });
        }

        const skipAuthorGate = evaluateReviewSkipAuthorGate({
          prNumber: pr.number,
          authorLogin: pr.user.login,
          skipAuthors: config.review.skipAuthors,
          logger,
        });
        if (skipAuthorGate.action === "skip") return;

        const authorClassification = await resolveReviewAuthorContext({
          authorLogin: pr.user.login,
          authorDisplayName: pr.user.name ?? null,
          authorAssociation: (pr as { author_association?: string }).author_association ?? "NONE",
          owner: apiOwner,
          repo: apiRepo,
          repoSlug: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          deliveryId: event.id,
          eventType: `pull_request.${payload.action}`,
          octokit: idempotencyOctokit,
          knowledgeStore,
          searchCache: authorPrCountSearchCache,
          contributorProfileStore,
          slackBotToken,
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          baseLog,
          logger,
        });

        setReviewWorkPhase("incremental-diff");
        const incrementalResult: IncrementalDiffResult | null = await resolveReviewIncrementalDiff({
          knowledgeStore,
          workspaceDir: workspace.dir,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          baseLog,
          logger,
        });

        // Build changed files and diff context, handling shallow-history merge-base gaps.
        retrievalPhaseStartedAt = Date.now();
        const diffContext = await diffContextCollector({
          workspaceDir: workspace.dir,
          baseRef: pr.base.ref,
          maxFilesForFullDiff: 200,
          logger,
          baseLog,
          token: workspace.token,
          fallbackDiffProvider: async () => await fetchAllPullRequestFiles({
            octokit: idempotencyOctokit,
            owner: apiOwner,
            repo: apiRepo,
            pullNumber: pr.number,
          }),
        });
        const diffContentForValidation = diffContext.diffContent ?? "";
        const prDiffCommentabilityIndex = diffContentForValidation
          ? buildPrDiffCommentabilityIndex(diffContentForValidation)
          : undefined;
        const allChangedFiles = diffContext.changedFiles;

        const dependsFlow = await resolveReviewDependsFlow({
          prTitle: pr.title,
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          workspaceDir: workspace?.dir ?? null,
          logger,
          baseLog,
          botHandles: [githubApp.getAppSlug(), "claude"],
          canPublishVisibleOutput,
          setReviewWorkPhase,
          retriever,
        });
        if (dependsFlow.action === "skip-standard-review") return;
        const dependsBumpInfo = dependsFlow.dependsBumpInfo;

        // ── Dependency bump detection (DEP-01/02/03) ──
        // Skipped when [depends] detection matched (mutual exclusivity)
        const depBumpContext: DepBumpContext | null = await buildReviewDepBumpContext({
          dependsBumpInfo,
          prTitle: pr.title,
          prBody: pr.body ?? null,
          prLabels: (pr.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [],
          headBranch: pr.head.ref,
          senderLogin: pr.user.login,
          changedFiles: allChangedFiles,
          workspaceDir: workspace.dir,
          octokit: idempotencyOctokit,
          logger,
          baseLog,
          usageAnalyzer: usageAnalyzer?.analyzePackageUsage,
          detectScopeCoordination: scopeCoordinator?.detectScopeCoordination,
        });

        const skipPathsGate = evaluateReviewSkipPathsGate({
          prNumber: pr.number,
          allChangedFiles,
          skipPaths: config.review.skipPaths,
          logger,
        });
        if (skipPathsGate.action === "skip") return;
        const changedFiles = skipPathsGate.changedFiles;

        const {
          shadowSpecialistResult,
          shadowSpecialistReviewDetailsProjection,
          candidateVerificationContext,
        } = await resolveReviewShadowSpecialistContext({
          changedFiles,
          diffContentForValidation,
          workspaceDir: workspace.dir,
          deliveryId: event.id,
          reviewOutputKey,
          prNumber: pr.number,
          baseLog,
          logger,
          shadowSpecialistSubflow,
        });

        const reviewFiles = resolveReviewFilesForIncrementalReview({
          changedFiles,
          incrementalResult,
          baseLog,
          logger,
        });

        const numstatLines = diffContext.numstatLines;
        const diffContent = changedFiles.length <= 200 ? diffContext.diffContent : undefined;

        const diffAnalysis = analyzeDiff({
          changedFiles,
          numstatLines,
          diffContent,
          fileCategories: config.review.fileCategories as Record<string, string[]> | undefined,
        });

        const { riskScores, perFileStats } = buildReviewFileRiskScores({
          reviewFiles,
          numstatLines,
          filesByCategory: diffAnalysis.filesByCategory,
          riskWeights: config.largePR.riskWeights,
        });

        const structuralImpactSelection = await resolveReviewStructuralImpactSelection({
          reviewGraphQuery,
          structuralImpactCache,
          logger,
          baseLog,
          owner: apiOwner,
          repo: apiRepo,
          workspaceKey: pr.head.sha,
          baseSha: pr.base.sha,
          headSha: pr.head.sha,
          changedPaths: reviewFiles,
          canonicalRef: pr.base.ref,
          fullReviewCount: config.largePR.fullReviewCount,
          abbreviatedCount: config.largePR.abbreviatedCount,
          totalLinesChanged:
            (diffAnalysis?.metrics.totalLinesAdded ?? 0)
            + (diffAnalysis?.metrics.totalLinesRemoved ?? 0),
          riskScores,
        });
        const graphSelection = structuralImpactSelection.graphSelection;
        const graphBlastRadius: ReviewGraphBlastRadiusResult | null =
          structuralImpactSelection.graphBlastRadius;
        const graphQueryBypassedForTrivialChange =
          structuralImpactSelection.graphQueryBypassedForTrivialChange;
        const structuralImpactForReview: StructuralImpactPayload | null =
          structuralImpactSelection.structuralImpactForReview;

        const largePrTriage = resolveReviewLargePrTriage({
          graphSelection,
          reviewFiles,
          changedFiles,
          largePrConfig: config.largePR,
          baseLog,
          logger,
        });
        let { tieredFiles, promptFiles } = largePrTriage;

        const matchedPathInstructions = resolveReviewPathInstructions({
          pathInstructions: config.review.pathInstructions,
          changedFiles,
        });

        const {
          repoDoctrineProjection,
          repoDoctrineReviewSurface,
        } = resolveReviewRepoDoctrineContext({
          doctrine: config.review.doctrine,
          changedFiles,
          baseLog,
          logger,
        });

        const { priorFindings, priorFindingCtx } = await resolveReviewPriorFindingContext({
          knowledgeStore,
          incrementalResult,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          baseLog,
          logger,
        });

        // Retrieval context (LEARN-07) -- unified retrieval via knowledge/retrieval.ts
        const reviewRetrievalContext = await buildReviewRetrievalContext({
          retriever,
          repo: `${apiOwner}/${apiRepo}`,
          owner: apiOwner,
          prNumber: pr.number,
          deliveryId: event.id,
          eventName: event.name,
          workspaceDir: workspace.dir,
          prTitle: pr.title,
          prBody: pr.body ?? undefined,
          conventionalType: parsedIntent.conventionalType?.type ?? null,
          prLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}),
          riskSignals: diffAnalysis.riskSignals ?? [],
          filePaths: reviewFiles,
          authorContract: authorClassification.contract,
          retrievalConfig: {
            topK: config.knowledge.retrieval.topK,
            maxContextChars: config.knowledge.retrieval.maxContextChars,
          },
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          logger,
          baseLog,
        });
        const retrievalCtx = reviewRetrievalContext.retrievalContext;
        const visibleBudgetState = reviewRetrievalContext.visibleBudgetState;
        const reviewPrecedentsForPrompt = reviewRetrievalContext.reviewPrecedents;
        const wikiKnowledgeForPrompt = reviewRetrievalContext.wikiKnowledge;
        const unifiedResultsForPrompt = reviewRetrievalContext.unifiedResults;
        const contextWindowForPrompt = reviewRetrievalContext.contextWindow;

        const runtimePlan = buildReviewRuntimePlan({
          parsedIntent: {
            profileOverride: parsedIntent.profileOverride,
          },
          reviewConfig: {
            profile: config.review.profile ?? null,
            severityMinLevel: config.review.severity.minLevel,
            maxComments: config.review.maxComments,
            focusAreas: config.review.focusAreas,
            ignoredAreas: config.review.ignoredAreas,
          },
          timeoutConfig: {
            timeoutSeconds: config.timeoutSeconds,
            dynamicScaling: config.timeout.dynamicScaling !== false,
            autoReduceScope: config.timeout.autoReduceScope !== false,
          },
          baseMaxTurns: config.maxTurns,
          prLinesChanged: (pr.additions ?? 0) + (pr.deletions ?? 0),
          changedFiles,
          diffMetrics: {
            totalLinesAdded: diffAnalysis?.metrics.totalLinesAdded ?? 0,
            totalLinesRemoved: diffAnalysis?.metrics.totalLinesRemoved ?? 0,
            filesByLanguage: diffAnalysis?.filesByLanguage ?? {},
            isLargePR: diffAnalysis?.isLargePR ?? false,
          },
          tieredFiles,
          promptFiles,
          logger,
          baseLog,
        });
        const {
          resolvedSeverityMinLevel,
          resolvedMaxComments,
          resolvedFocusAreas,
          resolvedIgnoredAreas,
          profileSelection,
          requestedProfileSelection,
          languageComplexity,
          timeoutEstimate,
          appliedTimeoutBudget,
          diffAnalysisLinesChanged,
          prApiLinesChanged,
          reviewRoutingLinesChanged,
          reviewRouting,
          reviewMaxTurnsOverride,
          checkpointEnabled,
          reviewBoundedness,
        } = runtimePlan;
        tieredFiles = runtimePlan.tieredFiles;
        promptFiles = runtimePlan.promptFiles;

        const reviewPlanPublication = buildReviewPlanPublication({
          builder: reviewPlanBuilder,
          reviewRouting,
          changedFileCount: changedFiles.length,
          reviewRoutingLinesChanged,
          diffAnalysisLinesChanged,
          prApiLinesChanged,
          timeoutSeconds: config.timeoutSeconds,
          appliedTimeoutSeconds: appliedTimeoutBudget?.totalTimeoutSeconds,
          maxTurns: config.maxTurns,
          reviewMaxTurnsOverride,
          retrievalContextAvailable: Boolean(retrievalCtx),
          matchedPathInstructionCount: matchedPathInstructions.length,
          repoDoctrineEnabled: repoDoctrineProjection.enabled,
          repoDoctrineReviewSurface,
          reviewBoundednessAvailable: Boolean(reviewBoundedness),
          graphValidationConfigEnabled: config.review.graphValidation.enabled,
          graphQueryAvailable: Boolean(reviewGraphQuery),
          graphQueryBypassedForTrivialChange,
          graphBlastRadiusAvailable: Boolean(graphBlastRadius),
        });
        const {
          plan: reviewPlan,
          detailsSummary: reviewPlanDetailsSummary,
        } = reviewPlanPublication;
        if (reviewPlanPublication.status === "ready") {
          logger.info(
            {
              ...baseLog,
              gate: "review-plan",
              gateResult: "ready",
              planHash: reviewPlan.hash,
              taskType: reviewPlan.task.taskType,
              routingReason: reviewPlan.task.routingReason,
              boundedDisclosureRequired: reviewBoundedness?.disclosureRequired ?? false,
              boundedReasonCodes: reviewBoundedness?.reasonCodes ?? [],
              graphValidationStatus: reviewPlan.graphValidation.status,
              candidateFindingMode: reviewPlan.candidateFinding.mode,
              ...buildRepoDoctrineLogFields(repoDoctrineProjection),
            },
            "Review plan ready",
          );
        } else {
          logger.warn(
            {
              ...baseLog,
              gate: "review-plan",
              gateResult: "degraded",
              planHash: reviewPlan.hash,
              taskType: reviewRouting.taskType,
              routingReason: reviewRouting.routingReason,
              boundedDisclosureRequired: reviewBoundedness?.disclosureRequired ?? false,
              boundedReasonCodes: reviewBoundedness?.reasonCodes ?? [],
              graphValidationStatus: reviewPlan.graphValidation.status,
              candidateFindingMode: reviewPlan.candidateFinding.mode,
              ...buildRepoDoctrineLogFields(repoDoctrineProjection),
              error: serializeReviewPlanBuilderError(reviewPlanPublication.error),
            },
            "Review plan builder failed; continuing with degraded plan metadata",
          );
        }
        const reviewPlanConfigSnapshot = toReviewPlanConfigSnapshot(reviewPlan);

        if (parsedIntent.styleOk && !resolvedIgnoredAreas.includes("style")) {
          resolvedIgnoredAreas.push("style");
        }

        if (parsedIntent.focusAreas.length > 0) {
          for (const area of parsedIntent.focusAreas as ReviewArea[]) {
            if (!resolvedFocusAreas.includes(area)) {
              resolvedFocusAreas.push(area);
            }
          }
        }

        logger.info(
          {
            ...baseLog,
            gate: "diff-analysis",
            totalFiles: diffAnalysis.metrics.totalFiles,
            isLargePR: diffAnalysis.isLargePR,
              riskSignals: diffAnalysis.riskSignals.length,
              matchedInstructions: matchedPathInstructions.length,
              detectedLanguages: Object.keys(diffAnalysis.filesByLanguage ?? {}).length,
              profile: config.review.profile ?? null,
              diffCollectionStrategy: diffContext.strategy,
              mergeBaseRecovered: diffContext.mergeBaseRecovered,
              diffCollectionAttempts: diffContext.deepenAttempts,
            },
            "Diff analysis and context enrichment complete",
          );

        // Extract PR labels for intent scoping (FORMAT-07)
        const prLabels = (pr.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [];

        const promptEnrichment = await buildReviewPromptEnrichment({
          repo: `${apiOwner}/${apiRepo}`,
          prTitle: pr.title,
          prBody: pr.body ?? null,
          commitMessages: commitMessagesForLinking,
          promptFiles,
          filesByCategory: diffAnalysis?.filesByCategory,
          clusterMatcher,
          issueStore,
          embeddingProvider,
          logger,
          baseLog,
        });
        const clusterPatternsForPrompt = promptEnrichment.clusterPatterns;
        const linkedIssueResult = promptEnrichment.linkedIssues;

        setReviewWorkPhase("prompt-build");
        // Build review prompt
        let reviewPromptDerivedCacheStatus: "hit" | "miss" | "degraded" | "bypass" = "bypass";
        let reviewPromptDerivedCacheReason: string | null = null;
        const reviewPromptBuildContext = {
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          prTitle: pr.title,
          prBody: pr.body ?? "",
          prAuthor: pr.user.login,
          baseBranch: pr.base.ref,
          headBranch: pr.head.ref,
          changedFiles: promptFiles,
          customInstructions: config.review.prompt,
          checkpointEnabled,
          // Review mode & severity control
          mode: config.review.mode,
          severityMinLevel: resolvedSeverityMinLevel,
          focusAreas: resolvedFocusAreas,
          ignoredAreas: resolvedIgnoredAreas,
          maxComments: resolvedMaxComments,
          suppressions: config.review.suppressions,
          minConfidence: config.review.minConfidence,
          diffAnalysis,
          diffContent,
          matchedPathInstructions,
          // Incremental re-review context (REV-01)
          incrementalContext: incrementalResult?.mode === "incremental" ? {
            lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
            changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
            unresolvedPriorFindings: priorFindingCtx?.unresolvedOnUnchangedCode ?? [],
          } : null,
          // Learning memory retrieval context (LEARN-07)
          retrievalContext: retrievalCtx,
          // Review comment precedents (KI-05/KI-06)
          reviewPrecedents: reviewPrecedentsForPrompt.length > 0 ? reviewPrecedentsForPrompt : undefined,
          wikiKnowledge: wikiKnowledgeForPrompt.length > 0 ? wikiKnowledgeForPrompt : undefined,
          // Unified cross-corpus retrieval (KI-13/KI-17)
          unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
          contextWindow: contextWindowForPrompt,
          // Multi-language context and localized output (LANG-01)
          filesByLanguage: diffAnalysis?.filesByLanguage,
          outputLanguage: config.review.outputLanguage,
           // PR labels for intent scoping (FORMAT-07)
           prLabels,
           // INTENT-01: Treat unrecognized bracket tags as focus hints
           focusHints: parsedIntent.unrecognized,
           conventionalType: parsedIntent.conventionalType,
           // Delta re-review context (FORMAT-14/15/16)
           deltaContext: incrementalResult?.mode === "incremental" && priorFindings.length > 0
             ? {
                 lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
                 changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
                 priorFindings: priorFindings.map(f => ({
                   filePath: f.filePath,
                   title: f.title,
                   severity: f.severity,
                   category: f.category,
                 })),
               }
             : null,
          // Large PR file triage context (LARGE-01 through LARGE-08)
          largePRContext: tieredFiles.isLargePR ? {
            fullReviewFiles: tieredFiles.full.map(f => f.filePath),
            abbreviatedFiles: tieredFiles.abbreviated.map(f => f.filePath),
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
          contributorExperienceContract: authorClassification.contract,
          authorExpertise: authorClassification.contract.state === "profile-backed"
            ? authorClassification.expertise?.map(e => ({
              dimension: e.dimension,
              topic: e.topic,
              score: e.score,
            }))
            : undefined,
          depBumpContext,
          searchRateLimitDegradation: authorClassification.searchEnrichment,
          isDraft,
          // Review pattern clustering (CLST-03)
          clusterPatterns: clusterPatternsForPrompt.length > 0 ? clusterPatternsForPrompt : undefined,
          // PR-issue linking (PRLINK-03)
          linkedIssues: linkedIssueResult,
          // Graph-derived review context (M040/S03): inject bounded blast-radius section when available
          graphBlastRadius: graphBlastRadius ?? undefined,
          structuralImpact: structuralImpactForReview,
          reviewBoundedness,
          repoDoctrine: repoDoctrineProjection,
          smallDiffReview: reviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
        } satisfies ReviewPromptBuildContext;
        const reviewPromptCacheState: ReviewPromptCacheState = {
          status: reviewPromptDerivedCacheStatus,
          reason: reviewPromptDerivedCacheReason,
        };
        const reviewPromptResult = await buildReviewPromptResultWithCache({
          cacheQuery: `initial:${pr.number}:${pr.head.sha ?? "unknown-head-sha"}`,
          context: reviewPromptBuildContext,
          statusTarget: reviewPromptCacheState,
          promptBuilder: reviewPromptBuilder,
          cache: reviewPromptDerivedCache,
          getCacheErrorCount: () => reviewPromptDerivedCacheErrorCount,
          buildFingerprint: buildReviewPromptFingerprint,
          logger,
        });
        reviewPromptDerivedCacheStatus = reviewPromptCacheState.status;
        reviewPromptDerivedCacheReason = reviewPromptCacheState.reason;
        const reviewPrompt = reviewPromptResult.text;
        const reviewPromptSections = [
          buildPromptSectionRecord({
            deliveryId: event.id,
            repo: `${apiOwner}/${apiRepo}`,
            taskType: reviewRouting.taskType,
            promptKind: "review.user-prompt",
            sections: reviewPromptResult.sections,
          }),
        ];
        visibleBudgetState.promptSectionRecords = reviewPromptSections;
        logger.info(
          {
            ...baseLog,
            gate: "review-derived-prompt-cache",
            gateResult: reviewPromptDerivedCacheStatus,
            ...(reviewPromptDerivedCacheReason ? { reason: reviewPromptDerivedCacheReason } : {}),
          },
          "Resolved review prompt derived-cache state",
        );
        const reviewPromptCacheEvent = buildPromptReviewCacheEvent({
          deliveryId: event.id,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          state: reviewPromptCacheState,
        });
        visibleBudgetState.reviewCacheObservations.push(reviewPromptCacheEvent);
        visibleBudgetState.refresh();
        if (config.telemetry.enabled) {
          await recordReviewCacheEventFailOpen({
            telemetryStore,
            logger,
            entry: reviewPromptCacheEvent,
          });
        }
        reviewPhaseTimings.set(
          "retrieval/context assembly",
          createReviewPhaseTiming({
            name: "retrieval/context assembly",
            status: "completed",
            durationMs: Math.max(0, Date.now() - (retrievalPhaseStartedAt ?? Date.now())),
          }),
        );

        // Execute review via Claude
        setReviewWorkPhase("executor-dispatch");
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          commentId: undefined,
          botHandles: [githubApp.getAppSlug(), "claude"],
          eventType: `pull_request.${payload.action}`,
          taskType: reviewRouting.taskType,
          triggerBody: reviewPrompt,
          prompt: reviewPrompt,
          promptSections: reviewPromptSections,
          reviewOutputKey,
          deliveryId: event.id,
          candidateVerificationContext,
          knowledgeStore,
          totalFiles: changedFiles.length,
          enableCheckpointTool: checkpointEnabled,
          enableCandidateFindingTool: true,
          prDiffCommentabilityIndex,
          // TMO-04: total timeout = infra overhead cushion + complexity-scaled remote runtime budget
          dynamicTimeoutSeconds: appliedTimeoutBudget
            ? appliedTimeoutBudget.totalTimeoutSeconds
            : undefined,
          maxTurnsOverride: reviewMaxTurnsOverride,
        });
        const executorState = projectReviewExecutorState({
          result,
          currentPromptSectionRecords: visibleBudgetState.promptSectionRecords,
        });
        executorResult = executorState.executorResult;
        reviewExecutorPublished = executorState.reviewExecutorPublished;
        reviewOutputPublished = executorState.reviewOutputPublished;
        reviewPublishResolution = executorState.reviewPublishResolution;
        visibleBudgetState.promptSectionRecords = executorState.promptSectionRecords;
        visibleBudgetState.refresh();
        executorPhaseTimings = executorState.executorPhaseTimings;
        for (const phase of executorPhaseTimings) {
          reviewPhaseTimings.set(phase.name, phase);
        }
        publicationPhaseStartedAt = Date.now();

        let reviewCandidateVerificationPublicationEvidence = result.candidateVerificationPublicationEvidence;

        const handlerCandidatePublicationBridge = resolveReviewHandlerCandidatePublicationBridge({
          logger,
          baseLog,
          evidenceSummary: result.candidateVerificationPublicationEvidence,
          deliveryId: String(event.id),
          reviewOutputKey,
          upstreamCorrelationKey: String(candidateVerificationContext.correlationKey),
        });

        const extractionOctokit = await githubApp.getInstallationOctokit(event.installationId);
        const reviewOutputSucceeded = result.conclusion === "success";
        const reviewCandidateFindingContext = await resolveReviewCandidateFindingContext({
          candidateFinding: result.candidateFinding,
          executionSucceeded: reviewOutputSucceeded,
          octokit: extractionOctokit,
          logger,
          baseLog,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          deliveryId: event.id,
          reviewOutputKey,
        });
        const reviewCandidateFindingResult = reviewCandidateFindingContext.result;
        const reviewCandidateFindingDetailsSummary = reviewCandidateFindingContext.detailsSummary;
        const reviewCandidateFindingConfigSnapshot = reviewCandidateFindingContext.configSnapshot;
        const extractedFindings = reviewCandidateFindingContext.extractedFindings;

        // Feedback-driven suppression (FEED-01 through FEED-10)
        // Evaluated once and passed into the reducer so publication/deletion side effects remain outside.
        const feedbackSuppression = knowledgeStore
          ? await evaluateFeedbackSuppressions({
              store: knowledgeStore,
              repo: `${apiOwner}/${apiRepo}`,
              config: config.feedback.autoSuppress,
              logger,
            })
          : { suppressedFingerprints: new Set<string>(), suppressedPatternCount: 0, patterns: [] };

        const graphValidationLLM = graphBlastRadius && config.review.graphValidation.enabled
          ? {
              generate: async (prompt: string, system: string): Promise<string> => {
                const { createTaskRouter } = await import("../llm/task-router.ts");
                const { TASK_TYPES } = await import("../llm/task-types.ts");
                const { generateWithFallback } = await import("../llm/generate.ts");
                const taskRouter = createTaskRouter({ models: {} });
                const resolved = taskRouter.resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
                const genResult = await generateWithFallback({
                  taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
                  resolved,
                  system,
                  prompt,
                  logger,
                  repo: `${apiOwner}/${apiRepo}`,
                  deliveryId: event.id,
                });
                return genResult.text;
              },
            }
          : null;

        const commentSlopFindings = toCommentSlopReducerFindings(
          detectCommentSlopInDiff(diffContext.diffContent ?? ""),
        );
        const candidateReducerFindings = toReviewCandidateReducerDrafts(reviewCandidateFindingResult);
        const reviewReducerInput: ReviewReducerInput = {
          findings: [
            ...(extractedFindings as unknown as ProcessedReviewFinding[]),
            ...commentSlopFindings,
            ...candidateReducerFindings,
          ],
          workspaceDir: workspace.dir,
          filesByCategory: diffAnalysis?.filesByCategory ?? {},
          filesByLanguage: diffAnalysis?.filesByLanguage ?? {},
          languageRules: config.languageRules,
          reviewSuppressions: config.review.suppressions,
          minConfidence: config.review.minConfidence,
          prioritizationWeights: config.review.prioritization,
          feedbackSuppression,
          priorFindingContext: priorFindingCtx,
          diffContent: diffContext.diffContent,
          prBody: pr.body ?? null,
          commitMessages: commitMessagesForLinking,
          tieredFiles,
          graphBlastRadius,
          graphValidationEnabled: config.review.graphValidation.enabled,
          riskScores,
          resolvedMaxComments,
          logger,
          baseLog,
          repo: `${apiOwner}/${apiRepo}`,
          clusterModelStore: clusterModelStore ?? null,
          embeddingProvider: embeddingProvider ?? null,
          guardrailAuditStore,
          guardrailStrictness: config.guardrails?.strictness ?? "standard",
          graphValidationLLM,
          repoDoctrine: repoDoctrineReviewSurface,
        };

        let reducerResult: ReviewReducerResult;
        try {
          const candidateReducerResult = await reviewReducer(reviewReducerInput);
          if (!isTrustedReviewReducerResult(candidateReducerResult)) {
            throw new Error("malformed-review-reducer-result");
          }
          reducerResult = candidateReducerResult;
        } catch (err) {
          logger.warn(
            { ...baseLog, gate: "review-reducer", gateResult: "degraded", reason: "reducer-exception", err },
            "Review reducer failed unexpectedly (fail-open, destructive cleanup disabled)",
          );
          reducerResult = createDegradedReviewReducerResult({
            findings: reviewReducerInput.findings,
            reason: "reducer-exception",
          });
        }
        logReviewReducerResult({
          logger,
          baseLog,
          reducerResult,
          graphValidationEnabled: config.review.graphValidation.enabled,
        });

        const reviewCandidateApprovalContext = resolveReviewCandidateApprovalContext({
          candidates: reviewCandidateFindingResult,
          reducer: reducerResult,
          resultPublished: result.published === true,
          extractedFindingCount: extractedFindings.length,
          minConfidence: config.review.minConfidence,
          prDiffText: diffContext.diffContent,
          maxFixSuggestions: resolvedMaxComments,
          logger,
        });
        const directFallbackAllowed = reviewCandidateApprovalContext.directFallbackAllowed;
        const directPublicationAttempted = reviewCandidateApprovalContext.directPublicationAttempted;
        const reviewCandidateApprovalResult: ReviewCandidateApprovalResult = reviewCandidateApprovalContext.approval;
        const reviewCandidatePublicationAdapter: ReviewCandidatePublicationAdapterResult =
          reviewCandidateApprovalContext.publicationAdapter;

        const candidateInlinePublication = await publishReviewCandidateInlineComments({
          payloads: reviewCandidatePublicationAdapter.payloads,
          canPublishVisibleOutput,
          getOctokit: async () => extractionOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          botHandles: [githubApp.getAppSlug(), "claude"],
          reviewOutputKey,
          deliveryId: event.id,
          logger,
          candidateVerificationContext,
          prDiffCommentabilityIndex,
        });
        const candidatePublisherResults = candidateInlinePublication.results;
        reviewCandidateVerificationPublicationEvidence =
          candidateInlinePublication.candidateVerificationPublicationEvidence
          ?? reviewCandidateVerificationPublicationEvidence;

        const reviewCandidatePublicationContext = resolveReviewCandidatePublicationRuntimeContext({
          approval: reviewCandidateApprovalResult,
          adapter: reviewCandidatePublicationAdapter,
          publisherResults: candidatePublisherResults,
          directPublication: {
            attempted: directPublicationAttempted,
            allowed: directFallbackAllowed,
            publishedFindingCount: extractedFindings.length,
            resultPublished: result.published === true,
          },
          logger,
          baseLog,
        });
        const reviewCandidatePublishedFindings = reviewCandidatePublicationContext.publishedFindings;
        const reviewCandidatePublicationRuntime = reviewCandidatePublicationContext.runtime;
        const reviewCandidatePublicationFlow = reviewCandidatePublicationContext.flow;

        const reviewFindingPublicationContext = resolveReviewFindingPublicationContext({
          reducer: reducerResult,
          candidatePublishedFindings: reviewCandidatePublishedFindings,
        });
        const processedFindings = reviewFindingPublicationContext.processedFindings as ProcessedFinding[];
        const visibleFindings = reviewFindingPublicationContext.visibleFindings as ProcessedFinding[];
        const lowConfidenceFindings = reviewFindingPublicationContext.lowConfidenceFindings as ProcessedFinding[];
        const filteredInlineFindings = reviewFindingPublicationContext.filteredInlineFindings as ProcessedFinding[];
        const suppressionMatchCounts = reviewFindingPublicationContext.suppressionMatchCounts;
        const filterResult = reviewFindingPublicationContext.filterResult;
        const prioritizationStats = reviewFindingPublicationContext.prioritizationStats;
        const reviewReducerDetailsSummary = reviewFindingPublicationContext.reviewReducerDetailsSummary;
        const reviewCandidatePublicationAdapterDetailsSummary =
          reviewCandidatePublicationContext.adapterDetailsSummary;
        const reviewFindingLifecycleContext = resolveReviewFindingLifecycleContext({
          logger,
          baseLog,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
          deliveryId: event.id,
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          findings: processedFindings,
          candidateFinding: reviewCandidateFindingResult,
          candidatePublicationPayloads: reviewCandidatePublicationAdapter.payloads,
          candidatePublisherResults,
        });
        const reviewFindingLifecycleResult = reviewFindingLifecycleContext.lifecycleResult;
        const reviewValidationTruthProjection = reviewFindingLifecycleContext.validationTruthProjection;
        logReviewCandidatePublicationAdapterContext({
          logger,
          baseLog,
          reviewOutputKey,
          deliveryId: event.id,
          adapter: reviewCandidatePublicationAdapter,
          detailsSummary: reviewCandidatePublicationAdapterDetailsSummary,
        });

        // Delta classification (REV-03)
        // Only classify deltas in incremental mode when prior findings exist.
        let deltaClassification: DeltaClassification | null = null;
        if (incrementalResult?.mode === "incremental" && priorFindingCtx) {
          try {
            const priorFindings = await knowledgeStore!.getPriorReviewFindings({
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
            });
            if (priorFindings.length > 0) {
              deltaClassification = classifyFindingDeltas({
                currentFindings: processedFindings,
                priorFindings,
                fingerprintFn: fingerprintFindingTitle,
              });
            }
          } catch (err) {
            logger.warn(
              { ...baseLog, err },
              "Delta classification failed (fail-open, publishing without delta labels)",
            );
          }
        }

        if (reviewOutputSucceeded && filteredInlineFindings.length > 0) {
          await removeFilteredInlineComments({
            octokit: extractionOctokit,
            owner: apiOwner,
            repo: apiRepo,
            findings: filteredInlineFindings,
            logger,
            baseLog,
          });
        }

        const {
          findingCounts,
          suppressionsApplied,
          reviewDetailsLineCounts,
          linesChanged,
          hasReviewDetailsOperationalSignal,
        } = resolveReviewDetailsRuntimeContext({
          processedFindings,
          filteredInlineFindings,
          diffLinesAdded: diffAnalysis?.metrics.totalLinesAdded ?? 0,
          diffLinesRemoved: diffAnalysis?.metrics.totalLinesRemoved ?? 0,
          prApiLinesAdded: pr.additions ?? 0,
          prApiLinesRemoved: pr.deletions ?? 0,
          reviewPlanDetailsSummary,
          reviewCandidatePublicationRuntime,
        });

        let canonicalReviewDetailsBody: string | null = null;
        const reviewDetailsBodyBase = {
          reviewOutputKey,
          filesReviewed: diffAnalysis?.metrics.totalFiles ?? changedFiles.length,
          linesAdded: reviewDetailsLineCounts.linesAdded,
          linesRemoved: reviewDetailsLineCounts.linesRemoved,
          findingCounts,
          largePRTriage: tieredFiles.isLargePR ? {
            fullCount: tieredFiles.full.length,
            abbreviatedCount: tieredFiles.abbreviated.length,
            mentionOnlyFiles: tieredFiles.mentionOnly.map((f) => ({ filePath: f.filePath, score: f.score })),
            totalFiles: tieredFiles.totalFiles,
          } : undefined,
          reviewBoundedness,
          feedbackSuppressionCount: feedbackSuppression.suppressedPatternCount,
          keywordParsing: parsedIntent,
          profileSelection,
          contributorExperience: authorClassification.contract.reviewDetails,
          shadowSpecialistReviewDetails: shadowSpecialistReviewDetailsProjection,
          candidatePublicationBridge: handlerCandidatePublicationBridge.reviewDetails,
          candidateVerificationPublicationEvidence: reviewCandidateVerificationPublicationEvidence,
          prioritization: prioritizationStats,
          usageLimit: result.usageLimit,
          tokenUsage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
          structuralImpact: structuralImpactForReview,
          reviewPlan: reviewPlanDetailsSummary,
          reviewReducer: reviewReducerDetailsSummary,
          reviewCandidateFinding: reviewCandidateFindingDetailsSummary,
          reviewCandidatePublication: reviewCandidatePublicationRuntime.detailsSummary,
          reviewFindingLifecycle: reviewFindingLifecycleResult.projection,
          reviewValidationTruth: reviewValidationTruthProjection,
          phaseTimingSummary: buildReviewDetailsPhaseTimingSummary({
            phases: reviewPhaseTimings,
            publicationPhaseStartedAt,
            totalPhaseStartAt,
          }),
          lineCountSource: reviewDetailsLineCounts.source,
        } satisfies ReviewDetailsBodyBaseParams;
        const {
          renderReviewDetailsBody,
          finalizePublicationPhaseTiming,
          logReviewDetailsPublicationCompleted,
          logCanonicalReviewDetailsPublicationCompleted,
        } = createReviewDetailsPublicationRuntime({
          logger,
          baseLog,
          reviewOutputKey,
          deliveryId: event.id,
          doctrineFields: buildRepoDoctrineLogFields(repoDoctrineProjection),
          reviewDetailsBodyBase,
          hasOperationalSignal: hasReviewDetailsOperationalSignal,
          getVisibleBudgetProjection: () => visibleBudgetState.refresh(),
          filteredFindings: filterResult.filtered,
          reviewPhaseTimings,
          getPublicationPhaseStartedAt: () => publicationPhaseStartedAt,
        });

        if (reviewOutputSucceeded) {
          logger.info(
            {
              ...baseLog,
              gate: "review-details-output",
              gateResult: "attempt",
              reviewOutputKey,
              deltaNew: deltaClassification?.counts.new ?? null,
              deltaResolved: deltaClassification?.counts.resolved ?? null,
              deltaStillOpen: deltaClassification?.counts.stillOpen ?? null,
              provenanceCount: retrievalCtx?.findings.length ?? null,
            },
            "Attempting canonical Review Details publication",
          );

          try {
            const fullDetailsBody = renderReviewDetailsBody();
            canonicalReviewDetailsBody = fullDetailsBody;

            if (result.published) {
              await publishPublishedReviewDetailsMerge({
                octokit: extractionOctokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                reviewOutputKey,
                fullDetailsBody,
                botHandles: [githubApp.getAppSlug(), "claude"],
                acceptedCanonicalSurface,
                authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
                reviewBoundedness,
                baseLog,
                logger,
                canPublishVisibleOutput,
                setReviewWorkPhase,
                renderReviewDetailsBody,
                finalizePublicationPhaseTiming,
                logReviewDetailsPublicationCompleted,
                logCanonicalReviewDetailsPublicationCompleted,
              });
            } else {
              const hasMovedToDetailsFindings = reviewCandidatePublicationRuntime.counts.candidateMovedToDetails > 0;
              const approvalWillOwnCanonicalSurface = result.conclusion === "success" && !hasMovedToDetailsFindings;

              if (hasMovedToDetailsFindings) {
                await publishMovedToDetailsReviewDetailsMerge({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  fullDetailsBody,
                  botHandles: [githubApp.getAppSlug(), "claude"],
                  acceptedCanonicalSurface,
                  authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
                  reviewBoundedness,
                  baseLog,
                  logger,
                  canPublishVisibleOutput,
                  setReviewWorkPhase,
                  renderReviewDetailsBody,
                  finalizePublicationPhaseTiming,
                  logReviewDetailsPublicationCompleted,
                  logCanonicalReviewDetailsPublicationCompleted,
                });
              } else if (!approvalWillOwnCanonicalSurface) {
                await publishStandaloneReviewDetailsFallback({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  fullDetailsBody,
                  botHandles: [githubApp.getAppSlug(), "claude"],
                  canPublishVisibleOutput,
                  setReviewWorkPhase,
                  renderReviewDetailsBody,
                  finalizePublicationPhaseTiming,
                  logReviewDetailsPublicationCompleted,
                });
              }
            }
          } catch (err) {
            logger.warn(
              {
                ...baseLog,
                gate: "review-details-output",
                gateResult: "failed",
                reviewOutputKey,
                err,
              },
              "Failed to publish canonical-or-degraded Review Details output",
            );
          }
        }

        // Telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          await recordReviewExecutionTelemetry({
            telemetryStore,
            logger,
            deliveryId: event.id,
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
            prAuthor: pr.user.login,
            eventType: `pull_request.${payload.action}`,
            result,
            promptSections: result.promptSections ?? reviewPromptSections,
            derivedPromptCacheStatus: reviewPromptDerivedCacheStatus,
            derivedPromptCacheReason: reviewPromptDerivedCacheReason ?? undefined,
            warningPrefix: "Review",
          });

          await maybePostReviewCostWarning({
            costUsd: result.costUsd,
            thresholdUsd: config.telemetry.costWarningUsd,
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            canPublishVisibleOutput,
            setReviewWorkPhase,
            getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
            botHandles: [githubApp.getAppSlug(), "claude"],
            logger,
          });
        }

        let reviewId: number | undefined;

        if (knowledgeStore) {
          const knowledgePersistence = await persistReviewKnowledge({
            knowledgeStore,
            logger,
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
            reviewOutputKey,
            reviewRecord: {
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              headSha: pr.head.sha,
              deliveryId: event.id,
              filesAnalyzed: diffAnalysis?.metrics.totalFiles ?? 0,
              linesChanged:
                linesChanged,
              findingsCritical: findingCounts.critical,
              findingsMajor: findingCounts.major,
              findingsMedium: findingCounts.medium,
              findingsMinor: findingCounts.minor,
              findingsTotal: processedFindings.length,
              suppressionsApplied,
              configSnapshot: JSON.stringify({
                mode: config.review.mode,
                severityMinLevel: config.review.severity.minLevel,
                focusAreas: config.review.focusAreas,
                maxComments: config.review.maxComments,
                suppressionCount: config.review.suppressions.length,
                minConfidence: config.review.minConfidence,
                profile: config.review.profile,
                shareGlobal: config.knowledge.shareGlobal,
                reviewPlan: reviewPlanConfigSnapshot,
                reviewReducer: {
                  status: reducerResult.status,
                  counts: reducerResult.counts,
                  reason: reducerResult.reason,
                },
                reviewCandidateFinding: reviewCandidateFindingConfigSnapshot,
                reviewCandidatePublication: reviewCandidatePublicationRuntime.safeConfigSnapshot,
                reviewCandidatePublicationFlow,
              }),
              durationMs: result.durationMs,
              model: config.model,
              conclusion: result.conclusion,
            },
            processedFindings,
            suppressionMatchCounts,
            visibleFindingCount: visibleFindings.length,
            lowConfidenceFindingCount: lowConfidenceFindings.length,
            suppressionsApplied,
            shareGlobal: config.knowledge.shareGlobal,
          });
          if (knowledgePersistence.ok) {
            reviewId = knowledgePersistence.value.reviewId;
          }
        }

        // Mark run as completed for idempotency tracking
        if (knowledgeStore) {
          await completeReviewRunFailOpen({
            knowledgeStore,
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
            baseSha: pr.base.sha,
            headSha: pr.head.sha,
            logger,
            logContext: baseLog,
          });
        }

        // Fire-and-forget incremental expertise update (PROF-04)
        if (contributorProfileStore) {
          scheduleContributorExpertiseUpdate({
            contributorProfileStore,
            githubUsername: pr.user.login,
            filesChanged: reviewFiles,
            logger,
          });
        }

        // Async learning memory write (LEARN-06)
        // Write accepted and suppressed findings to learning memory with embeddings.
        // This is async and fail-open -- errors do not affect the review outcome.
        if (learningMemoryStore && embeddingProvider && processedFindings.length > 0) {
          // Fire and forget: don't await, don't block review completion
          Promise.resolve().then(async () => {
            await writeReviewLearningMemoryBatch({
              findings: processedFindings,
              owner: apiOwner,
              repo: `${apiOwner}/${apiRepo}`,
              reviewId,
              prNumber: pr.number,
              store: learningMemoryStore,
              embeddingProvider,
              logger,
              logContext: baseLog,
              // Context-aware language classification: .h files in C++ PRs become "cpp" (LANG-01)
              classifyLanguage: (filePath) => classifyFileLanguageWithContext(filePath, changedFiles),
            });
          }).catch((err) => {
            logger.warn(
              { ...baseLog, err },
              'Learning memory write pipeline failed (fail-open)',
            );
          });
        }

        // Async hunk embedding (SNIP-01): embed PR diff hunks for future retrieval.
        // Fire-and-forget: does not block review completion.
        scheduleReviewHunkEmbedding({
          diffContent: diffContext.diffContent,
          repo: `${apiOwner}/${apiRepo}`,
          owner: apiOwner,
          prNumber: pr.number,
          prTitle: pr.title,
          codeSnippetStore,
          embeddingProvider,
          config: config.knowledge.retrieval.hunkEmbedding,
          logger,
          logContext: baseLog,
        });

        if (result.conclusion === "success" && result.published) {
          logger.info(
            {
              evidenceType: "review",
              outcome: "published-output",
              deliveryId: event.id,
              installationId: event.installationId,
              owner: apiOwner,
              repoName: apiRepo,
              repo: `${apiOwner}/${apiRepo}`,
              prNumber: pr.number,
              reviewOutputKey,
            },
            "Evidence bundle",
          );
        }

        const executionOutcome = resolveReviewExecutionOutcomeContext({
          result,
          totalTimeoutSeconds: appliedTimeoutBudget?.totalTimeoutSeconds,
          defaultTimeoutSeconds: config.timeoutSeconds,
          timeoutComplexityReasoning: timeoutEstimate?.reasoning,
        });
        const turnBudgetExhausted = executionOutcome.exhaustedTurnBudget;

        // Post error or partial-review comment if execution failed, timed out, or exhausted review turns.
        if (executionOutcome.shouldHandleErrorOrTurnLimit) {
          const { category, timeoutDuration, complexityInfo } = executionOutcome;
          let publishedPartialReview = false;
          let partialCommentId: number | undefined;
          let fallbackRetryState: string | undefined;
          let deferredPublicOutputForContinuation = false;

          if (result.isTimeout || turnBudgetExhausted) {
            // Step 1: Read checkpoint/progress data
            const checkpoint = (await knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null;
            const hasPublishedInlines = result.published ?? false;
            const timeoutInlineFindings = hasPublishedInlines
              ? await extractFindingsFromReviewComments({
                  octokit: extractionOctokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  logger,
                  baseLog,
                })
              : [];
            const timeoutReviewedFiles = Array.from(new Set([
              ...(checkpoint?.filesReviewed ?? []),
              ...timeoutInlineFindings.map((finding) => finding.filePath),
            ]));
            const timeoutInspectedFiles = Array.from(new Set([
              ...timeoutReviewedFiles,
              ...(checkpoint?.filesInspected ?? []),
            ]));
            const timeoutFindingCount = Math.max(
              checkpoint?.findingCount ?? 0,
              timeoutInlineFindings.length,
            );
            const timeoutTotalFiles = checkpoint?.totalFiles ?? changedFiles.length;
            const timeoutFirstPass = normalizeReviewFirstPass({
              boundedness: reviewBoundedness,
              checkpoint,
              outcome: {
                conclusion: result.conclusion,
                stopReason: result.stopReason,
                failureSubtype: result.failureSubtype,
                isTimeout: result.isTimeout,
                published: result.published,
              },
            });
            const hasPartialResults = timeoutFirstPass?.state === "bounded-first-pass";

            // Step 2: Check chronic timeout threshold before publishing
            const recentTimeouts = await telemetryStore.countRecentTimeouts?.(
              `${apiOwner}/${apiRepo}`,
              pr.user.login,
            ) ?? 0;
            const isChronicTimeout = recentTimeouts >= 3;

            const executionConclusion = result.isTimeout && result.published
              ? "timeout_partial"
              : result.isTimeout
                ? "timeout"
                : turnBudgetExhausted
                  ? "max_turns"
                  : result.conclusion;

            let retryState = isChronicTimeout
              ? "skipped (frequent timeouts for this repo/author)"
              : hasPublishedInlines
                ? "not scheduled (GitHub-visible findings already posted)"
                : "not scheduled";
            let retrySummaryNote: string | undefined;
            let retryPlan: ReturnType<typeof planReviewContinuation> | null = null;
            let continuationProjectionDegraded = false;

            if (timeoutFirstPass) {
              retryPlan = planReviewContinuation({
                reviewOutputKey,
                firstPass: timeoutFirstPass,
                checkpoint,
                riskScores,
                timeoutSeconds: timeoutDuration,
                continuationCompaction: {
                  attemptId: reviewWorkAttempt.attemptId,
                  attemptOrdinal: 0,
                  promptBudgetOutcomes: buildPromptBudgetOutcomes(visibleBudgetState.promptSectionRecords),
                  cacheTelemetryObservations: visibleBudgetState.reviewCacheObservations,
                },
                hasPublishedInlineFindings: hasPublishedInlines,
                isChronicTimeout,
                estimateContinuationTimeout: ({ timeoutSeconds, files }) => {
                  const retryLinesChanged = files.reduce((sum, filePath) => {
                    const stats = perFileStats.get(filePath);
                    if (!stats) return sum;
                    return sum + stats.added + stats.removed;
                  }, 0);
                  return estimateTimeoutRisk({
                    fileCount: files.length,
                    linesChanged: retryLinesChanged,
                    languageComplexity,
                    isLargePR: false,
                    baseTimeoutSeconds: timeoutSeconds,
                  });
                },
              });

              switch (retryPlan.decision) {
                case "schedule-continuation":
                  if (retryPlan.continuationCompaction) {
                    visibleBudgetState.continuationCompactionObservations.push(retryPlan.continuationCompaction);
                    visibleBudgetState.refresh();
                  }
                  retryState = "scheduled reduced-scope retry";
                  retrySummaryNote = "Scheduling a reduced-scope retry.";
                  break;
                case "skip-continuation":
                  switch (retryPlan.reason) {
                    case "chronic-timeout":
                      retryState = "skipped (frequent timeouts for this repo/author)";
                      break;
                    case "inline-output-already-published":
                      retryState = "not scheduled (GitHub-visible findings already posted)";
                      retrySummaryNote = "Retry not scheduled because GitHub-visible findings were already posted.";
                      break;
                    case "no-remaining-scope":
                      retryState = "not scheduled (no remaining files outside analyzed progress)";
                      retrySummaryNote = "Retry not scheduled because no remaining files were outside the analyzed progress.";
                      break;
                    case "invalid-checkpoint-scope":
                      retryState = "not scheduled (invalid checkpoint scope)";
                      retrySummaryNote = "Retry not scheduled because checkpoint scope was malformed.";
                      break;
                    case "zero-evidence-failure": {
                      retryState = "not scheduled (zero-evidence timeout)";
                      if (knowledgeStore?.upsertContinuationFamilyState && !knowledgeStore.saveCheckpoint) {
                        retrySummaryNote = "Retry not scheduled because the first pass produced no trustworthy evidence and checkpoint persistence is unavailable.";
                        break;
                      }

                      const retryRemoteRuntimeBudgetSeconds = Math.max(30, Math.floor(timeoutDuration / 2));
                      const retryScope = computeRetryScope({
                        allFiles: riskScores,
                        filesAlreadyReviewed: timeoutReviewedFiles,
                        totalFiles: timeoutTotalFiles,
                      });

                      if (retryScope.filesToReview.length > 0) {
                        const continuationFiles = retryScope.filesToReview.map((file) => file.filePath);
                        const timeoutEstimate = estimateTimeoutRisk({
                          fileCount: continuationFiles.length,
                          linesChanged: continuationFiles.reduce((sum, filePath) => {
                            const stats = perFileStats.get(filePath);
                            if (!stats) return sum;
                            return sum + stats.added + stats.removed;
                          }, 0),
                          languageComplexity,
                          isLargePR: false,
                          baseTimeoutSeconds: retryRemoteRuntimeBudgetSeconds,
                        });
                        retryPlan = {
                          decision: "schedule-continuation",
                          reason: "remaining-scope-available",
                          reviewOutputKey,
                          continuationReviewOutputKey: `${reviewOutputKey}-retry-1`,
                          continuationNumber: 1,
                          continuationFiles,
                          scopeRatio: retryScope.scopeRatio,
                          timeoutSeconds: timeoutEstimate.totalTimeoutSeconds,
                          checkpointEnabled:
                            reviewRouting.taskType === TASK_TYPES.REVIEW_FULL ||
                            timeoutEstimate.riskLevel === "medium" ||
                            timeoutEstimate.riskLevel === "high",
                          timeoutEstimate,
                          firstPass: timeoutFirstPass,
                          checkpoint,
                        };
                        retryState = "scheduled reduced-scope retry";
                        retrySummaryNote = "Scheduling a reduced-scope retry.";
                      }
                      break;
                    }
                  }
                  break;
              }
            }

            const retryClassificationInput = retryPlan?.decision === "schedule-continuation"
              ? {
                  enqueued: true,
                  filesCount: retryPlan.continuationFiles.length,
                  scopeRatio: retryPlan.scopeRatio,
                  timeoutSeconds: retryPlan.timeoutSeconds,
                  checkpointEnabled: retryPlan.checkpointEnabled,
                  riskLevel: retryPlan.timeoutEstimate.riskLevel,
                }
              : {
                  enqueued: false,
                  filesCount: 0,
                };
            const timeoutClassification = classifyReviewTimeoutOutcome({
              deliveryId: event.id,
              reviewOutputKey,
              outcome: {
                isTimeout: result.isTimeout,
                stopReason: result.stopReason,
                failureSubtype: result.failureSubtype,
              },
              firstPass: timeoutFirstPass
                ? {
                    state: timeoutFirstPass.state,
                    boundedReason: timeoutFirstPass.boundedReason,
                    evidenceSource: timeoutFirstPass.evidenceSource,
                    continuationPending: timeoutFirstPass.continuationPending,
                    zeroEvidenceFailure: timeoutFirstPass.zeroEvidenceFailure,
                  }
                : null,
              checkpoint: checkpoint
                ? {
                    filesReviewed: timeoutReviewedFiles.length,
                    filesInspected: timeoutInspectedFiles.length,
                    findingCount: timeoutFindingCount,
                    totalFiles: timeoutTotalFiles,
                  }
                : null,
              retry: retryClassificationInput,
              continuation: retryPlan
                ? { decision: retryPlan.decision, reason: retryPlan.reason }
                : null,
              chronicTimeout: isChronicTimeout,
              recentTimeouts,
              longRun: {
                thresholdExceeded: false,
                durationSeconds: typeof result.durationMs === "number" ? Math.floor(result.durationMs / 1000) : undefined,
                thresholdSeconds: timeoutDuration,
              },
            });
            const timeoutClassificationTelemetry = logReviewTimeoutClassification({
              logger,
              baseLog,
              classification: timeoutClassification,
              deliveryId: event.id,
              reviewOutputKey,
              prNumber: pr.number,
              chronicBudgetExhaustion: isChronicTimeout,
              retryEnqueued: retryPlan?.decision === "schedule-continuation",
            });

            // Step 3: Publish bounded first-pass output only when trustworthy structured evidence exists.
            const summaryDraftBase = checkpoint?.summaryDraft ?? (hasPublishedInlines
              ? "Review stopped after GitHub-visible findings were already posted."
              : hasPartialResults
                ? "Review stopped after structured first-pass progress was recorded."
                : "Review stopped before producing trustworthy structured output.");
            const summaryDraft = retrySummaryNote
              ? `${summaryDraftBase}\n\n${retrySummaryNote}`
              : summaryDraftBase;
            fallbackRetryState = retryState;
            const timeoutReviewDetails = {
              analyzedFiles: timeoutInspectedFiles.length,
              totalFiles: timeoutTotalFiles,
              findingCount: timeoutFindingCount,
              retryState,
            };

            const octokit = extractionOctokit;
            deferredPublicOutputForContinuation = turnBudgetExhausted
              && retryPlan?.decision === "schedule-continuation"
              && !hasPublishedInlines;
            if (
              timeoutFirstPass?.state === "bounded-first-pass"
              && !deferredPublicOutputForContinuation
            ) {
              const partialBody = formatPartialReviewComment({
                summaryDraft,
                firstPass: timeoutFirstPass,
                reviewOutputKey,
                timedOutAfterSeconds: timeoutDuration,
                timeoutBudget: appliedTimeoutBudget
                  ? {
                      remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                      infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                      totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                    }
                  : null,
                isRetrySkipped: isChronicTimeout,
                retrySkipReason: isChronicTimeout
                  ? "Retry skipped -- this repo has timed out frequently for this author."
                  : undefined,
              });
              partialCommentId = await publishBoundedFirstPassReview({
                octokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                body: partialBody,
                botHandles: [githubApp.getAppSlug(), "claude"],
                canPublishVisibleOutput,
                setReviewWorkPhase,
              });
              if (partialCommentId !== undefined) {

              // Store partial comment ID in checkpoint for retry to find (best-effort).
              // Use saveCheckpoint() to ensure a record exists even when the run
              // timed out before the checkpoint tool was ever called.
              if (knowledgeStore?.saveCheckpoint) {
                await knowledgeStore.saveCheckpoint({
                  reviewOutputKey,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  filesReviewed: timeoutReviewedFiles,
                  filesInspected: timeoutInspectedFiles,
                  findingCount: timeoutFindingCount,
                  summaryDraft,
                  totalFiles: timeoutTotalFiles,
                  partialCommentId,
                });
              } else {
                void knowledgeStore?.updateCheckpointCommentId?.(reviewOutputKey, partialCommentId)?.catch((err) => {
                  logger.warn({ err, reviewOutputKey }, "Checkpoint comment id update failed (non-blocking)");
                });
              }

              publishedPartialReview = true;

              logger.info(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  partialCommentId,
                  boundedReason: timeoutFirstPass.boundedReason,
                  evidenceSource: timeoutFirstPass.evidenceSource,
                  coveredFiles: timeoutFirstPass.coveredScope?.reviewedFiles ?? null,
                  inspectedFiles: timeoutFirstPass.inspectedScope?.inspectedFiles ?? timeoutInspectedFiles.length,
                  remainingFiles: timeoutFirstPass.remainingScope?.remainingFiles ?? null,
                  findingCount: timeoutFindingCount,
                  hasPartialResults,
                  isChronicTimeout,
                  recentTimeouts,
                  retryState,
                  zeroEvidenceFailure: timeoutFirstPass.zeroEvidenceFailure,
                },
                "Published bounded first-pass review on timeout",
              );

              try {
                if (canPublishVisibleOutput("timeout canonical Review Details merge")) {
                  await upsertCanonicalReviewSurface({
                    octokit,
                    owner: apiOwner,
                    repo: apiRepo,
                    prNumber: pr.number,
                    reviewOutputKey,
                    preferredKind: "issue_comment",
                    canonicalSurface: partialCommentId
                      ? { kind: "issue_comment", commentId: partialCommentId, body: partialBody }
                      : undefined,
                    summaryBody: partialBody,
                    reviewDetailsBlock: renderReviewDetailsBody({
                      timeoutProgress: timeoutReviewDetails,
                      reviewFirstPass: timeoutFirstPass,
                      timeoutBudget: appliedTimeoutBudget
                        ? {
                            remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                            infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                            totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                          }
                        : null,
                    }),
                    botHandles: [githubApp.getAppSlug(), "claude"],
                    requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                    reviewBoundedness,
                    recheckCanPublish: () => canPublishVisibleOutput("timeout canonical Review Details merge"),
                  });
                }
              } catch (reviewDetailsErr) {
                logger.warn(
                  {
                    ...baseLog,
                    gate: "review-details-output",
                    gateResult: "degraded-fallback",
                    reviewOutputKey,
                    err: reviewDetailsErr,
                  },
                  "Failed to update timeout canonical review surface with Review Details; using degraded fallback comment",
                );

                await publishDegradedReviewDetailsFallbackFailOpen({
                  octokit,
                  owner: apiOwner,
                  repo: apiRepo,
                  prNumber: pr.number,
                  reviewOutputKey,
                  renderBody: () =>
                    renderReviewDetailsBody({
                      timeoutProgress: timeoutReviewDetails,
                      reviewFirstPass: timeoutFirstPass,
                      timeoutBudget: appliedTimeoutBudget
                        ? {
                            remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                            infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                            totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                          }
                        : null,
                    }),
                  botHandles: [githubApp.getAppSlug(), "claude"],
                  publishReason: "timeout degraded Review Details fallback comment",
                  failureMessage: "Failed to publish degraded Review Details fallback comment for timeout partial output",
                  baseLog,
                  logger,
                  canPublishVisibleOutput,
                });
              }

              // Structured resilience telemetry (best-effort)
              if (config.telemetry.enabled) {
                const resilienceTelemetryResult = await recordReviewResilienceEventFailOpen({
                  telemetryStore,
                  logger,
                  entry: {
                    deliveryId: event.id,
                    repo: `${apiOwner}/${apiRepo}`,
                    prNumber: pr.number,
                    prAuthor: pr.user.login,
                    eventType: `pull_request.${payload.action}`,
                    kind: "timeout",
                    reviewOutputKey,
                    executionConclusion,
                    hadInlineOutput: hasPublishedInlines,
                    checkpointFilesReviewed: timeoutReviewedFiles.length,
                    checkpointFilesInspected: timeoutInspectedFiles.length,
                    checkpointFindingCount: timeoutFindingCount,
                    checkpointTotalFiles: timeoutTotalFiles,
                    partialCommentId,
                    recentTimeouts,
                    chronicTimeout: isChronicTimeout,
                    retryEnqueued: false,
                    ...timeoutClassificationTelemetry,
                  },
                });
                if (!resilienceTelemetryResult.ok) {
                  continuationProjectionDegraded = true;
                }
              }
              }
            }

            if (timeoutFirstPass?.state === "zero-evidence-failure") {
              logger.warn(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  boundedReason: timeoutFirstPass.boundedReason,
                  evidenceSource: timeoutFirstPass.evidenceSource,
                  zeroEvidenceFailure: true,
                  reviewOutputKey,
                },
                "Constrained timeout remained a zero-evidence hard failure",
              );
            }

            if (retryPlan?.decision !== "schedule-continuation") {
              await persistContinuationFamilyState({
                authoritativeAttemptId: reviewWorkAttempt.attemptId,
                authoritativeOutcome: "blocked",
                finalStopReason: "no-follow-up",
                projectionStatus: continuationProjectionDegraded ? "degraded" : "canonical",
              });
            }

            // Step 4: Enqueue retry if eligible (not chronic, exactly 1 retry)
            // Retry is only useful when no GitHub-visible output was published.
            // If inline comments were already posted, avoid a retry that could
            // create additional noise or duplicates.
            if (retryPlan?.decision === "schedule-continuation") {
              const retryReviewOutputKey = retryPlan.continuationReviewOutputKey;
              const retryTimeout = retryPlan.timeoutSeconds;
              const retryFiles = retryPlan.continuationFiles;
              const retryTimeoutEstimate = retryPlan.timeoutEstimate;
              const retryCheckpointEnabled = retryPlan.checkpointEnabled;
              const retryScopeRatio = retryPlan.scopeRatio;
              const retryDeliveryId = `${event.id}-retry-1`;
              const retryReviewWorkAttempt = reviewWorkCoordinator.claim({
                familyKey: reviewFamilyKey,
                source: "automatic-review",
                lane: "review",
                deliveryId: retryDeliveryId,
                phase: "claimed",
              });

              // Update resilience telemetry with retry plan
              if (config.telemetry.enabled) {
                const resilienceTelemetryResult = await recordReviewResilienceEventFailOpen({
                  telemetryStore,
                  logger,
                  entry: {
                    deliveryId: event.id,
                    repo: `${apiOwner}/${apiRepo}`,
                    prNumber: pr.number,
                    prAuthor: pr.user.login,
                    eventType: `pull_request.${payload.action}`,
                    kind: "timeout",
                    reviewOutputKey,
                    executionConclusion,
                    hadInlineOutput: hasPublishedInlines,
                    checkpointFilesReviewed: timeoutReviewedFiles.length,
                    checkpointFilesInspected: timeoutInspectedFiles.length,
                    checkpointFindingCount: timeoutFindingCount,
                    checkpointTotalFiles: timeoutTotalFiles,
                    partialCommentId,
                    recentTimeouts,
                    chronicTimeout: isChronicTimeout,
                    retryEnqueued: true,
                    retryFilesCount: retryFiles.length,
                    retryScopeRatio,
                    retryTimeoutSeconds: retryTimeout,
                    retryRiskLevel: retryTimeoutEstimate.riskLevel,
                    retryCheckpointEnabled,
                    ...timeoutClassificationTelemetry,
                  },
                });
                if (!resilienceTelemetryResult.ok) {
                  continuationProjectionDegraded = true;
                }
              }

              logger.info(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  retryFiles: retryFiles.length,
                  scopeRatio: retryScopeRatio,
                  retryTimeout,
                  retryRiskLevel: retryTimeoutEstimate.riskLevel,
                },
                "Enqueueing retry with reduced scope",
              );

              if (timeoutFirstPass?.zeroEvidenceFailure && knowledgeStore?.saveCheckpoint) {
                await knowledgeStore.saveCheckpoint({
                  reviewOutputKey,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  filesReviewed: timeoutReviewedFiles,
                  filesInspected: timeoutInspectedFiles,
                  findingCount: timeoutFindingCount,
                  summaryDraft,
                  totalFiles: timeoutTotalFiles,
                  partialCommentId,
                });
              }

              await persistContinuationFamilyState({
                authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                authoritativeOutcome: "continuation-pending",
                finalStopReason: "awaiting-continuation",
                projectionStatus: "pending",
                reviewOutputKey: retryReviewOutputKey,
              });

              // Fire-and-forget enqueue -- do not await the retry result.
              // Claim before queueing so the retry is visible in family diagnostics
              // and retains its request ordering, but publish rights only become
              // authoritative when the queued retry actually starts executing.
              void jobQueue.enqueue(event.installationId, async () => {
                  let retryWorkspace: Workspace | undefined;
                  try {
                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "workspace-create");
                    retryWorkspace = await workspaceManager.create(event.installationId, {
                      owner: cloneOwner,
                      repo: cloneRepo,
                      ref: cloneRef,
                      depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                    });

                    if (usesPrRef) {
                      await fetchAndCheckoutPullRequestHeadRef({
                        dir: retryWorkspace.dir,
                        prNumber: pr.number,
                        localBranch: "pr-review-retry-1",
                        token: retryWorkspace.token,
                        fallbackRemoteUrl: pr.head.repo ? `https://github.com/${pr.head.repo.full_name}.git` : undefined,
                        fallbackRef: pr.head.ref,
                        depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                      });
                    }

                    await fetchRemoteTrackingBranchFn({
                      dir: retryWorkspace.dir,
                      branch: pr.base.ref,
                      token: retryWorkspace.token,
                      depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                    });

                    const retryCustomInstructions = buildReviewRetryCustomInstructions({
                      basePrompt: config.review.prompt,
                      isTimeout: result.isTimeout === true,
                      checkpointEnabled: retryCheckpointEnabled,
                    });

                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "prompt-build");
                    let retryReviewPromptDerivedCacheStatus: "hit" | "miss" | "degraded" | "bypass" = "bypass";
                    let retryReviewPromptDerivedCacheReason: string | null = null;
                    const retryPromptBuildContext = {
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      prTitle: pr.title,
                      prBody: pr.body ?? "",
                      prAuthor: pr.user.login,
                      baseBranch: pr.base.ref,
                      headBranch: pr.head.ref,
                      changedFiles: retryFiles,
                      customInstructions: retryCustomInstructions,
                      checkpointEnabled: retryCheckpointEnabled,
                      mode: config.review.mode,
                      severityMinLevel: resolvedSeverityMinLevel,
                      focusAreas: resolvedFocusAreas,
                      ignoredAreas: resolvedIgnoredAreas,
                      maxComments: resolvedMaxComments,
                      suppressions: config.review.suppressions,
                      minConfidence: config.review.minConfidence,
                      diffAnalysis,
                      diffContent: diffContext.diffContent,
                      matchedPathInstructions,
                      incrementalContext: incrementalResult?.mode === "incremental" ? {
                        lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
                        changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
                        unresolvedPriorFindings: priorFindingCtx?.unresolvedOnUnchangedCode ?? [],
                      } : null,
                      retrievalContext: retrievalCtx,
                      reviewPrecedents: reviewPrecedentsForPrompt.length > 0 ? reviewPrecedentsForPrompt : undefined,
                      wikiKnowledge: wikiKnowledgeForPrompt.length > 0 ? wikiKnowledgeForPrompt : undefined,
                      unifiedResults: unifiedResultsForPrompt.length > 0 ? unifiedResultsForPrompt : undefined,
                      contextWindow: contextWindowForPrompt,
                      filesByLanguage: diffAnalysis?.filesByLanguage,
                      outputLanguage: config.review.outputLanguage,
                      prLabels,
                      focusHints: parsedIntent.unrecognized,
                      conventionalType: parsedIntent.conventionalType,
                      deltaContext: incrementalResult?.mode === "incremental" && priorFindings.length > 0
                        ? {
                            lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
                            changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
                            priorFindings: priorFindings.map((f) => ({
                              filePath: f.filePath,
                              title: f.title,
                              severity: f.severity,
                              category: f.category,
                            })),
                          }
                        : null,
                      largePRContext: null,
                      gitDiffInstructionsAvailable: false,
                      publishToolNames: [
                        "mcp__github_comment__create_comment",
                        "mcp__github_inline_comment__create_inline_comment",
                      ],
                      contributorExperienceContract: authorClassification.contract,
                      authorExpertise: authorClassification.contract.state === "profile-backed"
                        ? authorClassification.expertise?.map((e) => ({
                            dimension: e.dimension,
                            topic: e.topic,
                            score: e.score,
                          }))
                        : undefined,
                      depBumpContext,
                      searchRateLimitDegradation: authorClassification.searchEnrichment,
                      isDraft,
                      // Review pattern clustering (CLST-03) — reuse from initial review
                      clusterPatterns: clusterPatternsForPrompt.length > 0 ? clusterPatternsForPrompt : undefined,
                      // PR-issue linking (PRLINK-03) — reuse from initial review
                      linkedIssues: linkedIssueResult,
                      structuralImpact: structuralImpactForReview,
                      repoDoctrine: repoDoctrineProjection,
                      smallDiffReview: reviewRouting.taskType === TASK_TYPES.REVIEW_SMALL_DIFF,
                      retryPromptCompaction: retryPlan.continuationCompaction
                        ? {
                            observation: retryPlan.continuationCompaction,
                            checkpointSummaries: checkpoint
                              ? [{
                                  reviewOutputKey: checkpoint.reviewOutputKey,
                                  filesReviewed: checkpoint.filesReviewed,
                                  findingCount: checkpoint.findingCount,
                                  totalFiles: checkpoint.totalFiles,
                                  summaryDraft: checkpoint.summaryDraft,
                                }]
                              : [],
                            promptBudgetOutcomes: buildPromptBudgetOutcomes(visibleBudgetState.promptSectionRecords).map((outcome) => ({
                              sectionName: outcome.sectionName,
                              status: outcome.status,
                              reason: outcome.reason,
                              includedChars: outcome.includedChars,
                              trimmedChars: outcome.trimmedChars,
                            })),
                            cacheSafetySignalNames: Array.from(new Set(visibleBudgetState.reviewCacheObservations.flatMap((observation) => observation.safetySignalNames ?? []))).sort((a, b) => a.localeCompare(b)),
                          }
                        : null,
                    } satisfies ReviewPromptBuildContext;
                    const retryPromptCacheState: ReviewPromptCacheState = {
                      status: retryReviewPromptDerivedCacheStatus,
                      reason: retryReviewPromptDerivedCacheReason,
                    };
                    const retryPromptResult = await buildReviewPromptResultWithCache({
                      cacheQuery: `retry:${pr.number}:${retryReviewOutputKey}`,
                      context: retryPromptBuildContext,
                      statusTarget: retryPromptCacheState,
                      promptBuilder: reviewPromptBuilder,
                      cache: reviewPromptDerivedCache,
                      getCacheErrorCount: () => reviewPromptDerivedCacheErrorCount,
                      buildFingerprint: buildReviewPromptFingerprint,
                      logger,
                    });
                    retryReviewPromptDerivedCacheStatus = retryPromptCacheState.status;
                    retryReviewPromptDerivedCacheReason = retryPromptCacheState.reason;
                    const retryPrompt = retryPromptResult.text;
                    const retryPromptSections = [
                      buildPromptSectionRecord({
                        deliveryId: retryDeliveryId,
                        repo: `${apiOwner}/${apiRepo}`,
                        taskType: reviewRouting.taskType,
                        promptKind: "review.user-prompt",
                        sections: retryPromptResult.sections,
                      }),
                    ];
                    logger.info(
                      {
                        ...baseLog,
                        deliveryId: retryDeliveryId,
                        gate: "review-derived-prompt-cache",
                        gateResult: retryReviewPromptDerivedCacheStatus,
                        ...(retryReviewPromptDerivedCacheReason ? { reason: retryReviewPromptDerivedCacheReason } : {}),
                      },
                      "Resolved retry review prompt derived-cache state",
                    );
                    const retryPromptCacheEvent = buildPromptReviewCacheEvent({
                      deliveryId: retryDeliveryId,
                      repo: `${apiOwner}/${apiRepo}`,
                      prNumber: pr.number,
                      state: retryPromptCacheState,
                    });
                    visibleBudgetState.reviewCacheObservations.push(retryPromptCacheEvent);
                    visibleBudgetState.refresh();
                    if (config.telemetry.enabled) {
                      await recordReviewCacheEventFailOpen({
                        telemetryStore,
                        logger,
                        entry: retryPromptCacheEvent,
                      });
                    }

                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "executor-dispatch");
                    const retryResult = await executor.execute({
                      workspace: retryWorkspace,
                      installationId: event.installationId,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      commentId: undefined,
                      botHandles: [githubApp.getAppSlug(), "claude"],
                      eventType: "pull_request.review-retry",
                      taskType: reviewRouting.taskType,
                      triggerBody: "",
                      prompt: retryPrompt,
                      promptSections: retryPromptSections,
                      reviewOutputKey: retryReviewOutputKey,
                      deliveryId: retryDeliveryId,
                      candidateVerificationContext: {
                        docsConfigTruth: null,
                        deliveryId: retryDeliveryId,
                        reviewOutputKey: retryReviewOutputKey,
                        correlationKey: buildShadowSpecialistCorrelationKey({
                          deliveryId: retryDeliveryId,
                          reviewOutputKey: retryReviewOutputKey,
                          prNumber: pr.number,
                        }),
                      },
                      dynamicTimeoutSeconds: retryTimeout,
                      maxTurnsOverride: reviewMaxTurnsOverride,
                      knowledgeStore,
                      totalFiles: timeoutTotalFiles,
                      enableCheckpointTool: retryCheckpointEnabled,
                      prDiffCommentabilityIndex,
                      enableCommentTools: false,
                    });

                      const {
                        retryCheckpoint,
                        retryHasResults,
                        retryTimeoutClassification,
                      } = await resolveReviewRetryExecutionOutcome({
                        telemetryEnabled: config.telemetry.enabled,
                        telemetryStore,
                        logger,
                        retryDeliveryId,
                        parentDeliveryId: event.id,
                        repo: `${apiOwner}/${apiRepo}`,
                        prNumber: pr.number,
                        prAuthor: pr.user.login,
                        retryReviewOutputKey,
                        retryResult,
                        retryPromptSections,
                        retryReviewPromptDerivedCacheStatus,
                        retryReviewPromptDerivedCacheReason: retryReviewPromptDerivedCacheReason ?? undefined,
                        retryFilesCount: retryFiles.length,
                        retryScopeRatio,
                        retryTimeoutSeconds: retryTimeout,
                        retryRiskLevel: retryTimeoutEstimate.riskLevel,
                        retryCheckpointEnabled,
                        partialCommentId,
                        timeoutTotalFiles,
                        getCheckpoint: (key) => knowledgeStore?.getCheckpoint?.(key) ?? Promise.resolve(null),
                      });

                    if (
                      retryResult.conclusion === "success" ||
                      (retryResult.isTimeout && retryHasResults)
                    ) {
                      if (!checkpoint) {
                        await settleRetryWithoutCanonicalUpdate({
                          attemptId: retryReviewWorkAttempt.attemptId,
                          reviewOutputKey: retryReviewOutputKey,
                          deliveryId: retryDeliveryId,
                          reason: "missing-base-checkpoint",
                          logMessage: "Retry settlement skipped because the base checkpoint was missing",
                        });
                        return;
                      }

                      const settlementDecision = settleReviewContinuation({
                        reviewOutputKey,
                        continuationReviewOutputKey: retryReviewOutputKey,
                        baseCheckpoint: checkpoint,
                        continuationCheckpoint: retryCheckpoint,
                        continuationPublished: retryResult.published ?? false,
                      });

                      if (settlementDecision.decision === "merge-continuation") {
                        const continuationRevisionCounts = await resolveReviewContinuationRevisionCounts({
                          repo: `${apiOwner}/${apiRepo}`,
                          prNumber: pr.number,
                          reviewOutputKey,
                          logger,
                          baseLog,
                          getPriorReviewFindings: knowledgeStore?.getPriorReviewFindings,
                          extractFindings: async () => await extractFindingsFromReviewComments({
                            octokit: await githubApp.getInstallationOctokit(event.installationId),
                            owner: apiOwner,
                            repo: apiRepo,
                            prNumber: pr.number,
                            reviewOutputKey,
                            logger,
                            baseLog,
                          }),
                        });

                        if (
                          continuationRevisionCounts
                          && continuationRevisionCounts.new === 0
                          && continuationRevisionCounts.stillOpen === 0
                          && continuationRevisionCounts.resolved === 0
                        ) {
                          logger.info(
                            {
                              deliveryId: retryDeliveryId,
                              prNumber: pr.number,
                              retryConclusion: retryResult.conclusion,
                              settlementReason: "no-meaningful-delta",
                            },
                            "Retry produced no additional results -- keeping original partial review",
                          );
                          await persistContinuationFamilyState({
                            authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                            authoritativeOutcome: "quiet-settled",
                            finalStopReason: "settled-without-update",
                            projectionStatus: "canonical",
                            reviewOutputKey: retryReviewOutputKey,
                          });
                          discardCheckpointsFailOpen(knowledgeStore, logger, [reviewOutputKey, retryReviewOutputKey]);
                          return;
                        }

                        const mergeContext = resolveReviewContinuationMergeContext({
                          reviewBoundedness,
                          mergedCheckpoint: settlementDecision.mergedCheckpoint,
                          retryCheckpoint,
                          baseCheckpoint: checkpoint,
                          firstPassOutcome: {
                            conclusion: result.conclusion,
                            stopReason: result.stopReason,
                            failureSubtype: result.failureSubtype,
                            isTimeout: result.isTimeout,
                            published: true,
                          },
                          timeoutFirstPassBoundedReason: timeoutFirstPass?.boundedReason,
                          timeoutDurationSeconds: timeoutDuration,
                          retryFilesCount: retryFiles.length,
                          reviewOutputKey,
                          continuationRevisionCounts,
                        });

                        if (mergeContext.status === "non-publishable") {
                          await settleRetryWithoutCanonicalUpdate({
                            attemptId: retryReviewWorkAttempt.attemptId,
                            reviewOutputKey: retryReviewOutputKey,
                            deliveryId: retryDeliveryId,
                            reason: mergeContext.reason,
                            logMessage: "Retry merge skipped because bounded first-pass state became non-publishable",
                          });
                          return;
                        }

                        const retryOctokit = await githubApp.getInstallationOctokit(event.installationId);
                        const storedCheckpoint = (await knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null;
                        const commentIdToUpdate = storedCheckpoint?.partialCommentId ?? partialCommentId;

                        if (canPublishReviewWorkOutput(
                          retryReviewWorkAttempt.attemptId,
                          "retry partial review merge",
                          retryDeliveryId,
                        )) {
                          setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "publish");

                          let retryMergeProjectionStatus: ContinuationFamilyProjectionStatus = "canonical";
                          let retryMergeLogMessage = commentIdToUpdate
                            ? "Retry complete -- updated partial review comment with merged results"
                            : "Retry complete -- published final review comment with merged results";

                          try {
                            const mergedBodyWithDetails = await upsertCanonicalReviewSurface({
                              octokit: retryOctokit,
                              owner: apiOwner,
                              repo: apiRepo,
                              prNumber: pr.number,
                              reviewOutputKey,
                              preferredKind: "issue_comment",
                              canonicalSurface: commentIdToUpdate
                                ? {
                                    kind: "issue_comment",
                                    commentId: commentIdToUpdate,
                                    body: mergeContext.body,
                                  }
                                : undefined,
                              summaryBody: mergeContext.body,
                              reviewDetailsBlock: renderReviewDetailsBody({
                                reviewFirstPass: mergeContext.reviewDetailsFirstPass,
                              }),
                              botHandles: [githubApp.getAppSlug(), "claude"],
                              requireDegradationDisclosure: authorClassification.searchEnrichment.degraded,
                              reviewBoundedness,
                              recheckCanPublish: () =>
                                canPublishReviewWorkOutput(
                                  retryReviewWorkAttempt.attemptId,
                                  "retry canonical Review Details merge",
                                  retryDeliveryId,
                                ),
                            });

                            if (!mergedBodyWithDetails) {
                              await settleRetryWithoutCanonicalUpdate({
                                attemptId: retryReviewWorkAttempt.attemptId,
                                reviewOutputKey: retryReviewOutputKey,
                                deliveryId: retryDeliveryId,
                                reason: "publish-superseded",
                                logMessage: "Retry settlement skipped because publish rights were superseded",
                              });
                              return;
                            }
                          } catch (reviewDetailsErr) {
                            logger.warn(
                              {
                                ...baseLog,
                                gate: "review-details-output",
                                gateResult: "degraded-fallback",
                                reviewOutputKey,
                                err: reviewDetailsErr,
                              },
                              "Failed to update retry canonical review surface with Review Details; using degraded fallback comment",
                            );

                            retryMergeProjectionStatus = "degraded";
                            retryMergeLogMessage = commentIdToUpdate
                              ? "Retry complete -- updated partial review comment with merged results; Review Details published via degraded fallback comment"
                              : "Retry complete -- published final review comment with merged results; Review Details published via degraded fallback comment";

                            await publishDegradedReviewDetailsFallbackFailOpen({
                              octokit: retryOctokit,
                              owner: apiOwner,
                              repo: apiRepo,
                              prNumber: pr.number,
                              reviewOutputKey,
                              renderBody: () =>
                                renderReviewDetailsBody({
                                  reviewFirstPass: mergeContext.reviewDetailsFirstPass,
                                }),
                              botHandles: [githubApp.getAppSlug(), "claude"],
                              publishReason: "retry degraded Review Details fallback comment",
                              failureMessage: "Failed to publish degraded Review Details fallback comment after retry merge",
                              baseLog,
                              logger,
                              canPublishVisibleOutput: (reason) =>
                                canPublishReviewWorkOutput(
                                  retryReviewWorkAttempt.attemptId,
                                  reason,
                                  retryDeliveryId,
                                ),
                            });
                          }

                          logger.info(
                            {
                              deliveryId: retryDeliveryId,
                              prNumber: pr.number,
                              retryConclusion: retryResult.conclusion,
                              retryFilesReviewed: mergeContext.retryFilesReviewed,
                              partialCommentId,
                              settlementReason: settlementDecision.reason,
                              projectionStatus: retryMergeProjectionStatus,
                            },
                            retryMergeLogMessage,
                          );

                          await persistContinuationFamilyState({
                            authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                            authoritativeOutcome: "merged",
                            finalStopReason: "merged-continuation-results",
                            projectionStatus: retryMergeProjectionStatus,
                            reviewOutputKey: retryReviewOutputKey,
                          });

                          // Cleanup checkpoint data after successful merge
                          discardCheckpointsFailOpen(knowledgeStore, logger, [reviewOutputKey, retryReviewOutputKey]);
                        }
                      } else {
                        logger.info(
                          {
                            deliveryId: retryDeliveryId,
                            prNumber: pr.number,
                            retryConclusion: retryResult.conclusion,
                            settlementReason: settlementDecision.reason,
                          },
                          "Retry produced no additional results -- keeping original partial review",
                        );
                        await persistContinuationFamilyState({
                          authoritativeAttemptId: retryReviewWorkAttempt.attemptId,
                          authoritativeOutcome: "quiet-settled",
                          finalStopReason: "settled-without-update",
                          projectionStatus: "canonical",
                          reviewOutputKey: retryReviewOutputKey,
                        });
                      }
                    } else {
                      logger.info(
                        {
                          deliveryId: retryDeliveryId,
                          prNumber: pr.number,
                          retryConclusion: retryResult.conclusion,
                        },
                        "Retry produced no additional results -- keeping original partial review",
                      );
                    }

                  } catch (retryErr) {
                    logger.error(
                      {
                        err: retryErr,
                        deliveryId: retryDeliveryId,
                        prNumber: pr.number,
                        ...classifyRetryFailure(retryErr),
                      },
                      "Retry failed with error",
                    );
                    await finalizeContinuationAttempt({
                      attemptId: retryReviewWorkAttempt.attemptId,
                      fallbackOutcome: "blocked",
                      fallbackStopReason: "no-follow-up",
                      reviewOutputKey: retryReviewOutputKey,
                    });
                  } finally {
                    if (retryWorkspace) {
                      await retryWorkspace.cleanup();
                    }

                    try {
                      reviewWorkCoordinator.complete(retryReviewWorkAttempt.attemptId);
                    } finally {
                      // Best-effort checkpoint cleanup even on retry failure.
                      // Retry attempts are capped at 1, so leaving checkpoint rows
                      // behind provides little value and can accumulate stale state.
                      discardCheckpointsFailOpen(knowledgeStore, logger, [retryReviewOutputKey, reviewOutputKey]);
                    }
                  }
                }, {
                  deliveryId: retryDeliveryId,
                  eventName: event.name,
                  action: `review-retry`,
                  lane: "review",
                  key: reviewFamilyKey,
                  jobType: "pull-request-review-retry",
                  prNumber: pr.number,
                }).catch(async (err) => {
                  await finalizeContinuationAttempt({
                    attemptId: retryReviewWorkAttempt.attemptId,
                    fallbackOutcome: "blocked",
                    fallbackStopReason: "no-follow-up",
                    reviewOutputKey: retryReviewOutputKey,
                  });
                  reviewWorkCoordinator.release(retryReviewWorkAttempt.attemptId);
                  logger.error(
                    { err, deliveryId: event.id, prNumber: pr.number, ...classifyRetryFailure(err) },
                    "Failed to enqueue retry job",
                  );
                });
            }
          }

          if (!publishedPartialReview && !deferredPublicOutputForContinuation) {
            const errorPublication = await publishReviewExecutionErrorFallback({
              octokit: await githubApp.getInstallationOctokit(event.installationId),
              owner: apiOwner,
              repo: apiRepo,
              prNumber: pr.number,
              exhaustedTurnBudget: turnBudgetExhausted,
              retryScheduled: fallbackRetryState?.startsWith("scheduled") === true,
              category,
              errorMessage: result.errorMessage,
              totalTimeoutSeconds: timeoutDuration,
              complexityInfo,
              timeoutEstimate: appliedTimeoutBudget,
              logger,
              canPublishVisibleOutput,
              setReviewWorkPhase,
            });
            const errorPublicationState = errorPublication.ok ? errorPublication.value : errorPublication.err;
            if (errorPublicationState.resolution !== "skipped") {
              reviewOutputPublished = errorPublicationState.published;
              reviewPublishResolution = errorPublicationState.resolution;
              reviewPublishFallbackDelivery = errorPublicationState.fallbackDelivery;
            }
          }
        }

        if (result.conclusion === "failure" && !(result.published ?? false) && !turnBudgetExhausted) {
          const octokit = await githubApp.getInstallationOctokit(event.installationId);
          const failurePublication = await publishReviewFailureFallback({
            octokit,
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            logger,
            canPublishVisibleOutput,
            setReviewWorkPhase,
          });
          const failurePublicationState = failurePublication.ok ? failurePublication.value : failurePublication.err;
          reviewPublishFallbackDelivery = failurePublicationState.fallbackDelivery;
          if (failurePublicationState.resolution !== "skipped") {
            reviewOutputPublished = failurePublicationState.published;
            reviewPublishResolution = failurePublicationState.resolution;
          }
        }

        // Clean review publication: when no output was produced, publish the clean
        // result either as an approving pull review (explicit opt-in) or as a
        // normal issue comment (default behavior).
        if (result.conclusion === "success") {
          const cleanReviewPublication = await publishCleanReviewApproval({
            resultPublished: result.published ?? false,
            autoApprove: config.review.autoApprove,
            getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
            getAppSlug: () => githubApp.getAppSlug(),
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            reviewOutputKey,
            deliveryId: event.id,
            installationId: event.installationId,
            promptFileCount: promptFiles.length,
            canonicalReviewDetailsBody,
            authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
            reviewBoundedness,
            mergeConfidence: depBumpContext?.mergeConfidence ?? null,
            logger,
            canPublishVisibleOutput,
            setReviewWorkPhase,
            refreshVisibleBudgetProjection: () => visibleBudgetState.refresh(),
            renderReviewDetailsBody,
            finalizePublicationPhaseTiming,
            logReviewDetailsPublicationCompleted,
            logCanonicalReviewDetailsPublicationCompleted,
          });
          if (cleanReviewPublication.published) {
            reviewOutputPublished = true;
            reviewPublishResolution = cleanReviewPublication.resolution;
          }
        }
      } catch (err) {
        publicationPhaseStartedAt = await handleReviewHandlerFailureRecovery({
          error: err,
          prNumber: pr.number,
          reviewPhaseTimings,
          workspacePhaseStartedAt,
          retrievalPhaseStartedAt,
          publicationPhaseStartedAt,
          logger,
          publishHandlerFailureError: async () => await publishReviewHandlerFailureError({
            octokit: await githubApp.getInstallationOctokit(event.installationId),
            owner: apiOwner,
            repo: apiRepo,
            prNumber: pr.number,
            error: err,
            logger,
            canPublishVisibleOutput,
            setReviewWorkPhase,
          }),
        });
      } finally {
        for (const phase of executorPhaseTimings) {
          if (!reviewPhaseTimings.has(phase.name)) {
            reviewPhaseTimings.set(phase.name, phase);
          }
        }

        logReviewExecutionCompleted();

        finalizeReviewPhaseSummary({
          reviewPhaseTimings,
          workspacePhaseStartedAt,
          retrievalPhaseStartedAt,
          publicationPhaseStartedAt,
          totalPhaseStartAt,
          executorResult,
          deliveryId: event.id,
          reviewOutputKey,
          installationId: event.installationId,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          reviewOutputPublished,
          reviewPublishResolution,
          reviewPublishFallbackDelivery,
          logger,
        });

        if (workspace) {
          await workspace.cleanup();
        }
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      lane: "review",
      key: reviewFamilyKey,
      jobType: "pull-request-review",
      prNumber: pr.number,
    });
  } finally {
    reviewWorkRuntime.finalize();
  }

  logger.info(
    { ...baseLog, gate: "enqueue", gateResult: "completed" },
    "Review enqueue completed",
  );
}

// Register for review trigger events
eventRouter.register("pull_request.opened", handleReview);
eventRouter.register("pull_request.ready_for_review", handleReview);
eventRouter.register("pull_request.review_requested", handleReview);
eventRouter.register("pull_request.synchronize", handleReview);
}
