import type { Logger } from "pino";
import {
  createDegradedReviewReducerResult,
  type ReviewReducerInput,
  type ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import {
  isTrustedReviewReducerResult,
  logReviewReducerResult,
} from "../review-orchestration/review-reducer-log.ts";

export type ReviewReducerRuntime = (
  input: ReviewReducerInput,
) => Promise<ReviewReducerResult>;

export async function runReviewReducerFailOpen(params: {
  reducer: ReviewReducerRuntime;
  input: ReviewReducerInput;
  graphValidationEnabled: boolean;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): Promise<ReviewReducerResult> {
  let reducerResult: ReviewReducerResult;
  try {
    const candidateReducerResult = await params.reducer(params.input);
    if (!isTrustedReviewReducerResult(candidateReducerResult)) {
      throw new Error("malformed-review-reducer-result");
    }
    reducerResult = candidateReducerResult;
  } catch (err) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-reducer",
        gateResult: "degraded",
        reason: "reducer-exception",
        err,
      },
      "Review reducer failed unexpectedly (fail-open, destructive cleanup disabled)",
    );
    reducerResult = createDegradedReviewReducerResult({
      findings: params.input.findings,
      reason: "reducer-exception",
    });
  }

  logReviewReducerResult({
    logger: params.logger,
    baseLog: params.baseLog,
    reducerResult,
    graphValidationEnabled: params.graphValidationEnabled,
  });

  return reducerResult;
}
