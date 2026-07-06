import { classifyError, formatErrorComment, type ErrorCategory } from "../lib/errors.ts";
import type { TimeoutBudgetDetails } from "../lib/review-details-formatting.ts";
import { formatTimeoutErrorDetail } from "../review-orchestration/review-phase-timing.ts";

export type ReviewRunErrorFallbackBodyInput = {
  category: ErrorCategory;
  errorMessage: string | undefined;
  totalTimeoutSeconds: number;
  complexityInfo: string;
  timeoutEstimate?: TimeoutBudgetDetails | null;
};

export function buildReviewTurnLimitFallbackBody(params: { retryScheduled: boolean }): string {
  return [
    "> **Kodiai ran out of steps while reviewing this PR**",
    "",
    "_The review run ended before it could publish comments or an approval._",
    "",
    params.retryScheduled
      ? "A reduced-scope retry has been scheduled automatically."
      : "Kodiai could not preserve enough structured evidence to publish a bounded first-pass review.",
    "",
    "The run was recorded with failure diagnostics for operators.",
  ].join("\n");
}

export function buildReviewFailureFallbackBody(): string {
  return [
    "> **Kodiai could not publish a trustworthy review result**",
    "",
    "No code findings were published.",
    "",
    "The run was recorded with failure diagnostics for operators.",
    "Try a narrower review request if it repeats.",
  ].join("\n");
}

export function buildReviewHandlerFailureErrorBody(err: unknown): string {
  const category = classifyError(err, false);
  const detail = err instanceof Error ? err.message : "An unexpected error occurred";
  return formatErrorComment(category, detail);
}

export function buildReviewRunErrorFallbackBody(input: ReviewRunErrorFallbackBodyInput): string {
  if (input.category === "timeout_partial" || input.category === "timeout") {
    return formatErrorComment(
      input.category,
      formatTimeoutErrorDetail({
        totalTimeoutSeconds: input.totalTimeoutSeconds,
        complexityInfo: input.complexityInfo,
        hasReviewOutput: input.category === "timeout_partial",
        timeoutEstimate: input.timeoutEstimate,
      }),
    );
  }

  return formatErrorComment(
    input.category,
    input.errorMessage ?? "An unexpected error occurred during review.",
  );
}

export function buildReviewExecutionErrorFallbackBody(input: ReviewRunErrorFallbackBodyInput & {
  exhaustedTurnBudget: boolean;
  retryScheduled: boolean;
}): string {
  if (input.exhaustedTurnBudget) {
    return buildReviewTurnLimitFallbackBody({ retryScheduled: input.retryScheduled });
  }

  return buildReviewRunErrorFallbackBody(input);
}
