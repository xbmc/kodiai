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
