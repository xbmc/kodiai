import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { WorkspaceManager } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { PerFileStats } from "../execution/diff-analysis.ts";
import type { ReviewContinuationFamilyStateManager } from "../review-orchestration/review-continuation-family-state.ts";
import type { ReviewFallbackExecutionErrorContext } from "./review-fallback-publication-orchestration.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { buildPromptBudgetOutcomes } from "../review-orchestration/review-visible-budget-evidence.ts";
import { extractFindingsFromReviewComments } from "../review-orchestration/review-comment-finding-extraction.ts";
import { buildReviewPromptFingerprint } from "../review-orchestration/review-prompt-fingerprint.ts";
import { REVIEW_WORKSPACE_FETCH_DEPTH } from "../review-orchestration/review-diff-collection.ts";
import {
  publishBoundedFirstPassTimeoutOutput,
  resolveBoundedFirstPassTimeoutPublicationState,
} from "./review-bounded-first-pass-timeout-publication.ts";
import {
  buildReviewTimeoutClassificationContextParams,
  resolveReviewTimeoutClassificationContext,
} from "./review-timeout-classification-context.ts";
import { applyReviewTimeoutContinuationStateSideEffects } from "./review-timeout-continuation-state.ts";
import {
  buildReviewTimeoutExecutionAdapters,
  resolveReviewTimeoutExecutionContext,
} from "./review-timeout-execution-context.ts";
import {
  buildReviewTimeoutProgressAdapters,
  resolveReviewTimeoutProgressContext,
} from "./review-timeout-progress-context.ts";
import {
  normalizeReviewTimeoutBudgetDetails,
  resolveReviewTimeoutPublicationContext,
} from "./review-timeout-publication-context.ts";
import { buildReviewRetryOutcomeCheckpointLookup } from "./review-timeout-retry-adapters.ts";
import {
  buildReviewContinuationTimeoutEstimator,
  resolveReviewTimeoutRetryContext,
} from "./review-timeout-retry-context.ts";
import {
  buildReviewTimeoutRetryEnqueueParams,
  buildReviewTimeoutRetryPreEnqueueParams,
  buildReviewTimeoutRetrySettlementAdapters,
  scheduleReviewTimeoutRetryContinuation,
} from "./review-timeout-retry-scheduling.ts";
import { buildReviewTimeoutRetryJobParams } from "./review-timeout-retry-job.ts";
import { resolveReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";

type TimeoutPublicationParams = Parameters<typeof publishBoundedFirstPassTimeoutOutput>[0];
type TimeoutRetryJobParams = Parameters<typeof buildReviewTimeoutRetryJobParams>[0];
type TimeoutRetryPreEnqueueParams = Parameters<typeof buildReviewTimeoutRetryPreEnqueueParams>[0];
type TimeoutRetryEnqueueParams = Parameters<typeof buildReviewTimeoutRetryEnqueueParams>[0];
type TimeoutProgressParams = Parameters<typeof resolveReviewTimeoutProgressContext>[0];
type TimeoutClassificationParams = Parameters<typeof buildReviewTimeoutClassificationContextParams>[0];
type TimeoutRetryContextParams = Parameters<typeof resolveReviewTimeoutRetryContext>[0];

export type ReviewTimeoutContinuationOutcome = {
  executionErrorContext: ReviewFallbackExecutionErrorContext;
  publishedPartialReview: boolean;
  fallbackRetryState?: string;
  deferredPublicOutputForContinuation: boolean;
};

export async function handleReviewTimeoutContinuationOutcome(params: {
  category: ReviewFallbackExecutionErrorContext["category"];
  timeoutDuration: ReviewFallbackExecutionErrorContext["timeoutDuration"];
  complexityInfo: ReviewFallbackExecutionErrorContext["complexityInfo"];
  result: TimeoutRetryJobParams["firstPassOutcome"] & TimeoutProgressParams["outcome"] & TimeoutClassificationParams["outcome"] & {
    durationMs?: number;
  };
  turnBudgetExhausted: boolean;
  reviewOutputKey: string;
  changedFileCount: number;
  reviewBoundedness: TimeoutRetryJobParams["reviewBoundedness"];
  knowledgeStore: (Pick<KnowledgeStore, "getCheckpoint" | "saveCheckpoint" | "updateCheckpointCommentId" | "upsertContinuationFamilyState"> & TimeoutRetryJobParams["knowledgeStore"]) | undefined;
  extractionOctokit: Octokit;
  owner: string;
  repo: string;
  pr: TimeoutRetryJobParams["pr"] & TimeoutRetryPreEnqueueParams["pr"] & TimeoutRetryEnqueueParams["pr"] & {
    number: number;
    user: { login: string };
    base: { ref: string };
    head: { repo?: { full_name?: string | null } | null; ref: string };
  };
  logger: Logger;
  baseLog: Record<string, unknown>;
  riskScores: TimeoutRetryContextParams["riskScores"];
  reviewWorkAttempt: { attemptId: string };
  visibleBudgetState: TimeoutRetryJobParams["visibleBudgetState"] & {
    promptSectionRecords: Parameters<typeof buildPromptBudgetOutcomes>[0];
    reviewCacheObservations: unknown[];
    continuationCompactionObservations: unknown[];
    refresh: () => void;
  };
  perFileStats: PerFileStats;
  languageComplexity: number;
  reviewRoutingTaskType: string;
  appliedTimeoutBudget: TimeoutPublicationParams["timeoutBudget"] | undefined;
  event: { id: string; name: string; installationId: number };
  payloadAction: string;
  recentTimeoutTelemetryStore: Pick<TelemetryStore, "countRecentTimeouts">;
  telemetryEnabled: boolean;
  telemetryStore: TimeoutPublicationParams["telemetryStore"] & TimeoutRetryPreEnqueueParams["telemetryStore"] & TimeoutRetryJobParams["telemetryStore"];
  reviewBotHandles: string[];
  canPublishVisibleOutput: TimeoutPublicationParams["canPublishVisibleOutput"];
  setReviewWorkPhase: TimeoutPublicationParams["setReviewWorkPhase"];
  authorSearchEnrichmentDegraded: boolean;
  renderReviewDetailsBody: TimeoutPublicationParams["renderReviewDetailsBody"];
  reviewFamilyKey: string;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "claim" | "complete" | "release">;
  persistContinuationFamilyState: ReviewContinuationFamilyStateManager["persistContinuationFamilyState"];
  jobQueue: TimeoutRetryEnqueueParams["jobQueue"];
  finalizeContinuationAttempt: TimeoutRetryEnqueueParams["finalizeContinuationAttempt"];
  workspaceManager: Pick<WorkspaceManager, "create">;
  cloneOwner: string;
  cloneRepo: string;
  cloneRef: string;
  usesPrRef: boolean;
  fetchRemoteTrackingBranchFn: TimeoutRetryJobParams["fetchRemoteTrackingBranchFn"];
  config: TimeoutRetryJobParams["config"];
  resolvedSeverityMinLevel: TimeoutRetryJobParams["resolvedSeverityMinLevel"];
  resolvedFocusAreas: TimeoutRetryJobParams["resolvedFocusAreas"];
  resolvedIgnoredAreas: TimeoutRetryJobParams["resolvedIgnoredAreas"];
  resolvedMaxComments: TimeoutRetryJobParams["resolvedMaxComments"];
  diffAnalysis: TimeoutRetryJobParams["diffAnalysis"];
  diffContent: TimeoutRetryJobParams["diffContent"];
  matchedPathInstructions: TimeoutRetryJobParams["matchedPathInstructions"];
  incrementalResult: TimeoutRetryJobParams["incrementalResult"];
  priorFindingContext: TimeoutRetryJobParams["priorFindingContext"];
  retrievalContext: TimeoutRetryJobParams["retrievalContext"];
  reviewPrecedents: TimeoutRetryJobParams["reviewPrecedents"];
  wikiKnowledge: TimeoutRetryJobParams["wikiKnowledge"];
  unifiedResults: TimeoutRetryJobParams["unifiedResults"];
  contextWindow: TimeoutRetryJobParams["contextWindow"];
  prLabels: TimeoutRetryJobParams["prLabels"];
  focusHints: TimeoutRetryJobParams["focusHints"];
  conventionalType: TimeoutRetryJobParams["conventionalType"];
  priorFindings: TimeoutRetryJobParams["priorFindings"];
  authorClassification: TimeoutRetryJobParams["authorClassification"];
  depBumpContext: TimeoutRetryJobParams["depBumpContext"];
  isDraft: boolean;
  clusterPatterns: TimeoutRetryJobParams["clusterPatterns"];
  linkedIssues: TimeoutRetryJobParams["linkedIssues"];
  structuralImpact: TimeoutRetryJobParams["structuralImpact"];
  repoDoctrineProjection: TimeoutRetryJobParams["repoDoctrineProjection"];
  promptBuilder: TimeoutRetryJobParams["promptBuilder"];
  promptCache: TimeoutRetryJobParams["promptCache"];
  getPromptCacheErrorCount: TimeoutRetryJobParams["getPromptCacheErrorCount"];
  setReviewWorkPhaseForAttempt: TimeoutRetryJobParams["setReviewWorkPhaseForAttempt"];
  executor: TimeoutRetryJobParams["executor"];
  appSlug: string;
  reviewMaxTurnsOverride: TimeoutRetryJobParams["reviewMaxTurnsOverride"];
  prDiffCommentabilityIndex: TimeoutRetryJobParams["prDiffCommentabilityIndex"];
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  settleRetryWithoutCanonicalUpdate: TimeoutRetryJobParams["settleRetryWithoutCanonicalUpdate"];
  canPublishReviewWorkOutput: TimeoutRetryJobParams["canPublishReviewWorkOutput"];
}): Promise<ReviewTimeoutContinuationOutcome> {
  const executionErrorContext = {
    category: params.category,
    timeoutDuration: params.timeoutDuration,
    complexityInfo: params.complexityInfo,
  };
  let partialCommentId: number | undefined;
  let publishedPartialReview = false;
  let fallbackRetryState: string | undefined;
  let deferredPublicOutputForContinuation = false;

  if (params.result.isTimeout || params.turnBudgetExhausted) {
    const timeoutProgressAdapters = buildReviewTimeoutProgressAdapters({
      knowledgeStore: params.knowledgeStore,
      extractFindingsFromReviewComments,
      extraction: {
        octokit: params.extractionOctokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.pr.number,
        reviewOutputKey: params.reviewOutputKey,
        logger: params.logger,
        baseLog: params.baseLog,
      },
    });
    const {
      checkpoint,
      hasPublishedInlines,
      timeoutReviewedFiles,
      timeoutInspectedFiles,
      timeoutFindingCount,
      timeoutTotalFiles,
      timeoutFirstPass,
      hasPartialResults,
    } = await resolveReviewTimeoutProgressContext({
      reviewOutputKey: params.reviewOutputKey,
      changedFileCount: params.changedFileCount,
      reviewBoundedness: params.reviewBoundedness,
      outcome: {
        conclusion: params.result.conclusion,
        stopReason: params.result.stopReason,
        failureSubtype: params.result.failureSubtype,
        isTimeout: params.result.isTimeout,
        published: params.result.published ?? undefined,
      },
      getCheckpoint: timeoutProgressAdapters.getCheckpoint,
      extractInlineFindings: timeoutProgressAdapters.extractInlineFindings,
    });

    const {
      recentTimeouts,
      isChronicTimeout,
      executionConclusion,
    } = await resolveReviewTimeoutExecutionContext({
      repo: `${params.owner}/${params.repo}`,
      prAuthor: params.pr.user.login,
      outcome: {
        isTimeout: params.result.isTimeout,
        published: params.result.published ?? undefined,
        conclusion: params.result.conclusion,
      },
      turnBudgetExhausted: params.turnBudgetExhausted,
      countRecentTimeouts: buildReviewTimeoutExecutionAdapters({
        telemetryStore: params.recentTimeoutTelemetryStore,
      }).countRecentTimeouts,
    });

    const retryContext = resolveReviewTimeoutRetryContext({
      reviewOutputKey: params.reviewOutputKey,
      timeoutFirstPass,
      checkpoint,
      riskScores: params.riskScores,
      timeoutDurationSeconds: params.timeoutDuration,
      continuationCompaction: {
        attemptId: params.reviewWorkAttempt.attemptId,
        attemptOrdinal: 0,
        promptBudgetOutcomes: buildPromptBudgetOutcomes(params.visibleBudgetState.promptSectionRecords),
        cacheTelemetryObservations: params.visibleBudgetState.reviewCacheObservations,
      },
      hasPublishedInlines,
      isChronicTimeout,
      timeoutReviewedFiles,
      timeoutTotalFiles,
      checkpointPersistenceUnavailableForFamilyState:
        Boolean(params.knowledgeStore?.upsertContinuationFamilyState) && !params.knowledgeStore?.saveCheckpoint,
      forceCheckpointEnabled: params.reviewRoutingTaskType === TASK_TYPES.REVIEW_FULL,
      estimateContinuationTimeout: buildReviewContinuationTimeoutEstimator({
        perFileStats: params.perFileStats,
        languageComplexity: params.languageComplexity,
      }),
    });
    const { retryPlan, retryState, retrySummaryNote } = retryContext;
    let continuationProjectionDegraded = false;

    if (retryPlan?.decision === "schedule-continuation" && retryPlan.continuationCompaction) {
      params.visibleBudgetState.continuationCompactionObservations.push(retryPlan.continuationCompaction);
      params.visibleBudgetState.refresh();
    }

    const timeoutClassificationTelemetry = resolveReviewTimeoutClassificationContext(
      buildReviewTimeoutClassificationContextParams({
        logger: params.logger,
        baseLog: params.baseLog,
        deliveryId: params.event.id,
        reviewOutputKey: params.reviewOutputKey,
        prNumber: params.pr.number,
        outcome: {
          isTimeout: params.result.isTimeout,
          stopReason: params.result.stopReason,
          failureSubtype: params.result.failureSubtype,
        },
        timeoutFirstPass,
        hasCheckpoint: checkpoint !== null,
        timeoutReviewedFiles,
        timeoutInspectedFiles,
        timeoutFindingCount,
        timeoutTotalFiles,
        retryPlan,
        chronicTimeout: isChronicTimeout,
        recentTimeouts,
        durationMs: params.result.durationMs,
        timeoutDurationSeconds: params.timeoutDuration,
      }),
    );
    const timeoutBudgetDetails = normalizeReviewTimeoutBudgetDetails(params.appliedTimeoutBudget);

    const timeoutPublicationContext = resolveReviewTimeoutPublicationContext({
      reviewOutputKey: params.reviewOutputKey,
      checkpoint,
      hasPublishedInlines,
      hasPartialResults,
      retryState,
      retrySummaryNote,
      timeoutInspectedFiles,
      timeoutFindingCount,
      timeoutTotalFiles,
      turnBudgetExhausted: params.turnBudgetExhausted,
      retryScheduled: retryPlan?.decision === "schedule-continuation",
      timeoutFirstPass,
      timeoutDurationSeconds: params.timeoutDuration,
      timeoutBudget: timeoutBudgetDetails,
      isChronicTimeout,
    });
    const {
      summaryDraft,
      timeoutReviewDetails,
      partialBody,
    } = timeoutPublicationContext;
    fallbackRetryState = retryState;

    deferredPublicOutputForContinuation = timeoutPublicationContext.deferredPublicOutputForContinuation;
    const boundedFirstPassPublication = await publishBoundedFirstPassTimeoutOutput({
      timeoutFirstPass,
      deferredPublicOutputForContinuation,
      partialBody,
      octokit: params.extractionOctokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.pr.number,
      reviewOutputKey: params.reviewOutputKey,
      botHandles: params.reviewBotHandles,
      canPublishVisibleOutput: params.canPublishVisibleOutput,
      setReviewWorkPhase: params.setReviewWorkPhase,
      logger: params.logger,
      deliveryId: params.event.id,
      knowledgeStore: params.knowledgeStore,
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
      authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      baseLog: params.baseLog,
      renderReviewDetailsBody: params.renderReviewDetailsBody,
      telemetryEnabled: params.telemetryEnabled,
      telemetryStore: params.telemetryStore,
      prAuthor: params.pr.user.login,
      eventType: `pull_request.${params.payloadAction}`,
      executionConclusion,
      hadInlineOutput: hasPublishedInlines,
      timeoutClassificationTelemetry,
    });
    const boundedFirstPassPublicationState = resolveBoundedFirstPassTimeoutPublicationState(
      boundedFirstPassPublication,
      continuationProjectionDegraded,
    );
    partialCommentId = boundedFirstPassPublicationState.partialCommentId;
    publishedPartialReview = boundedFirstPassPublicationState.publishedPartialReview;
    continuationProjectionDegraded = boundedFirstPassPublicationState.continuationProjectionDegraded;

    const retryEnqueueContext = resolveReviewRetryEnqueueContext({
      deliveryId: params.event.id,
      retryPlan,
    });
    const retryOutcomeCheckpointLookup = buildReviewRetryOutcomeCheckpointLookup({
      knowledgeStore: params.knowledgeStore,
    });
    await applyReviewTimeoutContinuationStateSideEffects({
      attemptId: params.reviewWorkAttempt.attemptId,
      timeoutFirstPass,
      retryScheduled: retryEnqueueContext !== null,
      continuationProjectionDegraded,
      logger: params.logger,
      deliveryId: params.event.id,
      prNumber: params.pr.number,
      reviewOutputKey: params.reviewOutputKey,
      persistContinuationFamilyState: async (state) => await params.persistContinuationFamilyState(state),
    });

    if (retryEnqueueContext) {
      const retryScheduling = await scheduleReviewTimeoutRetryContinuation({
        retryEnqueueContext,
        reviewFamilyKey: params.reviewFamilyKey,
        reviewWorkCoordinator: params.reviewWorkCoordinator,
        preEnqueue: buildReviewTimeoutRetryPreEnqueueParams({
          telemetryEnabled: params.telemetryEnabled,
          telemetryStore: params.telemetryStore,
          logger: params.logger,
          deliveryId: params.event.id,
          owner: params.owner,
          repo: params.repo,
          pr: params.pr,
          eventAction: params.payloadAction,
          reviewOutputKey: params.reviewOutputKey,
          executionConclusion,
          hasPublishedInlines,
          timeoutReviewedFiles,
          timeoutInspectedFiles,
          timeoutFindingCount,
          summaryDraft,
          timeoutTotalFiles,
          partialCommentId,
          recentTimeouts,
          isChronicTimeout,
          timeoutClassificationTelemetry,
          timeoutFirstPass,
          knowledgeStore: params.knowledgeStore,
          persistContinuationFamilyState: async (state) => await params.persistContinuationFamilyState(state),
        }),
        enqueue: buildReviewTimeoutRetryEnqueueParams({
          jobQueue: params.jobQueue,
          installationId: params.event.installationId,
          parentDeliveryId: params.event.id,
          eventName: params.event.name,
          reviewFamilyKey: params.reviewFamilyKey,
          pr: params.pr,
          reviewOutputKey: params.reviewOutputKey,
          knowledgeStore: params.knowledgeStore,
          logger: params.logger,
          finalizeContinuationAttempt: params.finalizeContinuationAttempt,
        }),
        buildRetryJobParams: (retryAttemptId) => buildReviewTimeoutRetryJobParams({
          retryAttemptId,
          retryEnqueueContext,
          retrySettlementAdapters: buildReviewTimeoutRetrySettlementAdapters({
            retryAttemptId,
            installationId: params.event.installationId,
            getInstallationOctokit: params.getInstallationOctokit,
            appSlug: params.appSlug,
            setReviewWorkPhaseForAttempt: params.setReviewWorkPhaseForAttempt,
          }),
          workspaceManager: params.workspaceManager,
          installationId: params.event.installationId,
          cloneOwner: params.cloneOwner,
          cloneRepo: params.cloneRepo,
          cloneRef: params.cloneRef,
          depth: REVIEW_WORKSPACE_FETCH_DEPTH,
          usesPrRef: params.usesPrRef,
          pr: params.pr,
          fetchRemoteTrackingBranchFn: params.fetchRemoteTrackingBranchFn,
          owner: params.owner,
          repo: params.repo,
          config: params.config,
          taskType: params.reviewRoutingTaskType,
          resolvedSeverityMinLevel: params.resolvedSeverityMinLevel,
          resolvedFocusAreas: params.resolvedFocusAreas,
          resolvedIgnoredAreas: params.resolvedIgnoredAreas,
          resolvedMaxComments: params.resolvedMaxComments,
          diffAnalysis: params.diffAnalysis,
          diffContent: params.diffContent,
          matchedPathInstructions: params.matchedPathInstructions,
          incrementalResult: params.incrementalResult,
          priorFindingContext: params.priorFindingContext,
          retrievalContext: params.retrievalContext,
          reviewPrecedents: params.reviewPrecedents,
          wikiKnowledge: params.wikiKnowledge,
          unifiedResults: params.unifiedResults,
          contextWindow: params.contextWindow,
          prLabels: params.prLabels,
          focusHints: params.focusHints,
          conventionalType: params.conventionalType,
          priorFindings: params.priorFindings,
          authorClassification: params.authorClassification,
          depBumpContext: params.depBumpContext,
          isDraft: params.isDraft,
          clusterPatterns: params.clusterPatterns,
          linkedIssues: params.linkedIssues,
          structuralImpact: params.structuralImpact,
          repoDoctrineProjection: params.repoDoctrineProjection,
          checkpoint,
          isTimeout: params.result.isTimeout === true,
          visibleBudgetState: params.visibleBudgetState,
          promptBuilder: params.promptBuilder,
          promptCache: params.promptCache,
          getPromptCacheErrorCount: params.getPromptCacheErrorCount,
          buildPromptFingerprint: buildReviewPromptFingerprint,
          telemetryStore: params.telemetryStore,
          setReviewWorkPhaseForAttempt: params.setReviewWorkPhaseForAttempt,
          logger: params.logger,
          baseLog: params.baseLog,
          executor: params.executor,
          appSlug: params.appSlug,
          reviewMaxTurnsOverride: params.reviewMaxTurnsOverride,
          knowledgeStore: params.knowledgeStore,
          timeoutTotalFiles,
          prDiffCommentabilityIndex: params.prDiffCommentabilityIndex,
          parentDeliveryId: params.event.id,
          prAuthor: params.pr.user.login,
          partialCommentId,
          getCheckpoint: retryOutcomeCheckpointLookup,
          reviewOutputKey: params.reviewOutputKey,
          firstPassOutcome: params.result,
          baseCheckpoint: checkpoint,
          timeoutDurationSeconds: params.timeoutDuration,
          timeoutFirstPassBoundedReason: timeoutFirstPass?.boundedReason,
          authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
          reviewBoundedness: params.reviewBoundedness,
          canPublishReviewWorkOutput: params.canPublishReviewWorkOutput,
          renderReviewDetailsBody: params.renderReviewDetailsBody,
          settleRetryWithoutCanonicalUpdate: params.settleRetryWithoutCanonicalUpdate,
          persistContinuationFamilyState: params.persistContinuationFamilyState,
        }),
      });
      if (retryScheduling.continuationProjectionDegraded) {
        continuationProjectionDegraded = true;
      }
    }
  }

  return {
    executionErrorContext,
    publishedPartialReview,
    fallbackRetryState,
    deferredPublicOutputForContinuation,
  };
}
