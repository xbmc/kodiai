import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { Workspace } from "../jobs/types.ts";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { FormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";
import type {
  FormatterSuggestionMentionRunner,
  FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import type { MentionEvent } from "./mention-types.ts";
import { classifyError } from "../lib/errors.ts";
import { buildMentionExecutionContext } from "./mention-execution-context.ts";
import {
  resolveMentionExecutorPlan,
  type MentionExecutorPlan,
} from "./mention-executor-plan.ts";
import { executeMentionWithFormatterRecovery } from "./mention-execution-dispatch.ts";

export type MentionExecutorDispatchPhaseResult = {
  executorPlan: MentionExecutorPlan;
  reviewOutputKey: string | undefined;
  result: ExecutionResult;
};

export async function runMentionExecutorDispatchPhase(params: {
  executor: ReturnType<typeof createExecutor>;
  workspace: Workspace;
  installationId: number;
  deliveryId: string;
  eventName: string;
  eventAction: string | undefined;
  mention: MentionEvent;
  possibleHandles: string[];
  explicitReviewRequest: boolean;
  explicitReviewTaskType: string;
  explicitReviewMaxTurnsOverride: number | undefined;
  formatterSuggestionRequest: FormatterSuggestionRequest | undefined;
  writeEnabled: boolean;
  hasPrDiffContext: boolean;
  userQuestion: string;
  prompt: string;
  promptSections: Parameters<typeof buildMentionExecutionContext>[0]["promptSections"];
  knowledgeStore: KnowledgeStore | undefined;
  explicitReviewPromptFileCount: number | undefined;
  explicitReviewDynamicTimeoutSeconds: number | undefined;
  explicitReviewPrDiffCommentabilityIndex: Parameters<typeof buildMentionExecutionContext>[0]["explicitReviewPrDiffCommentabilityIndex"];
  reviewWorkAttempt: unknown;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  reviewOutputAction: string;
  runFormatterSuggestionForMention: FormatterSuggestionMentionRunner;
  postFormatterVisibleDiagnostic: FormatterSuggestionVisibleDiagnosticPoster;
  logger: Logger;
}): Promise<MentionExecutorDispatchPhaseResult> {
  const executorPlan = resolveMentionExecutorPlan({
    mention: params.mention,
    installationId: params.installationId,
    deliveryId: params.deliveryId,
    eventName: params.eventName,
    eventAction: params.eventAction,
    explicitReviewRequest: params.explicitReviewRequest,
    explicitReviewTaskType: params.explicitReviewTaskType,
    explicitReviewMaxTurnsOverride: params.explicitReviewMaxTurnsOverride,
    formatterSuggestionMode: params.formatterSuggestionRequest?.mode,
    writeEnabled: params.writeEnabled,
    hasPrDiffContext: params.hasPrDiffContext,
    userQuestion: params.userQuestion,
  });

  if (params.reviewWorkAttempt) {
    params.setReviewWorkPhase("executor-dispatch");
  }

  const result = await executeMentionWithFormatterRecovery({
    execute: (context) => params.executor.execute(context),
    context: buildMentionExecutionContext({
      workspace: params.workspace,
      installationId: params.installationId,
      mention: params.mention,
      deliveryId: params.deliveryId,
      botHandles: params.possibleHandles,
      writeEnabled: params.writeEnabled,
      executorPlan,
      prompt: params.prompt,
      promptSections: params.promptSections,
      knowledgeStore: params.knowledgeStore,
      formatterSuggestionRequest: params.formatterSuggestionRequest,
      explicitReviewPromptFileCount: params.explicitReviewPromptFileCount,
      explicitReviewRequest: params.explicitReviewRequest,
      explicitReviewDynamicTimeoutSeconds: params.explicitReviewDynamicTimeoutSeconds,
      explicitReviewPrDiffCommentabilityIndex: params.explicitReviewPrDiffCommentabilityIndex,
    }),
    isCombinedFormatterSuggestionRequest: executorPlan.isCombinedFormatterSuggestionRequest,
    mention: params.mention,
    deliveryId: params.deliveryId,
    reviewOutputAction: params.reviewOutputAction,
    runFormatterSuggestionForMention: params.runFormatterSuggestionForMention,
    postFormatterVisibleDiagnostic: params.postFormatterVisibleDiagnostic,
    classifyFailure: (err) => classifyError(err, false),
    logger: params.logger,
  });

  return {
    executorPlan,
    reviewOutputKey: executorPlan.reviewOutputKey,
    result,
  };
}
