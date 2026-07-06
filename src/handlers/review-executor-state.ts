import type { ExecutionResult, ExecutorPhaseTiming } from "../execution/types.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import { buildExecutorUnavailablePhases } from "../review-orchestration/review-phase-timing.ts";

export type ReviewExecutorStateProjection = {
  executorResult: ExecutionResult;
  reviewExecutorPublished: boolean;
  reviewOutputPublished: boolean;
  reviewPublishResolution: "executor" | "none";
  promptSectionRecords: PromptSectionRecord[];
  executorPhaseTimings: ExecutorPhaseTiming[];
};

export function projectReviewExecutorState(params: {
  result: ExecutionResult;
  currentPromptSectionRecords: PromptSectionRecord[];
}): ReviewExecutorStateProjection {
  const reviewOutputPublished = params.result.published ?? false;

  return {
    executorResult: params.result,
    reviewExecutorPublished: reviewOutputPublished,
    reviewOutputPublished,
    reviewPublishResolution: reviewOutputPublished ? "executor" : "none",
    promptSectionRecords: params.result.promptSections ?? params.currentPromptSectionRecords,
    executorPhaseTimings: params.result.executorPhaseTimings ?? buildExecutorUnavailablePhases(
      "executor phase timings unavailable",
    ),
  };
}
