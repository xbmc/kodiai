import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import type {
  KnowledgeStore,
} from "../knowledge/types.ts";
import type { LearningMemoryStore, EmbeddingProvider } from "../knowledge/types.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import { classifyFindingDeltas, type DeltaClassification } from "../lib/delta-classifier.ts";
import { type FindingClaimClassification } from "../lib/claim-classifier.ts";
import { analyzeDiff, classifyFileLanguageWithContext } from "../execution/diff-analysis.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";
import { buildPromptSectionRecord } from "../execution/prompt-section-metrics.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import { formatErrorComment } from "../lib/errors.ts";
import { estimateTimeoutRisk } from "../lib/timeout-estimator.ts";
import {
  settleReviewContinuation,
} from "../lib/review-continuation-lifecycle.ts";
import { type createRetriever } from "../knowledge/retrieval.ts";
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
import { fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
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
import { classifyReviewTimeoutOutcome } from "../review-orchestration/review-timeout-classification.ts";
import { logReviewTimeoutClassification } from "../review-orchestration/review-timeout-classification-log.ts";
import {
  buildReviewDetailsPhaseTimingSummary,
  createReviewPhaseTiming,
  formatTimeoutErrorDetail,
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
  type SearchCache,
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
import { maybePostReviewRequestedEyesReaction } from "./review-reactions.ts";
import { resolveReviewPrIntent } from "./review-pr-intent.ts";
import { resolveReviewAuthorContext } from "./review-author-context.ts";
import { resolveReviewDependsFlow } from "./review-depends-flow.ts";
import { resolveReviewStructuralImpactSelection } from "./review-structural-impact-selection.ts";
import { evaluateReviewTriggerConfigGate } from "./review-trigger-config-gate.ts";
import { evaluateReviewRunStateGate } from "./review-run-state-gate.ts";
import { evaluateReviewSkipAuthorGate } from "./review-skip-author-gate.ts";
import {
  resolveReviewFilesForIncrementalReview,
  resolveReviewIncrementalDiff,
} from "./review-incremental-diff.ts";
import { evaluateReviewSkipPathsGate } from "./review-skip-paths-gate.ts";
import { resolveReviewShadowSpecialistContext } from "./review-shadow-specialist.ts";
import { resolveReviewDiffContext } from "./review-diff-context.ts";
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
import { publishDegradedReviewDetailsFallbackFailOpen } from "./review-details-degraded-fallback.ts";
import { publishTimeoutReviewDetailsMerge } from "./review-details-timeout-publication.ts";
import { publishRetryReviewDetailsMerge } from "./review-details-retry-publication.ts";
import { publishFirstPassReviewDetails } from "./review-details-first-pass-publication.ts";
import { resolveReviewTimeoutProgressContext } from "./review-timeout-progress-context.ts";
import { resolveReviewTimeoutRetryContext } from "./review-timeout-retry-context.ts";
import { resolveReviewTimeoutPublicationContext } from "./review-timeout-publication-context.ts";
import { resolveReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";
import { resolveReviewTimeoutContinuationState } from "./review-timeout-continuation-state.ts";
import {
  resolveMergedContinuationFamilyState,
  resolvePendingContinuationFamilyState,
  resolveQuietSettledContinuationFamilyState,
} from "./review-continuation-family-state-projection.ts";
import { resolveReviewGraphValidationLLM } from "./review-graph-validation-llm.ts";
import { resolveReviewFeedbackSuppression } from "./review-feedback-suppression.ts";
import { persistPartialReviewCheckpoint } from "./review-partial-checkpoint.ts";
import { createReviewHandlerRuntime, type ReviewPromptDerivedCacheOptions } from "./review-handler-runtime.ts";
import { prepareReviewRetryWorkspace, prepareReviewWorkspace } from "./review-workspace-preparation.ts";
import {
  resolveReviewEventRuntime,
  type ReviewWebhookPayload,
} from "./review-event-runtime.ts";
import { createReviewJobRuntime } from "./review-job-runtime.ts";


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
  reviewPromptDerivedCacheOptions?: ReviewPromptDerivedCacheOptions;
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

  const {
    guardrailAuditStore,
    structuralImpactCache,
    reviewWorkCoordinator,
    reviewPromptDerivedCache,
    getReviewPromptDerivedCacheErrorCount,
    authorPrCountSearchCache,
  } = createReviewHandlerRuntime({
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    injectedSearchCache,
    searchCacheFactory,
    reviewPromptDerivedCacheOptions,
    logger,
  });

  async function handleReview(event: WebhookEvent): Promise<void> {
    const payload = event.payload as unknown as ReviewWebhookPayload;
    const reviewEventRuntime = await resolveReviewEventRuntime({
      event,
      payload,
      githubApp,
      reviewWorkCoordinator,
      logger,
    });
    if (reviewEventRuntime.action === "skip") return;
    const {
      pr,
      eventAction: action,
      baseLog,
      reviewOutputKey,
      isDraft,
      apiOwner,
      apiRepo,
      cloneOwner,
      cloneRepo,
      cloneRef,
      usesPrRef,
      reviewFamilyKey,
      reviewWorkAttempt,
      reviewWorkRuntime,
    } = reviewEventRuntime;
    const {
      setPhase: setReviewWorkPhase,
      setPhaseForAttempt: setReviewWorkPhaseForAttempt,
    } = reviewWorkRuntime;

    try {
      await jobQueue.enqueue(event.installationId, async (queueMetadata) => {
      const reviewJobRuntime = createReviewJobRuntime({
        queueMetadata,
        logger,
        baseLog,
        prNumber: pr.number,
        deliveryId: event.id,
        reviewFamilyKey,
        reviewOutputKey,
        knowledgeStore,
        reviewWorkCoordinator,
        reviewWorkRuntime,
      });
      const {
        reviewPhaseTimings,
        timingState,
        publicationState,
        logReviewExecutionCompleted,
        continuationFamilyState,
        canPublishVisibleOutput,
      } = reviewJobRuntime;
      const {
        persistContinuationFamilyState,
        settleRetryWithoutCanonicalUpdate,
        finalizeContinuationAttempt,
        canPublishReviewWorkOutput,
      } = continuationFamilyState;

      const runStateGate = await evaluateReviewRunStateGate({
        knowledgeStore,
        repo: `${apiOwner}/${apiRepo}`,
        prNumber: pr.number,
        baseSha: pr.base.sha,
        headSha: pr.head.sha,
        deliveryId: event.id,
        action,
        baseLog,
        logger,
      });
      if (runStateGate.action === "skip") return;

      let workspace: Workspace | undefined;
      try {
        setReviewWorkPhase("workspace-create");
        timingState.workspacePhaseStartedAt = Date.now();
        const preparedWorkspace = await prepareReviewWorkspace({
          workspaceManager,
          installationId: event.installationId,
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef,
          depth: REVIEW_WORKSPACE_FETCH_DEPTH,
          usesPrRef,
          prNumber: pr.number,
          baseRef: pr.base.ref,
          fallbackHeadRepoFullName: pr.head.repo?.full_name ?? null,
          fallbackHeadRef: pr.head.ref,
          fetchRemoteTrackingBranchFn,
          onBeforeFinalizeConfig: () => setReviewWorkPhase("load-config"),
          logger,
        });
        workspace = preparedWorkspace.workspace;
        const { config } = preparedWorkspace;
        reviewPhaseTimings.set("workspace preparation", preparedWorkspace.workspacePreparationPhase);

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

        await maybePostReviewRequestedEyesReaction({
          action,
          getOctokit: () => githubApp.getInstallationOctokit(event.installationId),
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          logger,
        });

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

        timingState.retrievalPhaseStartedAt = Date.now();
        const {
          diffContext,
          diffContentForValidation,
          prDiffCommentabilityIndex,
          allChangedFiles,
        } = await resolveReviewDiffContext({
          diffContextCollector,
          workspaceDir: workspace.dir,
          baseRef: pr.base.ref,
          token: workspace.token,
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          logger,
          baseLog,
        });

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
          getCacheErrorCount: getReviewPromptDerivedCacheErrorCount,
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
            durationMs: Math.max(0, Date.now() - (timingState.retrievalPhaseStartedAt ?? Date.now())),
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
        publicationState.executorResult = executorState.executorResult;
        publicationState.reviewExecutorPublished = executorState.reviewExecutorPublished;
        publicationState.reviewOutputPublished = executorState.reviewOutputPublished;
        publicationState.reviewPublishResolution = executorState.reviewPublishResolution;
        visibleBudgetState.promptSectionRecords = executorState.promptSectionRecords;
        visibleBudgetState.refresh();
        timingState.executorPhaseTimings = executorState.executorPhaseTimings;
        for (const phase of timingState.executorPhaseTimings) {
          reviewPhaseTimings.set(phase.name, phase);
        }
        timingState.publicationPhaseStartedAt = Date.now();

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
        const feedbackSuppression = await resolveReviewFeedbackSuppression({
          knowledgeStore,
          repo: `${apiOwner}/${apiRepo}`,
          config: config.feedback.autoSuppress,
          logger,
        });

        const graphValidationLLM = resolveReviewGraphValidationLLM({
          enabled: config.review.graphValidation.enabled,
          hasGraphBlastRadius: Boolean(graphBlastRadius),
          repo: `${apiOwner}/${apiRepo}`,
          deliveryId: event.id,
          logger,
        });

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
            publicationPhaseStartedAt: timingState.publicationPhaseStartedAt,
            totalPhaseStartAt: timingState.totalPhaseStartAt,
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
          getPublicationPhaseStartedAt: () => timingState.publicationPhaseStartedAt,
        });

        const firstPassReviewDetailsPublication = await publishFirstPassReviewDetails({
          reviewOutputSucceeded,
          resultPublished: result.published,
          resultConclusion: result.conclusion,
          candidateMovedToDetailsCount: reviewCandidatePublicationRuntime.counts.candidateMovedToDetails,
          octokit: extractionOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
          botHandles: [githubApp.getAppSlug(), "claude"],
          acceptedCanonicalSurface,
          authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
          reviewBoundedness,
          baseLog,
          attemptLogFields: {
            deltaNew: deltaClassification?.counts.new ?? null,
            deltaResolved: deltaClassification?.counts.resolved ?? null,
            deltaStillOpen: deltaClassification?.counts.stillOpen ?? null,
            provenanceCount: retrievalCtx?.findings.length ?? null,
          },
          logger,
          canPublishVisibleOutput,
          setReviewWorkPhase,
          renderReviewDetailsBody,
          finalizePublicationPhaseTiming,
          logReviewDetailsPublicationCompleted,
          logCanonicalReviewDetailsPublicationCompleted,
        });
        canonicalReviewDetailsBody = firstPassReviewDetailsPublication.canonicalReviewDetailsBody;

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
            const {
              checkpoint,
              hasPublishedInlines,
              timeoutInlineFindings,
              timeoutReviewedFiles,
              timeoutInspectedFiles,
              timeoutFindingCount,
              timeoutTotalFiles,
              timeoutFirstPass,
              hasPartialResults,
            } = await resolveReviewTimeoutProgressContext({
              reviewOutputKey,
              changedFileCount: changedFiles.length,
              reviewBoundedness,
              outcome: {
                conclusion: result.conclusion,
                stopReason: result.stopReason,
                failureSubtype: result.failureSubtype,
                isTimeout: result.isTimeout,
                published: result.published,
              },
              getCheckpoint: async (key) => (await knowledgeStore?.getCheckpoint?.(key)) ?? null,
              extractInlineFindings: async () => await extractFindingsFromReviewComments({
                octokit: extractionOctokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                reviewOutputKey,
                logger,
                baseLog,
              }),
            });

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

            const retryContext = resolveReviewTimeoutRetryContext({
              reviewOutputKey,
              timeoutFirstPass,
              checkpoint,
              riskScores,
              timeoutDurationSeconds: timeoutDuration,
              continuationCompaction: {
                attemptId: reviewWorkAttempt.attemptId,
                attemptOrdinal: 0,
                promptBudgetOutcomes: buildPromptBudgetOutcomes(visibleBudgetState.promptSectionRecords),
                cacheTelemetryObservations: visibleBudgetState.reviewCacheObservations,
              },
              hasPublishedInlines,
              isChronicTimeout,
              timeoutReviewedFiles,
              timeoutTotalFiles,
              checkpointPersistenceUnavailableForFamilyState:
                Boolean(knowledgeStore?.upsertContinuationFamilyState) && !knowledgeStore?.saveCheckpoint,
              forceCheckpointEnabled: reviewRouting.taskType === TASK_TYPES.REVIEW_FULL,
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
            const { retryPlan, retryState, retrySummaryNote } = retryContext;
            let continuationProjectionDegraded = false;

            if (retryPlan?.decision === "schedule-continuation" && retryPlan.continuationCompaction) {
              visibleBudgetState.continuationCompactionObservations.push(retryPlan.continuationCompaction);
              visibleBudgetState.refresh();
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

            const timeoutPublicationContext = resolveReviewTimeoutPublicationContext({
              reviewOutputKey,
              checkpoint,
              hasPublishedInlines,
              hasPartialResults,
              retryState,
              retrySummaryNote,
              timeoutInspectedFiles,
              timeoutFindingCount,
              timeoutTotalFiles,
              turnBudgetExhausted,
              retryScheduled: retryPlan?.decision === "schedule-continuation",
              timeoutFirstPass,
              timeoutDurationSeconds: timeoutDuration,
              timeoutBudget: appliedTimeoutBudget
                ? {
                    remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                    infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                    totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                  }
                : null,
              isChronicTimeout,
            });
            const {
              summaryDraft,
              timeoutReviewDetails,
              partialBody,
            } = timeoutPublicationContext;
            fallbackRetryState = retryState;

            const octokit = extractionOctokit;
            deferredPublicOutputForContinuation = timeoutPublicationContext.deferredPublicOutputForContinuation;
            if (
              timeoutFirstPass?.state === "bounded-first-pass"
              && !deferredPublicOutputForContinuation
              && partialBody !== undefined
            ) {
              const partialPublication = await publishBoundedFirstPassReview({
                octokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                body: partialBody,
                botHandles: [githubApp.getAppSlug(), "claude"],
                canPublishVisibleOutput,
                setReviewWorkPhase,
              });
              if (partialPublication.ok) {
                partialCommentId = partialPublication.value.commentId;
              } else {
                logger.warn(
                  { err: partialPublication.err.error, deliveryId: event.id, prNumber: pr.number },
                  "Failed to publish bounded first-pass review",
                );
              }
              if (partialCommentId !== undefined) {
              await persistPartialReviewCheckpoint({
                knowledgeStore,
                logger,
                checkpoint: {
                  reviewOutputKey,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  filesReviewed: timeoutReviewedFiles,
                  filesInspected: timeoutInspectedFiles,
                  findingCount: timeoutFindingCount,
                  summaryDraft,
                  totalFiles: timeoutTotalFiles,
                  partialCommentId,
                },
              });

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

              await publishTimeoutReviewDetailsMerge({
                octokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                reviewOutputKey,
                partialCommentId,
                partialBody,
                botHandles: [githubApp.getAppSlug(), "claude"],
                timeoutReviewDetailsRuntime: {
                  timeoutProgress: timeoutReviewDetails,
                  reviewFirstPass: timeoutFirstPass,
                  timeoutBudget: appliedTimeoutBudget
                    ? {
                        remoteRuntimeBudgetSeconds: appliedTimeoutBudget.remoteRuntimeBudgetSeconds,
                        infraOverheadBudgetSeconds: appliedTimeoutBudget.infraOverheadBudgetSeconds,
                        totalTimeoutSeconds: appliedTimeoutBudget.totalTimeoutSeconds,
                      }
                    : null,
                },
                authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
                reviewBoundedness,
                baseLog,
                logger,
                canPublishVisibleOutput,
                renderReviewDetailsBody,
              });

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

            const retryEnqueueContext = resolveReviewRetryEnqueueContext({
              deliveryId: event.id,
              retryPlan,
            });
            const timeoutContinuationState = resolveReviewTimeoutContinuationState({
              attemptId: reviewWorkAttempt.attemptId,
              timeoutFirstPass,
              retryScheduled: retryEnqueueContext !== null,
              continuationProjectionDegraded,
            });

            if (timeoutContinuationState.zeroEvidenceWarning) {
              logger.warn(
                {
                  deliveryId: event.id,
                  prNumber: pr.number,
                  ...timeoutContinuationState.zeroEvidenceWarning,
                  reviewOutputKey,
                },
                "Constrained timeout remained a zero-evidence hard failure",
              );
            }

            if (timeoutContinuationState.blockedFamilyState) {
              await persistContinuationFamilyState(timeoutContinuationState.blockedFamilyState);
            }

            // Step 4: Enqueue retry if eligible (not chronic, exactly 1 retry)
            // Retry is only useful when no GitHub-visible output was published.
            // If inline comments were already posted, avoid a retry that could
            // create additional noise or duplicates.
            if (retryEnqueueContext) {
              const {
                retryReviewOutputKey,
                retryTimeout,
                retryFiles,
                retryTimeoutEstimate,
                retryCheckpointEnabled,
                retryScopeRatio,
                retryDeliveryId,
                retryContinuationCompaction,
              } = retryEnqueueContext;
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

              await persistContinuationFamilyState(resolvePendingContinuationFamilyState({
                attemptId: retryReviewWorkAttempt.attemptId,
                reviewOutputKey: retryReviewOutputKey,
              }));

              // Fire-and-forget enqueue -- do not await the retry result.
              // Claim before queueing so the retry is visible in family diagnostics
              // and retains its request ordering, but publish rights only become
              // authoritative when the queued retry actually starts executing.
              void jobQueue.enqueue(event.installationId, async () => {
                  let retryWorkspace: Workspace | undefined;
                  try {
                    setReviewWorkPhaseForAttempt(retryReviewWorkAttempt.attemptId, "workspace-create");
                    retryWorkspace = await prepareReviewRetryWorkspace({
                      workspaceManager,
                      installationId: event.installationId,
                      owner: cloneOwner,
                      repo: cloneRepo,
                      ref: cloneRef,
                      depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                      usesPrRef,
                      prNumber: pr.number,
                      baseRef: pr.base.ref,
                      fallbackHeadRepoFullName: pr.head.repo?.full_name ?? null,
                      fallbackHeadRef: pr.head.ref,
                      localBranch: "pr-review-retry-1",
                      fetchRemoteTrackingBranchFn,
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
                      retryPromptCompaction: retryContinuationCompaction
                        ? {
                            observation: retryContinuationCompaction,
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
                      getCacheErrorCount: getReviewPromptDerivedCacheErrorCount,
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
                          await persistContinuationFamilyState(resolveQuietSettledContinuationFamilyState({
                            attemptId: retryReviewWorkAttempt.attemptId,
                            reviewOutputKey: retryReviewOutputKey,
                          }));
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

                          const retryReviewDetailsPublication = await publishRetryReviewDetailsMerge({
                            octokit: retryOctokit,
                            owner: apiOwner,
                            repo: apiRepo,
                            prNumber: pr.number,
                            attemptId: retryReviewWorkAttempt.attemptId,
                            deliveryId: retryDeliveryId,
                            reviewOutputKey,
                            retryReviewOutputKey,
                            commentIdToUpdate,
                            mergeBody: mergeContext.body,
                            reviewDetailsFirstPass: mergeContext.reviewDetailsFirstPass,
                            botHandles: [githubApp.getAppSlug(), "claude"],
                            authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
                            reviewBoundedness,
                            baseLog,
                            logger,
                            canPublishReviewWorkOutput,
                            renderReviewDetailsBody,
                            settleRetryWithoutCanonicalUpdate,
                          });

                          if (!retryReviewDetailsPublication.ok) {
                            logger.warn(
                              { ...baseLog, err: retryReviewDetailsPublication.err },
                              "Retry Review Details publication failed",
                            );
                            return;
                          }

                          const retryReviewDetailsPublicationStatus = retryReviewDetailsPublication.value;
                          if (retryReviewDetailsPublicationStatus.status === "settled-without-canonical-update") {
                            return;
                          }

                          logger.info(
                            {
                              deliveryId: retryDeliveryId,
                              prNumber: pr.number,
                              retryConclusion: retryResult.conclusion,
                              retryFilesReviewed: mergeContext.retryFilesReviewed,
                              partialCommentId,
                              settlementReason: settlementDecision.reason,
                              projectionStatus: retryReviewDetailsPublicationStatus.projectionStatus,
                            },
                            retryReviewDetailsPublicationStatus.logMessage,
                          );

                          await persistContinuationFamilyState(resolveMergedContinuationFamilyState({
                            attemptId: retryReviewWorkAttempt.attemptId,
                            projectionStatus: retryReviewDetailsPublicationStatus.projectionStatus,
                            reviewOutputKey: retryReviewOutputKey,
                          }));

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
                        await persistContinuationFamilyState(resolveQuietSettledContinuationFamilyState({
                          attemptId: retryReviewWorkAttempt.attemptId,
                          reviewOutputKey: retryReviewOutputKey,
                        }));
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
              publicationState.reviewOutputPublished = errorPublicationState.published;
              publicationState.reviewPublishResolution = errorPublicationState.resolution;
              publicationState.reviewPublishFallbackDelivery = errorPublicationState.fallbackDelivery;
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
          publicationState.reviewPublishFallbackDelivery = failurePublicationState.fallbackDelivery;
          if (failurePublicationState.resolution !== "skipped") {
            publicationState.reviewOutputPublished = failurePublicationState.published;
            publicationState.reviewPublishResolution = failurePublicationState.resolution;
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
          const cleanReviewPublicationState = cleanReviewPublication.ok
            ? cleanReviewPublication.value
            : { published: false as const, resolution: "skipped" as const };
          if (cleanReviewPublicationState.published) {
            publicationState.reviewOutputPublished = true;
            publicationState.reviewPublishResolution = cleanReviewPublicationState.resolution;
          }
        }
      } catch (err) {
        timingState.publicationPhaseStartedAt = await handleReviewHandlerFailureRecovery({
          error: err,
          prNumber: pr.number,
          reviewPhaseTimings,
          workspacePhaseStartedAt: timingState.workspacePhaseStartedAt,
          retrievalPhaseStartedAt: timingState.retrievalPhaseStartedAt,
          publicationPhaseStartedAt: timingState.publicationPhaseStartedAt,
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
        for (const phase of timingState.executorPhaseTimings) {
          if (!reviewPhaseTimings.has(phase.name)) {
            reviewPhaseTimings.set(phase.name, phase);
          }
        }

        logReviewExecutionCompleted();

        finalizeReviewPhaseSummary({
          reviewPhaseTimings,
          workspacePhaseStartedAt: timingState.workspacePhaseStartedAt,
          retrievalPhaseStartedAt: timingState.retrievalPhaseStartedAt,
          publicationPhaseStartedAt: timingState.publicationPhaseStartedAt,
          totalPhaseStartAt: timingState.totalPhaseStartAt,
          executorResult: publicationState.executorResult,
          deliveryId: event.id,
          reviewOutputKey,
          installationId: event.installationId,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          reviewOutputPublished: publicationState.reviewOutputPublished,
          reviewPublishResolution: publicationState.reviewPublishResolution,
          reviewPublishFallbackDelivery: publicationState.reviewPublishFallbackDelivery,
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
