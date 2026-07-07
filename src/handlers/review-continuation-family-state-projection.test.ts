import { describe, expect, test } from "bun:test";
import {
  resolveMergedContinuationFamilyState,
  resolvePendingContinuationFamilyState,
  resolveQuietSettledContinuationFamilyState,
} from "./review-continuation-family-state-projection.ts";

describe("review continuation family state projections", () => {
  test("projects a scheduled retry as pending continuation state", () => {
    expect(resolvePendingContinuationFamilyState({
      attemptId: "attempt-1",
      reviewOutputKey: "retry-key",
    })).toEqual({
      authoritativeAttemptId: "attempt-1",
      authoritativeOutcome: "continuation-pending",
      finalStopReason: "awaiting-continuation",
      projectionStatus: "pending",
      reviewOutputKey: "retry-key",
    });
  });

  test("projects a retry with no meaningful delta as quiet-settled canonical state", () => {
    expect(resolveQuietSettledContinuationFamilyState({
      attemptId: "attempt-2",
      reviewOutputKey: "retry-key",
    })).toEqual({
      authoritativeAttemptId: "attempt-2",
      authoritativeOutcome: "quiet-settled",
      finalStopReason: "settled-without-update",
      projectionStatus: "canonical",
      reviewOutputKey: "retry-key",
    });
  });

  test("projects a merged retry with the publication projection status", () => {
    expect(resolveMergedContinuationFamilyState({
      attemptId: "attempt-3",
      projectionStatus: "degraded",
      reviewOutputKey: "retry-key",
    })).toEqual({
      authoritativeAttemptId: "attempt-3",
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "degraded",
      reviewOutputKey: "retry-key",
    });
  });
});
