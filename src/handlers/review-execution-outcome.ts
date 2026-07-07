import { classifyError, type ErrorCategory } from "../lib/errors.ts";

export type ReviewExecutionOutcomeInputResult = {
  conclusion: string;
  stopReason?: string;
  failureSubtype?: string;
  isTimeout?: boolean;
  published?: boolean;
  errorMessage?: string;
};

export type ReviewExecutionOutcomeContext =
  | {
      exhaustedTurnBudget: boolean;
      shouldHandleErrorOrTurnLimit: false;
      category: undefined;
      timeoutDuration: undefined;
      complexityInfo: undefined;
    }
  | {
      exhaustedTurnBudget: boolean;
      shouldHandleErrorOrTurnLimit: true;
      category: ErrorCategory;
      timeoutDuration: number;
      complexityInfo: string;
    };

export function resolveReviewExecutionOutcomeContext(params: {
  result: ReviewExecutionOutcomeInputResult;
  totalTimeoutSeconds: number | undefined;
  defaultTimeoutSeconds: number;
  timeoutComplexityReasoning: string | undefined;
}): ReviewExecutionOutcomeContext {
  const exhaustedTurnBudget =
    params.result.stopReason === "max_turns" ||
    params.result.failureSubtype === "error_max_turns";

  const shouldHandleErrorOrTurnLimit =
    params.result.conclusion === "error" ||
    (params.result.conclusion === "failure" && exhaustedTurnBudget);

  if (!shouldHandleErrorOrTurnLimit) {
    return {
      exhaustedTurnBudget,
      shouldHandleErrorOrTurnLimit: false,
      category: undefined,
      timeoutDuration: undefined,
      complexityInfo: undefined,
    };
  }

  return {
    exhaustedTurnBudget,
    shouldHandleErrorOrTurnLimit: true,
    category: exhaustedTurnBudget
      ? "timeout"
      : classifyError(
          new Error(params.result.errorMessage ?? "Unknown error"),
          params.result.isTimeout ?? false,
          params.result.published ?? false,
        ),
    timeoutDuration: params.totalTimeoutSeconds ?? params.defaultTimeoutSeconds,
    complexityInfo: params.timeoutComplexityReasoning ?? "unknown",
  };
}
