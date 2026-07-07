import { describe, expect, test } from "bun:test";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import { resolveReviewTimeoutContinuationState } from "./review-timeout-continuation-state.ts";

function zeroEvidenceFirstPass(): ReviewFirstPassPayload {
  return {
    state: "zero-evidence-failure",
    boundedReason: "timeout",
    evidenceSource: "none",
    publication: { eligible: false, hasPublishedOutput: false },
    continuationPending: false,
    zeroEvidenceFailure: true,
  };
}

function boundedFirstPass(): ReviewFirstPassPayload {
  return {
    state: "bounded-first-pass",
    boundedReason: "timeout",
    evidenceSource: "checkpoint",
    publication: { eligible: true, hasPublishedOutput: false },
    continuationPending: true,
    zeroEvidenceFailure: false,
  };
}

describe("resolveReviewTimeoutContinuationState", () => {
  test("warns for zero-evidence first pass and marks non-retry continuation family blocked", () => {
    const state = resolveReviewTimeoutContinuationState({
      attemptId: "attempt-1",
      timeoutFirstPass: zeroEvidenceFirstPass(),
      retryScheduled: false,
      continuationProjectionDegraded: false,
    });

    expect(state.zeroEvidenceWarning).toEqual({
      boundedReason: "timeout",
      evidenceSource: "none",
      zeroEvidenceFailure: true,
    });
    expect(state.blockedFamilyState).toEqual({
      authoritativeAttemptId: "attempt-1",
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "canonical",
    });
  });

  test("uses degraded projection status when timeout telemetry projection degraded", () => {
    const state = resolveReviewTimeoutContinuationState({
      attemptId: "attempt-1",
      timeoutFirstPass: boundedFirstPass(),
      retryScheduled: false,
      continuationProjectionDegraded: true,
    });

    expect(state.zeroEvidenceWarning).toBeNull();
    expect(state.blockedFamilyState?.projectionStatus).toBe("degraded");
  });

  test("does not mark the family blocked when a retry continuation is scheduled", () => {
    const state = resolveReviewTimeoutContinuationState({
      attemptId: "attempt-1",
      timeoutFirstPass: boundedFirstPass(),
      retryScheduled: true,
      continuationProjectionDegraded: true,
    });

    expect(state.zeroEvidenceWarning).toBeNull();
    expect(state.blockedFamilyState).toBeNull();
  });
});
