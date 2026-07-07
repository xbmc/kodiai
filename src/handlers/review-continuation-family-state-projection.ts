import type {
  ContinuationFamilyAuthoritativeOutcome,
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
} from "../knowledge/types.ts";

type ReviewContinuationFamilyStateProjection = {
  authoritativeAttemptId: string;
  authoritativeOutcome: ContinuationFamilyAuthoritativeOutcome;
  finalStopReason: ContinuationFamilyFinalStopReason;
  projectionStatus: ContinuationFamilyProjectionStatus;
  reviewOutputKey: string;
};

type BaseProjectionParams = {
  attemptId: string;
  reviewOutputKey: string;
};

function buildContinuationFamilyStateProjection(
  params: BaseProjectionParams & {
    authoritativeOutcome: ContinuationFamilyAuthoritativeOutcome;
    finalStopReason: ContinuationFamilyFinalStopReason;
    projectionStatus: ContinuationFamilyProjectionStatus;
  },
): ReviewContinuationFamilyStateProjection {
  return {
    authoritativeAttemptId: params.attemptId,
    authoritativeOutcome: params.authoritativeOutcome,
    finalStopReason: params.finalStopReason,
    projectionStatus: params.projectionStatus,
    reviewOutputKey: params.reviewOutputKey,
  };
}

export function resolvePendingContinuationFamilyState(
  params: BaseProjectionParams,
): ReviewContinuationFamilyStateProjection {
  return buildContinuationFamilyStateProjection({
    ...params,
    authoritativeOutcome: "continuation-pending",
    finalStopReason: "awaiting-continuation",
    projectionStatus: "pending",
  });
}

export function resolveQuietSettledContinuationFamilyState(
  params: BaseProjectionParams,
): ReviewContinuationFamilyStateProjection {
  return buildContinuationFamilyStateProjection({
    ...params,
    authoritativeOutcome: "quiet-settled",
    finalStopReason: "settled-without-update",
    projectionStatus: "canonical",
  });
}

export function resolveMergedContinuationFamilyState(
  params: BaseProjectionParams & {
    projectionStatus: ContinuationFamilyProjectionStatus;
  },
): ReviewContinuationFamilyStateProjection {
  return buildContinuationFamilyStateProjection({
    ...params,
    authoritativeOutcome: "merged",
    finalStopReason: "merged-continuation-results",
    projectionStatus: params.projectionStatus,
  });
}
