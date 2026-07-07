import type { WebhookEvent } from "../webhook/types.ts";
import type { Workspace } from "../jobs/types.ts";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { DeltaClassification } from "../lib/delta-classifier.ts";
import { formatErrorComment } from "../lib/errors.ts";
import {
  formatTimeoutErrorDetail,
  recordReviewExecutorPhaseTimings,
} from "../review-orchestration/review-phase-timing.ts";
export { formatTimeoutErrorDetail } from "../review-orchestration/review-phase-timing.ts";
import {
  type CanonicalReviewSurface,
  type CanonicalSurfaceKind,
  upsertCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import {
  type ExtractedFinding,
} from "../review-orchestration/review-comment-finding-extraction.ts";
export { resolveAuthorTierFromSources } from "../review-orchestration/review-author-tier.ts";
import {
  buildReviewPromptFingerprint,
} from "../review-orchestration/review-prompt-fingerprint.ts";
export { buildReviewPromptFingerprint, type ReviewPromptBuildContext, type ReviewPromptFingerprintResult } from "../review-orchestration/review-prompt-fingerprint.ts";
import {
  REVIEW_WORKSPACE_FETCH_DEPTH,
} from "../review-orchestration/review-diff-collection.ts";
export { collectDiffContext, REVIEW_WORKSPACE_FETCH_DEPTH } from "../review-orchestration/review-diff-collection.ts";
import {
  buildRepoDoctrineLogFields,
} from "../review-orchestration/review-plan-doctrine-log.ts";
import {
  toProductionLogBudgetReasoning,
} from "../review-audit/production-log-projection.ts";
import { analyzePackageUsage } from "../lib/usage-analyzer.ts";
import { detectScopeCoordination } from "../lib/scope-coordinator.ts";
import { type ShadowSpecialistReviewDetailsProjection } from "../specialists/shadow-specialist-review-details.ts";
import {
  buildReviewDetailsPublicationRuntimeAdapters,
  createReviewDetailsPublicationRuntime,
} from "./review-details-publication-runtime.ts";
import { resolveReviewDetailsBodyBase } from "./review-details-body-base.ts";
import { buildReviewHandlerFailurePublicationAdapterFromHandlerDependencies } from "./review-handler-failure-publication-adapter.ts";
import { resolveReviewIdempotencyContext } from "./review-idempotency-context.ts";
import { resolveReviewRetrievalPromptContext } from "./review-retrieval-context.ts";
import { resolveReviewDependencyBumpFlowContext } from "./review-dependency-bump-flow.ts";
import { recordReviewPostExecutionKnowledge } from "./review-post-execution-knowledge.ts";
import { recordReviewPostExecutionTelemetryForInstallation } from "./review-post-execution-telemetry-context.ts";
import {
  publishReviewRequestedEyesReactionFromHandlerDependencies,
} from "./review-reactions.ts";
import { resolveReviewPrIntent } from "./review-pr-intent.ts";
import { resolveReviewAuthorContext } from "./review-author-context.ts";
import { evaluateReviewTriggerConfigGate } from "./review-trigger-config-gate.ts";
import { evaluateReviewRunStateGate } from "./review-run-state-gate.ts";
import { evaluateReviewSkipAuthorGate } from "./review-skip-author-gate.ts";
import {
  resolveReviewIncrementalDiff,
} from "./review-incremental-diff.ts";
import { resolveReviewFileSelectionContext } from "./review-file-selection-context.ts";
import { resolveReviewDiffContext } from "./review-diff-context.ts";
import { dispatchInitialReviewExecution } from "./review-execution-dispatch.ts";
import { buildReviewBotHandles } from "./review-execution-context.ts";
import { resolveReviewHandlerCandidatePublicationBridge } from "./review-candidate-publication-bridge.ts";
import {
  buildReviewCandidatePublicationPreparationAdapters,
  resolveReviewCandidatePublicationPreparation,
} from "./review-candidate-publication-preparation.ts";
import { resolveReviewPublicationContext } from "./review-publication-context.ts";
import { resolveReviewFindingLifecycleContext } from "./review-finding-lifecycle-context.ts";
import { logReviewCandidatePublicationAdapterContext } from "./review-candidate-publication-adapter-context.ts";
import { resolveReviewDetailsRuntimeContext } from "./review-details-runtime-context.ts";
import { resolveReviewExecutionOutcomeContext } from "./review-execution-outcome.ts";
import { handleReviewHandlerFailureRecovery } from "./review-handler-failure-recovery.ts";
import { finalizeReviewPhaseSummary } from "./review-phase-summary-finalization.ts";
import { publishDegradedReviewDetailsFallbackFailOpen } from "./review-details-degraded-fallback.ts";
import { publishFirstPassReviewDetails, resolveFirstPassReviewDetailsPublicationBody } from "./review-details-first-pass-publication.ts";
import {
  buildReviewFallbackPublicationAdapters,
  buildReviewFallbackPublicationParams,
  publishAndApplyReviewFallbackOutputs,
  type ReviewFallbackExecutionErrorContext,
} from "./review-fallback-publication-orchestration.ts";
import { handleReviewTimeoutContinuationOutcome } from "./review-timeout-continuation-orchestration.ts";
import { createReviewHandlerRuntime } from "./review-handler-runtime.ts";
import { resolveReviewHandlerDependencies, type ReviewHandlerDependencies } from "./review-handler-dependencies.ts";
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
import { logReviewEnqueueCompleted } from "./review-enqueue-completion-log.ts";
import { resolveReviewChangedFileContext } from "./review-changed-file-context.ts";
import { resolveReviewPlanningContext } from "./review-planning-context.ts";
import { prepareInitialReviewPrompt } from "./review-initial-prompt-preparation.ts";
import { removeFilteredInlineCommentsForSuccessfulReview } from "./review-filtered-inline-cleanup.ts";
import { buildReviewDetailsAttemptLogFields } from "./review-details-attempt-log-fields.ts";
import { registerReviewHandlerEvents } from "./review-event-registration.ts";

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
export function createReviewHandler(deps: ReviewHandlerDependencies): void {
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
    reviewPromptBuilder,
    codeSnippetStore,
    contributorProfileStore,
    slackBotToken,
    clusterMatcher,
    issueStore,
    reviewGraphQuery,
    sql,
    reviewWorkCoordinator: injectedReviewWorkCoordinator,
    clusterModelStore,
    fetchRemoteTrackingBranchFn,
    diffContextCollector,
    shadowSpecialistSubflow,
    reviewPlanBuilder,
    reviewReducer,
    logger,
  } = resolveReviewHandlerDependencies(deps);

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

        const reviewIdempotencyContext = await resolveReviewIdempotencyContext({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
          baseLog,
          logger,
        });
        const idempotencyGate = reviewIdempotencyContext.idempotencyGate;
        if (idempotencyGate.action === "skip") return;
        const idempotencyOctokit = reviewIdempotencyContext.octokit;
        const acceptedCanonicalSurface: CanonicalReviewSurface | null =
          reviewIdempotencyContext.acceptedCanonicalSurface;

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

        await publishReviewRequestedEyesReactionFromHandlerDependencies({
          action,
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
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

        const dependencyBumpFlow = await resolveReviewDependencyBumpFlowContext({
          prTitle: pr.title,
          prBody: pr.body ?? null,
          prLabels: (pr.labels as Array<{ name: string }> | undefined)?.map((l) => l.name) ?? [],
          headBranch: pr.head.ref,
          senderLogin: pr.user.login,
          changedFiles: allChangedFiles,
          workspaceDir: workspace.dir,
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          logger,
          baseLog,
          botHandles: reviewBotHandles,
          canPublishVisibleOutput,
          setReviewWorkPhase,
          retriever,
          usageAnalyzer: usageAnalyzer?.analyzePackageUsage,
          detectScopeCoordination: scopeCoordinator?.detectScopeCoordination,
        });
        if (dependencyBumpFlow.action === "skip-standard-review") return;
        const depBumpContext = dependencyBumpFlow.depBumpContext;

        const fileSelectionContext = await resolveReviewFileSelectionContext({
          prNumber: pr.number,
          allChangedFiles,
          skipPaths: config.review.skipPaths,
          diffContentForValidation,
          diffContext,
          workspaceDir: workspace.dir,
          deliveryId: event.id,
          reviewOutputKey,
          incrementalResult,
          baseLog,
          logger,
          shadowSpecialistSubflow,
        });
        if (fileSelectionContext.action === "skip") return;
        const {
          changedFiles,
          shadowSpecialistResult,
          shadowSpecialistReviewDetailsProjection,
          candidateVerificationContext,
          reviewFiles,
          numstatLines,
          diffContent,
        } = fileSelectionContext;

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

        const {
          retrievalCtx,
          visibleBudgetState,
          reviewPrecedentsForPrompt,
          wikiKnowledgeForPrompt,
          unifiedResultsForPrompt,
          contextWindowForPrompt,
        } = await resolveReviewRetrievalPromptContext({
          retriever,
          apiOwner,
          apiRepo,
          pr,
          event,
          workspaceDir: workspace.dir,
          parsedIntent,
          diffAnalysis,
          reviewFiles,
          authorContract: authorClassification.contract,
          config,
          telemetryStore,
          logger,
          baseLog,
        });

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

        const { result } = await dispatchInitialReviewExecution({
          executor,
          executionContext: {
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
          },
          currentPromptSectionRecords: visibleBudgetState.promptSectionRecords,
          publicationState,
          visibleBudgetState,
          timingState,
          reviewPhaseTimings,
          recordExecutorPhaseTimings: recordReviewExecutorPhaseTimings,
          setReviewWorkPhase,
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

        const reviewPublicationContext = resolveReviewPublicationContext({
          approval: reviewCandidateApprovalResult,
          adapter: reviewCandidatePublicationAdapter,
          publisherResults: candidatePublisherResults,
          directPublication: {
            attempted: directPublicationAttempted,
            allowed: directFallbackAllowed,
            publishedFindingCount: extractedFindings.length,
            resultPublished: result.published === true,
          },
          reducer: reducerResult,
          logger,
          baseLog,
        });
        const {
          reviewCandidatePublicationRuntime,
          reviewCandidatePublicationFlow,
          processedFindings,
          visibleFindings,
          lowConfidenceFindings,
          filteredInlineFindings,
          suppressionMatchCounts,
          filterResult,
          prioritizationStats,
          reviewReducerDetailsSummary,
          reviewCandidatePublicationAdapterDetailsSummary,
        } = reviewPublicationContext;
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
        const reviewDetailsBodyBase = resolveReviewDetailsBodyBase({
          reviewOutputKey,
          diffMetrics: diffAnalysis?.metrics,
          changedFileCount: changedFiles.length,
          reviewDetailsLineCounts,
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
          tokenUsageSource: result,
          structuralImpact: structuralImpactForReview,
          reviewPlan: reviewPlanDetailsSummary,
          reviewReducer: reviewReducerDetailsSummary,
          reviewCandidateFinding: reviewCandidateFindingDetailsSummary,
          candidatePublicationDetails: reviewCandidatePublicationRuntime.detailsSummary,
          reviewFindingLifecycle: reviewFindingLifecycleResult.projection,
          reviewValidationTruth: reviewValidationTruthProjection,
          phaseTimings: reviewPhaseTimings,
          publicationPhaseStartedAt: timingState.publicationPhaseStartedAt,
          totalPhaseStartAt: timingState.totalPhaseStartAt,
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
        canonicalReviewDetailsBody = resolveFirstPassReviewDetailsPublicationBody(firstPassReviewDetailsPublication);

        await recordReviewPostExecutionTelemetryForInstallation({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
          appSlug: githubApp.getAppSlug(),
          telemetryEnabled: config.telemetry.enabled,
          telemetryStore,
          logger,
          deliveryId: event.id,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          prAuthor: pr.user.login,
          eventAction: payload.action,
          result,
          promptSections: reviewPromptSections,
          derivedPromptCacheStatus: reviewPromptDerivedCacheStatus,
          derivedPromptCacheReason: reviewPromptDerivedCacheReason ?? undefined,
          costWarningUsd: config.telemetry.costWarningUsd,
          canPublishVisibleOutput,
          setReviewWorkPhase,
        });

        await recordReviewPostExecutionKnowledge({
          knowledgeStore,
          logger,
          repo: `${apiOwner}/${apiRepo}`,
          owner: apiOwner,
          pr,
          deliveryId: event.id,
          filesAnalyzed: diffAnalysis?.metrics.totalFiles ?? 0,
          linesChanged,
          findingCounts,
          processedFindings,
          suppressionMatchCounts,
          visibleFindingCount: visibleFindings.length,
          lowConfidenceFindingCount: lowConfidenceFindings.length,
          suppressionsApplied,
          config,
          reviewPlanConfigSnapshot,
          reducerResult,
          reviewCandidateFindingConfigSnapshot,
          reviewCandidatePublicationRuntime,
          reviewCandidatePublicationFlow,
          result,
          contributorProfileStore,
          learningMemoryStore,
          codeSnippetStore,
          embeddingProvider,
          reviewFiles,
          changedFiles,
          diffContent: diffContext.diffContent,
          baseLog,
          reviewOutputKey,
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
          const timeoutContinuationOutcome = await handleReviewTimeoutContinuationOutcome({
            category,
            timeoutDuration,
            complexityInfo,
            result,
            turnBudgetExhausted,
            reviewOutputKey,
            changedFileCount: changedFiles.length,
            reviewBoundedness,
            knowledgeStore,
            extractionOctokit,
            owner: apiOwner,
            repo: apiRepo,
            pr,
            logger,
            baseLog,
            riskScores,
            reviewWorkAttempt,
            visibleBudgetState,
            perFileStats,
            languageComplexity,
            reviewRoutingTaskType: reviewRouting.taskType,
            appliedTimeoutBudget,
            event: { id: event.id, name: event.name, installationId: event.installationId },
            payloadAction: payload.action,
            recentTimeoutTelemetryStore: telemetryStore,
            telemetryEnabled: config.telemetry.enabled,
            telemetryStore,
            reviewBotHandles,
            canPublishVisibleOutput,
            setReviewWorkPhase,
            authorSearchEnrichmentDegraded: authorClassification.searchEnrichment.degraded,
            renderReviewDetailsBody,
            reviewFamilyKey,
            reviewWorkCoordinator,
            persistContinuationFamilyState,
            jobQueue,
            finalizeContinuationAttempt,
            workspaceManager,
            cloneOwner,
            cloneRepo,
            cloneRef,
            usesPrRef,
            fetchRemoteTrackingBranchFn,
            config,
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
            promptBuilder: reviewPromptBuilder,
            promptCache: reviewPromptDerivedCache,
            getPromptCacheErrorCount: getReviewPromptDerivedCacheErrorCount,
            setReviewWorkPhaseForAttempt,
            executor,
            appSlug: githubApp.getAppSlug(),
            reviewMaxTurnsOverride,
            prDiffCommentabilityIndex,
            getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
            settleRetryWithoutCanonicalUpdate,
            canPublishReviewWorkOutput,
          });
          executionErrorContext = timeoutContinuationOutcome.executionErrorContext;
          publishedPartialReview = timeoutContinuationOutcome.publishedPartialReview;
          fallbackRetryState = timeoutContinuationOutcome.fallbackRetryState;
          deferredPublicOutputForContinuation = timeoutContinuationOutcome.deferredPublicOutputForContinuation;
        }

        const fallbackPublicationAdapters = buildReviewFallbackPublicationAdapters({
          installationId: event.installationId,
          getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
          appSlug: githubApp.getAppSlug(),
          visibleBudgetProjection: visibleBudgetState,
        });
        await publishAndApplyReviewFallbackOutputs(buildReviewFallbackPublicationParams({
          publicationState,
          executionResult: result,
          executionErrorContext,
          publishedPartialReview,
          deferredPublicOutputForContinuation,
          turnBudgetExhausted,
          fallbackRetryState,
          appliedTimeoutBudget,
          adapters: fallbackPublicationAdapters,
          owner: apiOwner,
          repo: apiRepo,
          pr,
          reviewConfig: config.review,
          reviewOutputKey,
          deliveryId: event.id,
          installationId: event.installationId,
          promptFiles,
          canonicalReviewDetailsBody,
          authorClassification,
          reviewBoundedness,
          depBumpContext,
          logger,
          canPublishVisibleOutput,
          setReviewWorkPhase,
          renderReviewDetailsBody,
          finalizePublicationPhaseTiming,
          logReviewDetailsPublicationCompleted,
          logCanonicalReviewDetailsPublicationCompleted,
        }));
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

registerReviewHandlerEvents(eventRouter, handleReview);
}
