import type { createExecutor } from "../execution/executor.ts";
import type { Workspace, WorkspaceManager } from "../jobs/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { fetchRemoteTrackingBranch } from "../jobs/workspace.ts";
import { buildReviewRetryExecutionContext } from "./review-execution-context.ts";
import { prepareRetryReviewPrompt } from "./review-retry-prompt-preparation.ts";
import { resolveReviewRetryExecutionOutcome } from "./review-retry-execution-outcome.ts";
import type { ReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";
import { settleRetryContinuationResults } from "./review-retry-continuation-settlement.ts";
import { prepareReviewRetryWorkspace } from "./review-workspace-preparation.ts";

type RetryPromptParams = Parameters<typeof prepareRetryReviewPrompt>[0];
type RetryOutcomeParams = Parameters<typeof resolveReviewRetryExecutionOutcome>[0];
type RetrySettlementParams = Parameters<typeof settleRetryContinuationResults>[0];
type RetryJobParams = Parameters<typeof runReviewTimeoutRetryJob>[0];

export function buildReviewTimeoutRetryJobParams(params: {
  retryAttemptId: string;
  retryEnqueueContext: ReviewRetryEnqueueContext;
  retrySettlementAdapters: Pick<RetryJobParams["settlement"], "getOctokit" | "getAppSlug" | "setPublishPhase">;
  workspaceManager: RetryJobParams["workspaceManager"];
  installationId: number;
  cloneOwner: string;
  cloneRepo: string;
  cloneRef: string;
  depth: number;
  usesPrRef: boolean;
  pr: RetryPromptParams["pr"] & {
    number: number;
    base: { ref: string };
    head: { repo?: { full_name?: string | null } | null; ref: string };
  };
  fetchRemoteTrackingBranchFn?: typeof fetchRemoteTrackingBranch;
  owner: string;
  repo: string;
  config: RetryPromptParams["config"];
  taskType: string;
  resolvedSeverityMinLevel: RetryPromptParams["resolvedSeverityMinLevel"];
  resolvedFocusAreas: RetryPromptParams["resolvedFocusAreas"];
  resolvedIgnoredAreas: RetryPromptParams["resolvedIgnoredAreas"];
  resolvedMaxComments: RetryPromptParams["resolvedMaxComments"];
  diffAnalysis: RetryPromptParams["diffAnalysis"];
  diffContent: RetryPromptParams["diffContent"];
  matchedPathInstructions: RetryPromptParams["matchedPathInstructions"];
  incrementalResult: RetryPromptParams["incrementalResult"];
  priorFindingContext: RetryPromptParams["priorFindingContext"];
  retrievalContext: RetryPromptParams["retrievalContext"];
  reviewPrecedents: RetryPromptParams["reviewPrecedents"];
  wikiKnowledge: RetryPromptParams["wikiKnowledge"];
  unifiedResults: RetryPromptParams["unifiedResults"];
  contextWindow: RetryPromptParams["contextWindow"];
  prLabels: RetryPromptParams["prLabels"];
  focusHints: RetryPromptParams["focusHints"];
  conventionalType: RetryPromptParams["conventionalType"];
  priorFindings: RetryPromptParams["priorFindings"];
  authorClassification: RetryPromptParams["authorClassification"];
  depBumpContext: RetryPromptParams["depBumpContext"];
  isDraft: boolean;
  clusterPatterns: RetryPromptParams["clusterPatterns"];
  linkedIssues: RetryPromptParams["linkedIssues"];
  structuralImpact: RetryPromptParams["structuralImpact"];
  repoDoctrineProjection: RetryPromptParams["repoDoctrineProjection"];
  checkpoint: RetryPromptParams["checkpoint"];
  isTimeout: boolean;
  visibleBudgetState: RetryPromptParams["visibleBudgetState"];
  promptBuilder: RetryPromptParams["promptBuilder"];
  promptCache: RetryPromptParams["promptCache"];
  getPromptCacheErrorCount: RetryPromptParams["getPromptCacheErrorCount"];
  buildPromptFingerprint: RetryPromptParams["buildPromptFingerprint"];
  telemetryStore: RetryPromptParams["telemetryStore"] & RetryOutcomeParams["telemetryStore"];
  setReviewWorkPhaseForAttempt: RetryPromptParams["setReviewWorkPhaseForAttempt"];
  logger: RetryPromptParams["logger"] & RetryOutcomeParams["logger"] & RetrySettlementParams["logger"];
  baseLog: RetryPromptParams["baseLog"];
  executor: RetryJobParams["executor"];
  appSlug: string;
  reviewMaxTurnsOverride: RetryJobParams["execution"]["reviewMaxTurnsOverride"];
  knowledgeStore: RetryJobParams["execution"]["knowledgeStore"];
  timeoutTotalFiles: number;
  prDiffCommentabilityIndex: RetryJobParams["execution"]["prDiffCommentabilityIndex"];
  parentDeliveryId: string;
  prAuthor: string;
  partialCommentId: RetryOutcomeParams["partialCommentId"];
  hasPublishedInlines: RetrySettlementParams["hasPublishedInlines"];
  getCheckpoint: RetryOutcomeParams["getCheckpoint"];
  reviewOutputKey: string;
  canonicalReviewOutputKey: string;
  firstPassOutcome: RetrySettlementParams["firstPassOutcome"];
  baseCheckpoint: RetrySettlementParams["baseCheckpoint"];
  timeoutDurationSeconds: RetrySettlementParams["timeoutDurationSeconds"];
  timeoutFirstPassBoundedReason: RetrySettlementParams["timeoutFirstPassBoundedReason"];
  authorSearchEnrichmentDegraded: RetrySettlementParams["authorSearchEnrichmentDegraded"];
  reviewBoundedness: RetrySettlementParams["reviewBoundedness"];
  canPublishReviewWorkOutput: RetrySettlementParams["canPublishReviewWorkOutput"];
  renderReviewDetailsBody: RetrySettlementParams["renderReviewDetailsBody"];
  settleRetryWithoutCanonicalUpdate: RetrySettlementParams["settleRetryWithoutCanonicalUpdate"];
  persistContinuationFamilyState: RetrySettlementParams["persistContinuationFamilyState"];
}): RetryJobParams {
  return {
    workspaceManager: params.workspaceManager,
    installationId: params.installationId,
    cloneOwner: params.cloneOwner,
    cloneRepo: params.cloneRepo,
    cloneRef: params.cloneRef,
    depth: params.depth,
    usesPrRef: params.usesPrRef,
    prNumber: params.pr.number,
    baseRef: params.pr.base.ref,
    fallbackHeadRepoFullName: params.pr.head.repo?.full_name ?? null,
    fallbackHeadRef: params.pr.head.ref,
    fetchRemoteTrackingBranchFn: params.fetchRemoteTrackingBranchFn,
    retryAttemptId: params.retryAttemptId,
    retryEnqueueContext: params.retryEnqueueContext,
    preparePrompt: {
      owner: params.owner,
      repo: params.repo,
      pr: params.pr,
      config: params.config,
      taskType: params.taskType,
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
      checkpoint: params.checkpoint,
      isTimeout: params.isTimeout,
      visibleBudgetState: params.visibleBudgetState,
      promptBuilder: params.promptBuilder,
      promptCache: params.promptCache,
      getPromptCacheErrorCount: params.getPromptCacheErrorCount,
      buildPromptFingerprint: params.buildPromptFingerprint,
      telemetryStore: params.telemetryStore,
      setReviewWorkPhaseForAttempt: params.setReviewWorkPhaseForAttempt,
      logger: params.logger,
      baseLog: params.baseLog,
    },
    executor: params.executor,
    execution: {
      owner: params.owner,
      repo: params.repo,
      appSlug: params.appSlug,
      taskType: params.taskType,
      reviewMaxTurnsOverride: params.reviewMaxTurnsOverride,
      knowledgeStore: params.knowledgeStore,
      timeoutTotalFiles: params.timeoutTotalFiles,
      prDiffCommentabilityIndex: params.prDiffCommentabilityIndex,
    },
    outcome: {
      telemetryEnabled: params.config.telemetry.enabled,
      telemetryStore: params.telemetryStore,
      logger: params.logger,
      parentDeliveryId: params.parentDeliveryId,
      repo: `${params.owner}/${params.repo}`,
      prNumber: params.pr.number,
      prAuthor: params.prAuthor,
      partialCommentId: params.partialCommentId,
      timeoutTotalFiles: params.timeoutTotalFiles,
      getCheckpoint: params.getCheckpoint,
    },
    settlement: {
      getOctokit: params.retrySettlementAdapters.getOctokit,
      getAppSlug: params.retrySettlementAdapters.getAppSlug,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.pr.number,
      reviewOutputKey: params.reviewOutputKey,
      canonicalReviewOutputKey: params.canonicalReviewOutputKey,
      firstPassOutcome: params.firstPassOutcome,
      baseCheckpoint: params.baseCheckpoint,
      partialCommentId: params.partialCommentId,
      hasPublishedInlines: params.hasPublishedInlines,
      timeoutDurationSeconds: params.timeoutDurationSeconds,
      timeoutFirstPassBoundedReason: params.timeoutFirstPassBoundedReason,
      knowledgeStore: params.knowledgeStore,
      authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      baseLog: params.baseLog,
      logger: params.logger,
      canPublishReviewWorkOutput: params.canPublishReviewWorkOutput,
      setPublishPhase: params.retrySettlementAdapters.setPublishPhase,
      renderReviewDetailsBody: params.renderReviewDetailsBody,
      settleRetryWithoutCanonicalUpdate: params.settleRetryWithoutCanonicalUpdate,
      persistContinuationFamilyState: params.persistContinuationFamilyState,
    },
    setReviewWorkPhaseForAttempt: params.setReviewWorkPhaseForAttempt,
  };
}

export async function runReviewTimeoutRetryJob(params: {
  workspaceManager: Pick<WorkspaceManager, "create">;
  installationId: number;
  cloneOwner: string;
  cloneRepo: string;
  cloneRef: string;
  depth: number;
  usesPrRef: boolean;
  prNumber: number;
  baseRef: string;
  fallbackHeadRepoFullName?: string | null;
  fallbackHeadRef: string;
  fetchRemoteTrackingBranchFn?: typeof fetchRemoteTrackingBranch;
  retryAttemptId: string;
  retryEnqueueContext: ReviewRetryEnqueueContext;
  preparePrompt: Omit<
    RetryPromptParams,
    "retryAttemptId" | "retryDeliveryId" | "retryReviewOutputKey" | "retryEnqueueContext"
  >;
  executor: ReturnType<typeof createExecutor>;
  execution: {
    owner: string;
    repo: string;
    appSlug: string;
    taskType: string;
    reviewMaxTurnsOverride: number | undefined;
    knowledgeStore: KnowledgeStore | undefined;
    timeoutTotalFiles: number;
    prDiffCommentabilityIndex: Parameters<typeof buildReviewRetryExecutionContext>[0]["prDiffCommentabilityIndex"];
  };
  outcome: Omit<
    RetryOutcomeParams,
    | "retryDeliveryId"
    | "retryReviewOutputKey"
    | "retryResult"
    | "retryPromptSections"
    | "retryReviewPromptDerivedCacheStatus"
    | "retryReviewPromptDerivedCacheReason"
    | "retryFilesCount"
    | "retryScopeRatio"
    | "retryTimeoutSeconds"
    | "retryRiskLevel"
    | "retryCheckpointEnabled"
  >;
  settlement: Omit<
    RetrySettlementParams,
    | "retryCompletedWithResults"
    | "attemptId"
    | "deliveryId"
    | "retryReviewOutputKey"
    | "retryResult"
    | "retryCheckpoint"
    | "retryFilesCount"
  >;
  setReviewWorkPhaseForAttempt: RetryPromptParams["setReviewWorkPhaseForAttempt"];
}): Promise<Workspace> {
  const {
    retryReviewOutputKey,
    retryTimeout,
    retryFiles,
    retryTimeoutEstimate,
    retryCheckpointEnabled,
    retryScopeRatio,
    retryDeliveryId,
  } = params.retryEnqueueContext;

  const retryWorkspace = await prepareReviewRetryWorkspace({
    workspaceManager: params.workspaceManager,
    installationId: params.installationId,
    owner: params.cloneOwner,
    repo: params.cloneRepo,
    ref: params.cloneRef,
    depth: params.depth,
    usesPrRef: params.usesPrRef,
    prNumber: params.prNumber,
    baseRef: params.baseRef,
    fallbackHeadRepoFullName: params.fallbackHeadRepoFullName,
    fallbackHeadRef: params.fallbackHeadRef,
    localBranch: "pr-review-retry-1",
    fetchRemoteTrackingBranchFn: params.fetchRemoteTrackingBranchFn,
  });

  const {
    retryReviewPromptDerivedCacheStatus,
    retryReviewPromptDerivedCacheReason,
    retryPrompt,
    retryPromptSections,
  } = await prepareRetryReviewPrompt({
    ...params.preparePrompt,
    retryAttemptId: params.retryAttemptId,
    retryDeliveryId,
    retryReviewOutputKey,
    retryEnqueueContext: params.retryEnqueueContext,
  });

  params.setReviewWorkPhaseForAttempt(params.retryAttemptId, "executor-dispatch");
  const retryResult = await params.executor.execute(buildReviewRetryExecutionContext({
    workspace: retryWorkspace,
    installationId: params.installationId,
    owner: params.execution.owner,
    repo: params.execution.repo,
    prNumber: params.prNumber,
    appSlug: params.execution.appSlug,
    taskType: params.execution.taskType,
    retryPrompt,
    retryPromptSections,
    retryReviewOutputKey,
    retryDeliveryId,
    retryTimeoutSeconds: retryTimeout,
    reviewMaxTurnsOverride: params.execution.reviewMaxTurnsOverride,
    knowledgeStore: params.execution.knowledgeStore,
    timeoutTotalFiles: params.execution.timeoutTotalFiles,
    retryCheckpointEnabled,
    prDiffCommentabilityIndex: params.execution.prDiffCommentabilityIndex,
  }));

  const {
    retryCheckpoint,
    retryHasResults,
  } = await resolveReviewRetryExecutionOutcome({
    ...params.outcome,
    retryDeliveryId,
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
  });

  await settleRetryContinuationResults({
    ...params.settlement,
    retryCompletedWithResults: retryResult.conclusion === "success" || (retryResult.isTimeout === true && retryHasResults),
    attemptId: params.retryAttemptId,
    deliveryId: retryDeliveryId,
    retryReviewOutputKey,
    retryResult,
    retryCheckpoint,
    retryFilesCount: retryFiles.length,
  });

  return retryWorkspace;
}
