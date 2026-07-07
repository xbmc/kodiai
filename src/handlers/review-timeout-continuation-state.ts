import type {
  ContinuationFamilyAuthoritativeOutcome,
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
} from "../knowledge/types.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import { logReviewTimeoutZeroEvidenceWarning } from "./review-timeout-zero-evidence-log.ts";

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

export async function applyReviewTimeoutContinuationStateSideEffects(params: {
  attemptId: string;
  timeoutFirstPass: ReviewFirstPassPayload | null;
  retryScheduled: boolean;
  continuationProjectionDegraded: boolean;
  logger: Parameters<typeof logReviewTimeoutZeroEvidenceWarning>[0]["logger"];
  deliveryId: string;
  prNumber: number;
  reviewOutputKey: string;
  persistContinuationFamilyState: (state: ReviewTimeoutBlockedFamilyState) => Promise<void>;
}): Promise<void> {
  const timeoutContinuationState = resolveReviewTimeoutContinuationState({
    attemptId: params.attemptId,
    timeoutFirstPass: params.timeoutFirstPass,
    retryScheduled: params.retryScheduled,
    continuationProjectionDegraded: params.continuationProjectionDegraded,
  });

  if (timeoutContinuationState.zeroEvidenceWarning) {
    logReviewTimeoutZeroEvidenceWarning({
      logger: params.logger,
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      zeroEvidenceWarning: timeoutContinuationState.zeroEvidenceWarning,
    });
  }

  if (timeoutContinuationState.blockedFamilyState) {
    await params.persistContinuationFamilyState(timeoutContinuationState.blockedFamilyState);
  }
}
