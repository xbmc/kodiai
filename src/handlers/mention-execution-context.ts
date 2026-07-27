import type { ExecutionContext } from "../execution/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { FormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";
import type { MentionExecutorPlan } from "./mention-executor-plan.ts";
import type { MentionEvent } from "./mention-types.ts";

export function buildMentionExecutionContext(params: {
  workspace: ExecutionContext["workspace"];
  installationId: number;
  mention: MentionEvent;
  deliveryId: string;
  botHandles: string[];
  writeEnabled: boolean;
  executorPlan: MentionExecutorPlan;
  prompt: string;
  promptSections: ExecutionContext["promptSections"];
  explicitReviewDynamicTimeoutSeconds: number | undefined;
  knowledgeStore: KnowledgeStore | undefined;
  formatterSuggestionRequest: FormatterSuggestionRequest | undefined;
  explicitReviewPromptFileCount: number | undefined;
  explicitReviewRequest: boolean;
  explicitReviewPrDiffCommentabilityIndex: ExecutionContext["prDiffCommentabilityIndex"];
}): ExecutionContext {
  return {
    workspace: params.workspace,
    installationId: params.installationId,
    owner: params.mention.owner,
    repo: params.mention.repo,
    prNumber: params.mention.prNumber,
    issueNumber: params.mention.issueNumber,
    commentId: params.mention.surface === "pr_review_comment"
      ? params.mention.commentId
      : undefined,
    deliveryId: params.deliveryId,
    botHandles: params.botHandles,
    writeMode: params.writeEnabled,
    taskType: params.executorPlan.taskType,
    eventType: params.executorPlan.eventType,
    triggerBody: params.executorPlan.triggerBody,
    prompt: params.prompt,
    promptSections: params.promptSections,
    reviewOutputKey: params.executorPlan.reviewOutputKey,
    canonicalReviewOutputKey: params.executorPlan.canonicalReviewSurfaceKey,
    maxTurnsOverride: params.executorPlan.maxTurnsOverride,
    dynamicTimeoutSeconds: params.explicitReviewDynamicTimeoutSeconds,
    knowledgeStore: params.knowledgeStore,
    formatterSuggestionRequest: params.formatterSuggestionRequest,
    totalFiles: params.explicitReviewPromptFileCount,
    enableInlineTools: params.executorPlan.enableInlineTools,
    enableCandidateFindingTool: params.executorPlan.enableCandidateFindingTool,
    prDiffCommentabilityIndex: params.explicitReviewRequest
      ? params.explicitReviewPrDiffCommentabilityIndex
      : undefined,
  };
}
