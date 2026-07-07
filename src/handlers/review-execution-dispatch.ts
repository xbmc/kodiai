import type { ExecutionContext, ExecutionResult } from "../execution/types.ts";
import { buildReviewExecutionContext } from "./review-execution-context.ts";
import {
  applyReviewExecutorState,
  projectReviewExecutorState,
  type ReviewExecutorStateProjection,
} from "./review-executor-state.ts";

type InitialReviewExecutor = {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
};

type ApplyReviewExecutorStateParams = Parameters<typeof applyReviewExecutorState>[0];

export async function dispatchInitialReviewExecution(params: {
  executor: InitialReviewExecutor;
  executionContext: Parameters<typeof buildReviewExecutionContext>[0];
  currentPromptSectionRecords: Parameters<typeof projectReviewExecutorState>[0]["currentPromptSectionRecords"];
  publicationState: ApplyReviewExecutorStateParams["publicationState"];
  visibleBudgetState: ApplyReviewExecutorStateParams["visibleBudgetState"];
  timingState: ApplyReviewExecutorStateParams["timingState"];
  reviewPhaseTimings: ApplyReviewExecutorStateParams["reviewPhaseTimings"];
  recordExecutorPhaseTimings: ApplyReviewExecutorStateParams["recordExecutorPhaseTimings"];
  setReviewWorkPhase: (phase: "executor-dispatch") => void;
  now?: ApplyReviewExecutorStateParams["now"];
}): Promise<{
  result: ExecutionResult;
  executorState: ReviewExecutorStateProjection;
}> {
  params.setReviewWorkPhase("executor-dispatch");
  const result = await params.executor.execute(buildReviewExecutionContext(params.executionContext));
  const executorState = projectReviewExecutorState({
    result,
    currentPromptSectionRecords: params.currentPromptSectionRecords,
  });
  applyReviewExecutorState({
    projection: executorState,
    publicationState: params.publicationState,
    visibleBudgetState: params.visibleBudgetState,
    timingState: params.timingState,
    reviewPhaseTimings: params.reviewPhaseTimings,
    recordExecutorPhaseTimings: params.recordExecutorPhaseTimings,
    now: params.now,
  });

  return { result, executorState };
}
