import type { ReviewPromptBuildContext } from "../review-orchestration/review-prompt-fingerprint.ts";
import { buildPromptBudgetOutcomes } from "../review-orchestration/review-visible-budget-evidence.ts";
import type { ReviewVisibleBudgetProjectionState } from "./review-visible-budget-state.ts";
import { buildRetryReviewPromptContext } from "./review-prompt-build-context.ts";
import { buildReviewRetryCustomInstructions } from "./review-retry-instructions.ts";
import type { ReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";

type RetryPromptContextParams = Omit<
  Parameters<typeof buildRetryReviewPromptContext>[0],
  | "changedFiles"
  | "customInstructions"
  | "checkpointEnabled"
  | "retryContinuationCompaction"
  | "promptBudgetOutcomes"
  | "cacheSafetySignalNames"
>;

export function buildReviewRetryPromptBuildContext(
  params: RetryPromptContextParams & {
    basePrompt: string | undefined;
    isTimeout: boolean;
    retryEnqueueContext: ReviewRetryEnqueueContext;
    visibleBudgetState: Pick<
      ReviewVisibleBudgetProjectionState,
      "promptSectionRecords" | "reviewCacheObservations"
    >;
  },
): ReviewPromptBuildContext {
  return buildRetryReviewPromptContext({
    ...params,
    changedFiles: params.retryEnqueueContext.retryFiles,
    customInstructions: buildReviewRetryCustomInstructions({
      basePrompt: params.basePrompt,
      isTimeout: params.isTimeout,
      checkpointEnabled: params.retryEnqueueContext.retryCheckpointEnabled,
    }),
    checkpointEnabled: params.retryEnqueueContext.retryCheckpointEnabled,
    retryContinuationCompaction: params.retryEnqueueContext.retryContinuationCompaction ?? null,
    promptBudgetOutcomes: buildPromptBudgetOutcomes(params.visibleBudgetState.promptSectionRecords),
    cacheSafetySignalNames: params.visibleBudgetState.reviewCacheObservations.flatMap(
      (observation) => observation.safetySignalNames ?? [],
    ),
  });
}
