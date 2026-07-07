import type {
  ContinuationFamilyAuthoritativeOutcome,
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
} from "../knowledge/types.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";

export type ReviewTimeoutZeroEvidenceWarning = {
  boundedReason: ReviewFirstPassPayload["boundedReason"];
  evidenceSource: ReviewFirstPassPayload["evidenceSource"];
  zeroEvidenceFailure: true;
};

export type ReviewTimeoutBlockedFamilyState = {
  authoritativeAttemptId: string;
  authoritativeOutcome: ContinuationFamilyAuthoritativeOutcome;
  finalStopReason: ContinuationFamilyFinalStopReason;
  projectionStatus: ContinuationFamilyProjectionStatus;
};

export type ReviewTimeoutContinuationState = {
  zeroEvidenceWarning: ReviewTimeoutZeroEvidenceWarning | null;
  blockedFamilyState: ReviewTimeoutBlockedFamilyState | null;
};

export function resolveReviewTimeoutContinuationState(params: {
  attemptId: string;
  timeoutFirstPass: ReviewFirstPassPayload | null;
  retryScheduled: boolean;
  continuationProjectionDegraded: boolean;
}): ReviewTimeoutContinuationState {
  return {
    zeroEvidenceWarning: params.timeoutFirstPass?.state === "zero-evidence-failure"
      ? {
          boundedReason: params.timeoutFirstPass.boundedReason,
          evidenceSource: params.timeoutFirstPass.evidenceSource,
          zeroEvidenceFailure: true,
        }
      : null,
    blockedFamilyState: params.retryScheduled
      ? null
      : {
          authoritativeAttemptId: params.attemptId,
          authoritativeOutcome: "blocked",
          finalStopReason: "no-follow-up",
          projectionStatus: params.continuationProjectionDegraded ? "degraded" : "canonical",
        },
  };
}
