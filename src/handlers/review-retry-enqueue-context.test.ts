import { describe, expect, test } from "bun:test";
import type { ScheduleContinuationDecision, SkipContinuationDecision } from "../lib/review-continuation-lifecycle.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import { resolveReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";

const firstPass: ReviewFirstPassPayload = {
  state: "bounded-first-pass",
  boundedReason: "timeout",
  evidenceSource: "checkpoint",
  publication: { eligible: true, hasPublishedOutput: false },
  continuationPending: true,
  zeroEvidenceFailure: false,
};

function schedulePlan(overrides: Partial<ScheduleContinuationDecision> = {}): ScheduleContinuationDecision {
  return {
    decision: "schedule-continuation",
    reason: "remaining-scope-available",
    reviewOutputKey: "review-key",
    continuationReviewOutputKey: "review-key-retry-1",
    continuationNumber: 1,
    continuationFiles: ["src/b.ts", "src/c.ts"],
    scopeRatio: 0.75,
    timeoutSeconds: 240,
    checkpointEnabled: true,
    timeoutEstimate: {
      riskLevel: "medium",
      dynamicTimeoutSeconds: 60,
      reasoning: "test estimate",
      shouldReduceScope: false,
    },
    firstPass,
    checkpoint: null,
    ...overrides,
  };
}

describe("resolveReviewRetryEnqueueContext", () => {
  test("projects scheduled retry plan fields used by enqueue, logging, and telemetry", () => {
    const context = resolveReviewRetryEnqueueContext({
      deliveryId: "delivery-123",
      retryPlan: schedulePlan(),
    });

    expect(context).toEqual({
      retryReviewOutputKey: "review-key-retry-1",
      retryTimeout: 240,
      retryFiles: ["src/b.ts", "src/c.ts"],
      retryTimeoutEstimate: {
        riskLevel: "medium",
        dynamicTimeoutSeconds: 60,
        reasoning: "test estimate",
        shouldReduceScope: false,
      },
      retryCheckpointEnabled: true,
      retryScopeRatio: 0.75,
      retryDeliveryId: "delivery-123-retry-1",
    });
  });

  test("returns null when retry plan is absent or skipped", () => {
    const skipped: SkipContinuationDecision = {
      decision: "skip-continuation",
      reason: "chronic-timeout",
      reviewOutputKey: "review-key",
      firstPass,
    };

    expect(resolveReviewRetryEnqueueContext({ deliveryId: "delivery-123", retryPlan: null })).toBeNull();
    expect(resolveReviewRetryEnqueueContext({ deliveryId: "delivery-123", retryPlan: skipped })).toBeNull();
  });
});
