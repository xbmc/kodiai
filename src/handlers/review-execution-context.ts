import type { ExecutionContext } from "../execution/types.ts";
import type { CandidateVerificationContext } from "../execution/mcp/review-output-publication-gate.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { TimeoutBudgetDetails } from "../lib/review-details-formatting.ts";
import { buildShadowSpecialistCorrelationKey } from "../review-orchestration/review-specialist-publication-log.ts";

export function buildReviewExecutionContext(params: {
  workspace: ExecutionContext["workspace"];
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  appSlug: string;
  action: string | undefined;
  taskType: string;
  reviewPrompt: string;
  reviewPromptSections: ExecutionContext["promptSections"];
  reviewOutputKey: string;
  deliveryId: string;
  candidateVerificationContext: CandidateVerificationContext | undefined;
  knowledgeStore: KnowledgeStore | undefined;
  changedFileCount: number;
  checkpointEnabled: boolean;
  prDiffCommentabilityIndex: ExecutionContext["prDiffCommentabilityIndex"];
  appliedTimeoutBudget: Pick<TimeoutBudgetDetails, "totalTimeoutSeconds"> | null | undefined;
  reviewMaxTurnsOverride: number | undefined;
}): ExecutionContext {
  return {
    workspace: params.workspace,
    installationId: params.installationId,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    commentId: undefined,
    botHandles: [params.appSlug, "claude"],
    eventType: `pull_request.${params.action}`,
    taskType: params.taskType,
    triggerBody: params.reviewPrompt,
    prompt: params.reviewPrompt,
    promptSections: params.reviewPromptSections,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    candidateVerificationContext: params.candidateVerificationContext,
    knowledgeStore: params.knowledgeStore,
    totalFiles: params.changedFileCount,
    enableCheckpointTool: params.checkpointEnabled,
    enableCandidateFindingTool: true,
    prDiffCommentabilityIndex: params.prDiffCommentabilityIndex,
    dynamicTimeoutSeconds: params.appliedTimeoutBudget?.totalTimeoutSeconds,
    maxTurnsOverride: params.reviewMaxTurnsOverride,
  };
}

export function buildReviewRetryExecutionContext(params: {
  workspace: ExecutionContext["workspace"];
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  appSlug: string;
  taskType: string;
  retryPrompt: string;
  retryPromptSections: ExecutionContext["promptSections"];
  retryReviewOutputKey: string;
  retryDeliveryId: string;
  retryTimeoutSeconds: number;
  reviewMaxTurnsOverride: number | undefined;
  knowledgeStore: KnowledgeStore | undefined;
  timeoutTotalFiles: number;
  retryCheckpointEnabled: boolean;
  prDiffCommentabilityIndex: ExecutionContext["prDiffCommentabilityIndex"];
}): ExecutionContext {
  return {
    workspace: params.workspace,
    installationId: params.installationId,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    commentId: undefined,
    botHandles: [params.appSlug, "claude"],
    eventType: "pull_request.review-retry",
    taskType: params.taskType,
    triggerBody: "",
    prompt: params.retryPrompt,
    promptSections: params.retryPromptSections,
    reviewOutputKey: params.retryReviewOutputKey,
    deliveryId: params.retryDeliveryId,
    candidateVerificationContext: {
      docsConfigTruth: null,
      deliveryId: params.retryDeliveryId,
      reviewOutputKey: params.retryReviewOutputKey,
      correlationKey: buildShadowSpecialistCorrelationKey({
        deliveryId: params.retryDeliveryId,
        reviewOutputKey: params.retryReviewOutputKey,
        prNumber: params.prNumber,
      }),
    },
    dynamicTimeoutSeconds: params.retryTimeoutSeconds,
    maxTurnsOverride: params.reviewMaxTurnsOverride,
    knowledgeStore: params.knowledgeStore,
    totalFiles: params.timeoutTotalFiles,
    enableCheckpointTool: params.retryCheckpointEnabled,
    prDiffCommentabilityIndex: params.prDiffCommentabilityIndex,
    enableCommentTools: false,
  };
}
