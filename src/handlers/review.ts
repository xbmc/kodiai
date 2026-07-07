import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type {
  KnowledgeStore,
} from "../knowledge/types.ts";
import type { LearningMemoryStore, EmbeddingProvider } from "../knowledge/types.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { DeltaClassification } from "../lib/delta-classifier.ts";
import { type FindingClaimClassification } from "../lib/claim-classifier.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import { buildReviewPromptDetails } from "../execution/review-prompt.ts";
import type { SuggestionClusterStore } from "../knowledge/suggestion-cluster-store.ts";
import { formatErrorComment } from "../lib/errors.ts";
import { estimateTimeoutRisk } from "../lib/timeout-estimator.ts";
import { type createRetriever } from "../knowledge/retrieval.ts";
import {
  type TimeoutReviewDetailsProgress,
  type TimeoutBudgetDetails,
} from "../lib/review-details-formatting.ts";
import {
  type FindingSeverity,
  type FindingCategory,
} from "../lib/review-finding-metadata.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import { fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";
import {
  reduceReviewFindings,
  type ReviewReducerInput,
  type ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import {
  buildReviewPlan,
  type ReviewPlanBuilder,
} from "../review-orchestration/review-plan.ts";
import {
  formatTimeoutErrorDetail,
  recordReviewExecutorPhaseTimings,
} from "../review-orchestration/review-phase-timing.ts";
export { formatTimeoutErrorDetail } from "../review-orchestration/review-phase-timing.ts";
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
} from "../review-orchestration/review-comment-finding-extraction.ts";
export { resolveAuthorTierFromSources } from "../review-orchestration/review-author-tier.ts";
import {
  buildReviewPromptFingerprint,
} from "../review-orchestration/review-prompt-fingerprint.ts";
export { buildReviewPromptFingerprint, type ReviewPromptBuildContext, type ReviewPromptFingerprintResult } from "../review-orchestration/review-prompt-fingerprint.ts";
import {
  collectDiffContext,
  REVIEW_WORKSPACE_FETCH_DEPTH,
} from "../review-orchestration/review-diff-collection.ts";
export { collectDiffContext, REVIEW_WORKSPACE_FETCH_DEPTH } from "../review-orchestration/review-diff-collection.ts";
import {
  buildRepoDoctrineLogFields,
} from "../review-orchestration/review-plan-doctrine-log.ts";
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
  buildReviewDetailsPublicationRuntimeAdapters,
  createReviewDetailsPublicationRuntime,
} from "./review-details-publication-runtime.ts";
import { buildReviewDetailsBodyBase } from "./review-details-body-base.ts";
import { buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies } from "./review-handler-failure-publication-adapter.ts";
import { evaluateReviewOutputIdempotencyGate } from "./review-idempotency-gate.ts";
import { buildReviewRetrievalContext } from "./review-retrieval-context.ts";
import { buildReviewDepBumpContext } from "./review-dep-bump-context.ts";
import {
  persistReviewKnowledgeIfAvailable,
} from "./review-knowledge-persistence.ts";
import {
  recordReviewPostExecutionSideEffects,
} from "./review-post-execution-side-effects.ts";
import { recordReviewPostExecutionTelemetry } from "./review-post-execution-telemetry.ts";
import { buildReviewPostExecutionTelemetryPublicationContext } from "./review-post-execution-telemetry-context.ts";
import {
  buildReviewRequestedEyesReactionAdapters,
  maybePostReviewRequestedEyesReaction,
} from "./review-reactions.ts";
import { resolveReviewPrIntent } from "./review-pr-intent.ts";
import { resolveReviewAuthorContext } from "./review-author-context.ts";
import { resolveReviewDependsFlow } from "./review-depends-flow.ts";
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
import { applyReviewExecutorState, projectReviewExecutorState } from "./review-executor-state.ts";
import { buildReviewBotHandles, buildReviewExecutionContext } from "./review-execution-context.ts";
import { resolveReviewHandlerCandidatePublicationBridge } from "./review-candidate-publication-bridge.ts";
import {
  buildReviewCandidatePublicationPreparationAdapters,
  resolveReviewCandidatePublicationPreparation,
} from "./review-candidate-publication-preparation.ts";
import { resolveReviewCandidatePublicationRuntimeContext } from "./review-candidate-publication-runtime-context.ts";
import { resolveReviewFindingPublicationContext } from "./review-finding-publication-context.ts";
import { resolveReviewFindingLifecycleContext } from "./review-finding-lifecycle-context.ts";
import { logReviewCandidatePublicationAdapterContext } from "./review-candidate-publication-adapter-context.ts";
import { resolveReviewDetailsRuntimeContext } from "./review-details-runtime-context.ts";
import { resolveReviewExecutionOutcomeContext } from "./review-execution-outcome.ts";
import { handleReviewHandlerFailureRecovery } from "./review-handler-failure-recovery.ts";
import { finalizeReviewPhaseSummary } from "./review-phase-summary-finalization.ts";
import { publishDegradedReviewDetailsFallbackFailOpen } from "./review-details-degraded-fallback.ts";
import { publishFirstPassReviewDetails } from "./review-details-first-pass-publication.ts";
import {
  buildReviewFallbackPublicationAdapters,
  publishAndApplyReviewFallbackOutputs,
  type ReviewFallbackExecutionErrorContext,
} from "./review-fallback-publication-orchestration.ts";
import {
  buildReviewTimeoutProgressAdapters,
  resolveReviewTimeoutProgressContext,
} from "./review-timeout-progress-context.ts";
import { resolveReviewTimeoutRetryContext } from "./review-timeout-retry-context.ts";
import { buildReviewRetryOutcomeCheckpointLookup } from "./review-timeout-retry-adapters.ts";
import {
  normalizeReviewTimeoutBudgetDetails,
  resolveReviewTimeoutPublicationContext,
} from "./review-timeout-publication-context.ts";
import {
  buildReviewTimeoutExecutionAdapters,
  resolveReviewTimeoutExecutionContext,
} from "./review-timeout-execution-context.ts";
import { resolveReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";
import { resolveReviewTimeoutContinuationState } from "./review-timeout-continuation-state.ts";
import { createReviewHandlerRuntime, type ReviewPromptDerivedCacheOptions } from "./review-handler-runtime.ts";
import { cleanupReviewExecutionResources } from "./review-execution-cleanup.ts";
import { prepareReviewWorkspace } from "./review-workspace-preparation.ts";
import { createReviewWorkspacePhaseHooks } from "./review-workspace-phase-hooks.ts";
import {
  resolveReviewEventRuntime,
  type ReviewWebhookPayload,
} from "./review-event-runtime.ts";
import { createReviewJobRuntime } from "./review-job-runtime.ts";
import {
  buildReviewJobQueueContext,
} from "./review-job-context.ts";
import {
  buildReviewDeltaPriorFindingLookup,
  resolveReviewDeltaClassification,
} from "./review-delta-classification.ts";
import { logPublishedReviewOutputEvidence } from "./review-published-output-evidence.ts";
import { logReviewTimeoutZeroEvidenceWarning } from "./review-timeout-zero-evidence-log.ts";
import { logReviewEnqueueCompleted } from "./review-enqueue-completion-log.ts";
import { resolveReviewChangedFileContext } from "./review-changed-file-context.ts";
import { resolveReviewPlanningContext } from "./review-planning-context.ts";
import { prepareInitialReviewPrompt } from "./review-initial-prompt-preparation.ts";
import { resolveReviewTimeoutClassificationContext } from "./review-timeout-classification-context.ts";
import { publishBoundedFirstPassTimeoutOutput } from "./review-bounded-first-pass-timeout-publication.ts";
import {
  buildReviewTimeoutRetrySettlementAdapters,
  scheduleReviewTimeoutRetryContinuation,
} from "./review-timeout-retry-scheduling.ts";
import { removeFilteredInlineCommentsForSuccessfulReview } from "./review-filtered-inline-cleanup.ts";
import { buildReviewDetailsAttemptLogFields } from "./review-details-attempt-log-fields.ts";


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

      const reviewBotHandles = buildReviewBotHandles(githubApp.getAppSlug());
      let workspace: Workspace | undefined;
      try {
        const workspacePhaseHooks = createReviewWorkspacePhaseHooks({
          setReviewWorkPhase,
        });
        timingState.workspacePhaseStartedAt = workspacePhaseHooks.workspacePhaseStartedAt;
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
          onBeforeFinalizeConfig: workspacePhaseHooks.onBeforeFinalizeConfig,
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

        const reviewRequestedEyesReactionAdapters = buildReviewRequestedEyesReactionAdapters({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
        });
        await maybePostReviewRequestedEyesReaction({
          action,
          getOctokit: reviewRequestedEyesReactionAdapters.getOctokit,
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
          botHandles: reviewBotHandles,
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

        const changedFileContext = await resolveReviewChangedFileContext({
          changedFiles,
          reviewFiles,
          numstatLines,
          diffContent,
          config,
          reviewGraphQuery,
          structuralImpactCache,
          owner: apiOwner,
          repo: apiRepo,
          workspaceKey: pr.head.sha,
          baseSha: pr.base.sha,
          headSha: pr.head.sha,
          canonicalRef: pr.base.ref,
          incrementalResult,
          knowledgeStore,
          prNumber: pr.number,
          baseLog,
          logger,
        });
        const {
          diffAnalysis,
          riskScores,
          perFileStats,
          graphBlastRadius,
          graphQueryBypassedForTrivialChange,
          structuralImpactForReview,
          matchedPathInstructions,
          priorFindings,
          priorFindingCtx,
          repoDoctrineProjection,
          repoDoctrineReviewSurface,
        } = changedFileContext;
        let {
          tieredFiles,
          promptFiles,
        } = changedFileContext;

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

        const planningContext = resolveReviewPlanningContext({
          parsedIntent: {
            profileOverride: parsedIntent.profileOverride,
            styleOk: parsedIntent.styleOk,
            focusAreas: parsedIntent.focusAreas,
          },
          reviewConfig: config,
          prLinesChanged: (pr.additions ?? 0) + (pr.deletions ?? 0),
          changedFiles,
          diffAnalysis,
          tieredFiles,
          promptFiles,
          reviewPlanBuilder,
          retrievalContextAvailable: Boolean(retrievalCtx),
          matchedPathInstructionCount: matchedPathInstructions.length,
          repoDoctrineProjection,
          repoDoctrineReviewSurface,
          graphQueryAvailable: Boolean(reviewGraphQuery),
          graphQueryBypassedForTrivialChange,
          graphBlastRadius,
          diffCollectionStrategy: diffContext.strategy,
          mergeBaseRecovered: diffContext.mergeBaseRecovered,
          diffCollectionAttempts: diffContext.deepenAttempts,
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
          reviewPlan,
          reviewPlanDetailsSummary,
          reviewPlanConfigSnapshot,
        } = planningContext;
        tieredFiles = planningContext.tieredFiles;
        promptFiles = planningContext.promptFiles;

        const {
          prLabels,
          clusterPatternsForPrompt,
          linkedIssueResult,
          reviewPromptDerivedCacheStatus,
          reviewPromptDerivedCacheReason,
          reviewPrompt,
          reviewPromptSections,
        } = await prepareInitialReviewPrompt({
          owner: apiOwner,
          repo: apiRepo,
          pr,
          eventId: event.id,
          config,
          promptFiles,
          commitMessages: commitMessagesForLinking,
          diffAnalysis,
          diffContent,
          matchedPathInstructions,
          incrementalResult,
          priorFindingContext: priorFindingCtx,
          retrievalContext: retrievalCtx,
          reviewPrecedents: reviewPrecedentsForPrompt,
          wikiKnowledge: wikiKnowledgeForPrompt,
          unifiedResults: unifiedResultsForPrompt,
          contextWindow: contextWindowForPrompt,
          parsedIntent,
          priorFindings,
          tieredFiles,
          authorClassification,
          depBumpContext,
          isDraft,
          graphBlastRadius,
          structuralImpact: structuralImpactForReview,
          reviewBoundedness,
          repoDoctrineProjection,
          taskType: reviewRouting.taskType,
          checkpointEnabled,
          resolvedSeverityMinLevel,
          resolvedFocusAreas,
          resolvedIgnoredAreas,
          resolvedMaxComments,
          clusterMatcher,
          issueStore,
          embeddingProvider,
          promptBuilder: reviewPromptBuilder,
          promptCache: reviewPromptDerivedCache,
          getPromptCacheErrorCount: getReviewPromptDerivedCacheErrorCount,
          buildPromptFingerprint: buildReviewPromptFingerprint,
          visibleBudgetState,
          telemetryStore,
          reviewPhaseTimings,
          retrievalPhaseStartedAt: timingState.retrievalPhaseStartedAt,
          setReviewWorkPhase,
          logger,
          baseLog,
        });

        // Execute review via Claude
        setReviewWorkPhase("executor-dispatch");
        const result = await executor.execute(buildReviewExecutionContext({
          workspace,
          installationId: event.installationId,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          appSlug: githubApp.getAppSlug(),
          action: payload.action,
          taskType: reviewRouting.taskType,
          reviewPrompt,
          reviewPromptSections,
          reviewOutputKey,
          deliveryId: event.id,
          candidateVerificationContext,
          knowledgeStore,
          changedFileCount: changedFiles.length,
          checkpointEnabled,
          prDiffCommentabilityIndex,
          appliedTimeoutBudget,
          reviewMaxTurnsOverride,
        }));
        const executorState = projectReviewExecutorState({
          result,
          currentPromptSectionRecords: visibleBudgetState.promptSectionRecords,
        });
        applyReviewExecutorState({
          projection: executorState,
          publicationState,
          visibleBudgetState,
          timingState,
          reviewPhaseTimings,
          recordExecutorPhaseTimings: recordReviewExecutorPhaseTimings,
        });

        let reviewCandidateVerificationPublicationEvidence = result.candidateVerificationPublicationEvidence;

        const handlerCandidatePublicationBridge = resolveReviewHandlerCandidatePublicationBridge({
          logger,
          baseLog,
          evidenceSummary: result.candidateVerificationPublicationEvidence,
          deliveryId: String(event.id),
          reviewOutputKey,
          upstreamCorrelationKey: String(candidateVerificationContext.correlationKey),
        });

        const reviewOutputSucceeded = result.conclusion === "success";
        const candidatePublicationPreparationAdapters = buildReviewCandidatePublicationPreparationAdapters({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
          appSlug: githubApp.getAppSlug(),
        });
        const {
          extractionOctokit,
          reviewCandidateFindingResult,
          reviewCandidateFindingDetailsSummary,
          reviewCandidateFindingConfigSnapshot,
          extractedFindings,
          feedbackSuppression,
          reducerResult,
          directFallbackAllowed,
          directPublicationAttempted,
          reviewCandidateApprovalResult,
          reviewCandidatePublicationAdapter,
          candidatePublisherResults,
          reviewCandidateVerificationPublicationEvidence: preparedCandidateVerificationPublicationEvidence,
        } = await resolveReviewCandidatePublicationPreparation({
          getOctokit: candidatePublicationPreparationAdapters.getOctokit,
          candidateFinding: result.candidateFinding,
          reviewOutputSucceeded,
          resultPublished: result.published === true,
          initialCandidateVerificationPublicationEvidence: reviewCandidateVerificationPublicationEvidence,
          logger,
          baseLog,
          owner: apiOwner,
          repo: apiRepo,
          pr,
          deliveryId: event.id,
          reviewOutputKey,
          knowledgeStore,
          config,
          workspaceDir: workspace.dir,
          diffAnalysis,
          diffContent: diffContext.diffContent,
          commitMessages: commitMessagesForLinking,
          tieredFiles,
          graphBlastRadius,
          riskScores,
          resolvedMaxComments,
          priorFindingContext: priorFindingCtx,
          clusterModelStore,
          embeddingProvider,
          guardrailAuditStore,
          repoDoctrineReviewSurface,
          reviewReducer,
          canPublishVisibleOutput,
          appSlug: candidatePublicationPreparationAdapters.appSlug,
          candidateVerificationContext,
          prDiffCommentabilityIndex,
        });
        reviewCandidateVerificationPublicationEvidence = preparedCandidateVerificationPublicationEvidence;

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

        const deltaClassification: DeltaClassification | null = await resolveReviewDeltaClassification({
          enabled: incrementalResult?.mode === "incremental" && priorFindingCtx !== null,
          currentFindings: processedFindings,
          getPriorReviewFindings: buildReviewDeltaPriorFindingLookup({
            knowledgeStore,
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
          }),
          logger,
          baseLog,
        });

        await removeFilteredInlineCommentsForSuccessfulReview({
          reviewOutputSucceeded,
          filteredInlineFindings,
          octokit: extractionOctokit,
          owner: apiOwner,
          repo: apiRepo,
          logger,
          baseLog,
        });

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
        const reviewDetailsBodyBase = buildReviewDetailsBodyBase({
          reviewOutputKey,
          filesReviewed: diffAnalysis?.metrics.totalFiles ?? changedFiles.length,
          linesAdded: reviewDetailsLineCounts.linesAdded,
          linesRemoved: reviewDetailsLineCounts.linesRemoved,
          findingCounts,
          tieredFiles,
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
          phaseTimings: reviewPhaseTimings,
          publicationPhaseStartedAt: timingState.publicationPhaseStartedAt,
          totalPhaseStartAt: timingState.totalPhaseStartAt,
          lineCountSource: reviewDetailsLineCounts.source,
        });
        const {
          renderReviewDetailsBody,
          finalizePublicationPhaseTiming,
          logReviewDetailsPublicationCompleted,
          logCanonicalReviewDetailsPublicationCompleted,
        } = createReviewDetailsPublicationRuntime({
          ...buildReviewDetailsPublicationRuntimeAdapters({
            visibleBudgetProjection: visibleBudgetState,
            publicationPhaseTiming: {
              getStartedAt: () => timingState.publicationPhaseStartedAt,
            },
          }),
          logger,
          baseLog,
          reviewOutputKey,
          deliveryId: event.id,
          doctrineFields: buildRepoDoctrineLogFields(repoDoctrineProjection),
          reviewDetailsBodyBase,
          hasOperationalSignal: hasReviewDetailsOperationalSignal,
          filteredFindings: filterResult.filtered,
          reviewPhaseTimings,
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
          botHandles: reviewBotHandles,
          acceptedCanonicalSurface,
          authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
          reviewBoundedness,
          baseLog,
          attemptLogFields: buildReviewDetailsAttemptLogFields({
            deltaCounts: deltaClassification?.counts ?? null,
            retrievalFindingCount: retrievalCtx?.findings.length ?? null,
          }),
          logger,
          canPublishVisibleOutput,
          setReviewWorkPhase,
          renderReviewDetailsBody,
          finalizePublicationPhaseTiming,
          logReviewDetailsPublicationCompleted,
          logCanonicalReviewDetailsPublicationCompleted,
        });
        canonicalReviewDetailsBody = firstPassReviewDetailsPublication.canonicalReviewDetailsBody;

        const postExecutionTelemetryPublicationContext = buildReviewPostExecutionTelemetryPublicationContext({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
          appSlug: githubApp.getAppSlug(),
        });
        await recordReviewPostExecutionTelemetry({
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          logger,
          deliveryId: event.id,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          prAuthor: pr.user.login,
          eventType: `pull_request.${payload.action}`,
          result,
          promptSections: reviewPromptSections,
          derivedPromptCacheStatus: reviewPromptDerivedCacheStatus,
          derivedPromptCacheReason: reviewPromptDerivedCacheReason ?? undefined,
          costWarningUsd: config.telemetry.costWarningUsd,
          canPublishVisibleOutput,
          setReviewWorkPhase,
          getOctokit: postExecutionTelemetryPublicationContext.getOctokit,
          botHandles: postExecutionTelemetryPublicationContext.botHandles,
        });

        const reviewId = await persistReviewKnowledgeIfAvailable({
          knowledgeStore,
          logger,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          reviewOutputKey,
          record: {
            repo: `${apiOwner}/${apiRepo}`,
            prNumber: pr.number,
            headSha: pr.head.sha,
            deliveryId: event.id,
            filesAnalyzed: diffAnalysis?.metrics.totalFiles ?? 0,
            linesChanged,
            findingCounts,
            findingsTotal: processedFindings.length,
            suppressionsApplied,
            reviewConfig: {
              mode: config.review.mode,
              severityMinLevel: config.review.severity.minLevel,
              focusAreas: config.review.focusAreas,
              maxComments: config.review.maxComments,
              suppressionCount: config.review.suppressions.length,
              minConfidence: config.review.minConfidence,
              profile: config.review.profile,
            },
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

        await recordReviewPostExecutionSideEffects({
          knowledgeStore,
          repo: `${apiOwner}/${apiRepo}`,
          owner: apiOwner,
          prNumber: pr.number,
          prAuthor: pr.user.login,
          prTitle: pr.title,
          baseSha: pr.base.sha,
          headSha: pr.head.sha,
          filesChanged: reviewFiles,
          changedFilesForLanguageContext: changedFiles,
          findings: processedFindings,
          reviewId,
          diffContent: diffContext.diffContent,
          hunkEmbeddingConfig: config.knowledge.retrieval.hunkEmbedding,
          contributorProfileStore,
          learningMemoryStore,
          codeSnippetStore,
          embeddingProvider,
          logger,
          logContext: baseLog,
        });

        logPublishedReviewOutputEvidence({
          result,
          logger,
          deliveryId: event.id,
          installationId: event.installationId,
          owner: apiOwner,
          repoName: apiRepo,
          repo: `${apiOwner}/${apiRepo}`,
          prNumber: pr.number,
          reviewOutputKey,
        });

        const executionOutcome = resolveReviewExecutionOutcomeContext({
          result,
          totalTimeoutSeconds: appliedTimeoutBudget?.totalTimeoutSeconds,
          defaultTimeoutSeconds: config.timeoutSeconds,
          timeoutComplexityReasoning: timeoutEstimate?.reasoning,
        });
        const turnBudgetExhausted = executionOutcome.exhaustedTurnBudget;
        let publishedPartialReview = false;
        let fallbackRetryState: string | undefined;
        let deferredPublicOutputForContinuation = false;
        let executionErrorContext: ReviewFallbackExecutionErrorContext | undefined;

        // Post error or partial-review comment if execution failed, timed out, or exhausted review turns.
        if (executionOutcome.shouldHandleErrorOrTurnLimit) {
          const { category, timeoutDuration, complexityInfo } = executionOutcome;
          executionErrorContext = { category, timeoutDuration, complexityInfo };
          let partialCommentId: number | undefined;

          if (result.isTimeout || turnBudgetExhausted) {
            const timeoutProgressAdapters = buildReviewTimeoutProgressAdapters({
              knowledgeStore,
              extractFindingsFromReviewComments,
              extraction: {
                octokit: extractionOctokit,
                owner: apiOwner,
                repo: apiRepo,
                prNumber: pr.number,
                reviewOutputKey,
                logger,
                baseLog,
              },
            });
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
              getCheckpoint: timeoutProgressAdapters.getCheckpoint,
              extractInlineFindings: timeoutProgressAdapters.extractInlineFindings,
            });

            const {
              recentTimeouts,
              isChronicTimeout,
              executionConclusion,
            } = await resolveReviewTimeoutExecutionContext({
              repo: `${apiOwner}/${apiRepo}`,
              prAuthor: pr.user.login,
              outcome: {
                isTimeout: result.isTimeout,
                published: result.published,
                conclusion: result.conclusion,
              },
              turnBudgetExhausted,
              countRecentTimeouts: buildReviewTimeoutExecutionAdapters({
                telemetryStore,
              }).countRecentTimeouts,
            });

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

            const timeoutClassificationTelemetry = resolveReviewTimeoutClassificationContext({
              logger,
              baseLog,
              deliveryId: event.id,
              reviewOutputKey,
              prNumber: pr.number,
              outcome: {
                isTimeout: result.isTimeout,
                stopReason: result.stopReason,
                failureSubtype: result.failureSubtype,
              },
              timeoutFirstPass: timeoutFirstPass
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
              retryPlan,
              chronicTimeout: isChronicTimeout,
              recentTimeouts,
              durationMs: result.durationMs,
              timeoutDurationSeconds: timeoutDuration,
            });
            const timeoutBudgetDetails = normalizeReviewTimeoutBudgetDetails(appliedTimeoutBudget);

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
              timeoutBudget: timeoutBudgetDetails,
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
            const boundedFirstPassPublication = await publishBoundedFirstPassTimeoutOutput({
              timeoutFirstPass,
              deferredPublicOutputForContinuation,
              partialBody,
              octokit,
              owner: apiOwner,
              repo: apiRepo,
              prNumber: pr.number,
              reviewOutputKey,
              botHandles: reviewBotHandles,
              canPublishVisibleOutput,
              setReviewWorkPhase,
              logger,
              deliveryId: event.id,
              knowledgeStore,
              filesReviewed: timeoutReviewedFiles,
              filesInspected: timeoutInspectedFiles,
              findingCount: timeoutFindingCount,
              summaryDraft,
              totalFiles: timeoutTotalFiles,
              hasPartialResults,
              chronicTimeout: isChronicTimeout,
              recentTimeouts,
              retryState,
              timeoutReviewDetails,
              timeoutBudget: timeoutBudgetDetails,
              authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
              reviewBoundedness,
              baseLog,
              renderReviewDetailsBody,
              telemetryEnabled: config.telemetry.enabled,
              telemetryStore,
              prAuthor: pr.user.login,
              eventType: `pull_request.${payload.action}`,
              executionConclusion,
              hadInlineOutput: hasPublishedInlines,
              timeoutClassificationTelemetry,
            });
            partialCommentId = boundedFirstPassPublication.partialCommentId;
            publishedPartialReview = boundedFirstPassPublication.publishedPartialReview;
            if (boundedFirstPassPublication.continuationProjectionDegraded) {
              continuationProjectionDegraded = true;
            }

            const retryEnqueueContext = resolveReviewRetryEnqueueContext({
              deliveryId: event.id,
              retryPlan,
            });
            const retryOutcomeCheckpointLookup = buildReviewRetryOutcomeCheckpointLookup({
              knowledgeStore,
            });
            const timeoutContinuationState = resolveReviewTimeoutContinuationState({
              attemptId: reviewWorkAttempt.attemptId,
              timeoutFirstPass,
              retryScheduled: retryEnqueueContext !== null,
              continuationProjectionDegraded,
            });

            if (timeoutContinuationState.zeroEvidenceWarning) {
              logReviewTimeoutZeroEvidenceWarning({
                logger,
                deliveryId: event.id,
                prNumber: pr.number,
                reviewOutputKey,
                zeroEvidenceWarning: timeoutContinuationState.zeroEvidenceWarning,
              });
            }

            if (timeoutContinuationState.blockedFamilyState) {
              await persistContinuationFamilyState(timeoutContinuationState.blockedFamilyState);
            }

            // Step 4: Enqueue retry if eligible (not chronic, exactly 1 retry)
            // Retry is only useful when no GitHub-visible output was published.
            // If inline comments were already posted, avoid a retry that could
            // create additional noise or duplicates.
            if (retryEnqueueContext) {
              const retryScheduling = await scheduleReviewTimeoutRetryContinuation({
                retryEnqueueContext,
                reviewFamilyKey,
                reviewWorkCoordinator,
                preEnqueue: {
                  telemetryEnabled: config.telemetry.enabled,
                  telemetryStore,
                  logger,
                  deliveryId: event.id,
                  repo: `${apiOwner}/${apiRepo}`,
                  prNumber: pr.number,
                  prAuthor: pr.user.login,
                  eventType: `pull_request.${payload.action}`,
                  reviewOutputKey,
                  executionConclusion,
                  hadInlineOutput: hasPublishedInlines,
                  checkpointFilesReviewed: timeoutReviewedFiles,
                  checkpointFilesInspected: timeoutInspectedFiles,
                  checkpointFindingCount: timeoutFindingCount,
                  checkpointSummaryDraft: summaryDraft,
                  checkpointTotalFiles: timeoutTotalFiles,
                  partialCommentId,
                  recentTimeouts,
                  chronicTimeout: isChronicTimeout,
                  timeoutClassificationTelemetry,
                  timeoutFirstPass,
                  knowledgeStore,
                  persistContinuationFamilyState,
                },
                enqueue: {
                  jobQueue,
                  installationId: event.installationId,
                  parentDeliveryId: event.id,
                  eventName: event.name,
                  reviewFamilyKey,
                  prNumber: pr.number,
                  reviewOutputKey,
                  knowledgeStore,
                  logger,
                  finalizeContinuationAttempt,
                },
                buildRetryJobParams: (retryAttemptId) => {
                  const retrySettlementAdapters = buildReviewTimeoutRetrySettlementAdapters({
                    retryAttemptId,
                    installationId: event.installationId,
                    getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
                    appSlug: githubApp.getAppSlug(),
                    setReviewWorkPhaseForAttempt,
                  });
                  return {
                    workspaceManager,
                    installationId: event.installationId,
                    cloneOwner,
                    cloneRepo,
                    cloneRef,
                    depth: REVIEW_WORKSPACE_FETCH_DEPTH,
                    usesPrRef,
                    prNumber: pr.number,
                    baseRef: pr.base.ref,
                    fallbackHeadRepoFullName: pr.head.repo?.full_name ?? null,
                    fallbackHeadRef: pr.head.ref,
                    fetchRemoteTrackingBranchFn,
                    retryAttemptId,
                    retryEnqueueContext,
                    preparePrompt: {
                      owner: apiOwner,
                      repo: apiRepo,
                      pr,
                      config,
                      taskType: reviewRouting.taskType,
                      resolvedSeverityMinLevel,
                      resolvedFocusAreas,
                      resolvedIgnoredAreas,
                      resolvedMaxComments,
                      diffAnalysis,
                      diffContent: diffContext.diffContent,
                      matchedPathInstructions,
                      incrementalResult,
                      priorFindingContext: priorFindingCtx,
                      retrievalContext: retrievalCtx,
                      reviewPrecedents: reviewPrecedentsForPrompt,
                      wikiKnowledge: wikiKnowledgeForPrompt,
                      unifiedResults: unifiedResultsForPrompt,
                      contextWindow: contextWindowForPrompt,
                      prLabels,
                      focusHints: parsedIntent.unrecognized,
                      conventionalType: parsedIntent.conventionalType,
                      priorFindings,
                      authorClassification,
                      depBumpContext,
                      isDraft,
                      clusterPatterns: clusterPatternsForPrompt,
                      linkedIssues: linkedIssueResult,
                      structuralImpact: structuralImpactForReview,
                      repoDoctrineProjection,
                      checkpoint,
                      isTimeout: result.isTimeout === true,
                      visibleBudgetState,
                      promptBuilder: reviewPromptBuilder,
                      promptCache: reviewPromptDerivedCache,
                      getPromptCacheErrorCount: getReviewPromptDerivedCacheErrorCount,
                      buildPromptFingerprint: buildReviewPromptFingerprint,
                      telemetryStore,
                      setReviewWorkPhaseForAttempt,
                      logger,
                      baseLog,
                    },
                    executor,
                    execution: {
                      owner: apiOwner,
                      repo: apiRepo,
                      appSlug: githubApp.getAppSlug(),
                      taskType: reviewRouting.taskType,
                      reviewMaxTurnsOverride,
                      knowledgeStore,
                      timeoutTotalFiles,
                      prDiffCommentabilityIndex,
                    },
                    outcome: {
                      telemetryEnabled: config.telemetry.enabled,
                      telemetryStore,
                      logger,
                      parentDeliveryId: event.id,
                      repo: `${apiOwner}/${apiRepo}`,
                      prNumber: pr.number,
                      prAuthor: pr.user.login,
                      partialCommentId,
                      timeoutTotalFiles,
                      getCheckpoint: retryOutcomeCheckpointLookup,
                    },
                    settlement: {
                      getOctokit: retrySettlementAdapters.getOctokit,
                      getAppSlug: retrySettlementAdapters.getAppSlug,
                      owner: apiOwner,
                      repo: apiRepo,
                      prNumber: pr.number,
                      reviewOutputKey,
                      firstPassOutcome: result,
                      baseCheckpoint: checkpoint,
                      partialCommentId,
                      timeoutDurationSeconds: timeoutDuration,
                      timeoutFirstPassBoundedReason: timeoutFirstPass?.boundedReason,
                      knowledgeStore,
                      authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
                      reviewBoundedness,
                      baseLog,
                      logger,
                      canPublishReviewWorkOutput,
                      setPublishPhase: retrySettlementAdapters.setPublishPhase,
                      renderReviewDetailsBody,
                      settleRetryWithoutCanonicalUpdate,
                      persistContinuationFamilyState,
                    },
                    setReviewWorkPhaseForAttempt,
                  };
                },
              });
              if (retryScheduling.continuationProjectionDegraded) {
                continuationProjectionDegraded = true;
              }
            }
          }

        }

        const fallbackPublicationAdapters = buildReviewFallbackPublicationAdapters({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
          appSlug: githubApp.getAppSlug(),
          visibleBudgetProjection: visibleBudgetState,
        });
        await publishAndApplyReviewFallbackOutputs({
          publicationState,
          result: {
            conclusion: result.conclusion,
            published: result.published,
            errorMessage: result.errorMessage,
          },
          executionErrorContext,
          publishedPartialReview,
          deferredPublicOutputForContinuation,
          turnBudgetExhausted,
          fallbackRetryState,
          appliedTimeoutBudget,
          getOctokit: fallbackPublicationAdapters.getOctokit,
          getAppSlug: fallbackPublicationAdapters.getAppSlug,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          autoApprove: config.review.autoApprove,
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
          refreshVisibleBudgetProjection: fallbackPublicationAdapters.refreshVisibleBudgetProjection,
          renderReviewDetailsBody,
          finalizePublicationPhaseTiming,
          logReviewDetailsPublicationCompleted,
          logCanonicalReviewDetailsPublicationCompleted,
        });
      } catch (err) {
        timingState.publicationPhaseStartedAt = await handleReviewHandlerFailureRecovery({
          error: err,
          prNumber: pr.number,
          reviewPhaseTimings,
          workspacePhaseStartedAt: timingState.workspacePhaseStartedAt,
          retrievalPhaseStartedAt: timingState.retrievalPhaseStartedAt,
          publicationPhaseStartedAt: timingState.publicationPhaseStartedAt,
          logger,
          publishHandlerFailureError: buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies({
            installationId: event.installationId,
            getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
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
        recordReviewExecutorPhaseTimings(reviewPhaseTimings, timingState.executorPhaseTimings, { overwrite: false });

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

        await cleanupReviewExecutionResources({ workspace });
      }
    }, buildReviewJobQueueContext({
      deliveryId: event.id,
      eventName: event.name,
      action,
      reviewFamilyKey,
      prNumber: pr.number,
    }));
  } finally {
    reviewWorkRuntime.finalize();
  }

  logReviewEnqueueCompleted({ logger, baseLog });
}

// Register for review trigger events
eventRouter.register("pull_request.opened", handleReview);
eventRouter.register("pull_request.ready_for_review", handleReview);
eventRouter.register("pull_request.review_requested", handleReview);
eventRouter.register("pull_request.synchronize", handleReview);
}
