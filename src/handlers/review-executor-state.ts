import type {
  ExecutionResult,
  ExecutorPhaseTiming,
  ReviewPhaseName,
  ReviewPhaseTiming,
} from "../execution/types.ts";
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

export function applyReviewExecutorState(params: {
  projection: ReviewExecutorStateProjection;
  publicationState: {
    executorResult?: ExecutionResult;
    reviewExecutorPublished: boolean;
    reviewOutputPublished: boolean;
    reviewPublishResolution: string;
  };
  visibleBudgetState: {
    promptSectionRecords: PromptSectionRecord[];
    refresh(): unknown;
  };
  timingState: {
    executorPhaseTimings: ExecutorPhaseTiming[];
    publicationPhaseStartedAt?: number;
  };
  reviewPhaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  recordExecutorPhaseTimings: (
    reviewPhaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>,
    executorPhaseTimings: ExecutorPhaseTiming[],
  ) => void;
  now?: () => number;
}): void {
  const { projection } = params;
  params.publicationState.executorResult = projection.executorResult;
  params.publicationState.reviewExecutorPublished = projection.reviewExecutorPublished;
  params.publicationState.reviewOutputPublished = projection.reviewOutputPublished;
  params.publicationState.reviewPublishResolution = projection.reviewPublishResolution;
  params.visibleBudgetState.promptSectionRecords = projection.promptSectionRecords;
  params.visibleBudgetState.refresh();
  params.timingState.executorPhaseTimings = projection.executorPhaseTimings;
  params.recordExecutorPhaseTimings(params.reviewPhaseTimings, params.timingState.executorPhaseTimings);
  params.timingState.publicationPhaseStartedAt = (params.now ?? Date.now)();
}
