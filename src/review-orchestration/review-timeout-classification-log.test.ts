import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ReviewTimeoutClassificationResult } from "./review-timeout-classification.ts";
import { logReviewTimeoutClassification } from "./review-timeout-classification-log.ts";

function createCaptureLogger() {
  const entries: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const logger = {
    info: (bindings: Record<string, unknown>, message: string) => {
      entries.push({ bindings, message });
    },
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return { logger: logger as unknown as Logger, entries };
}

const sampleClassification: ReviewTimeoutClassificationResult = {
  gate: "review-timeout-classification",
  classification: "expected-bounded-outcome",
  mode: "bounded-partial-timeout",
  reasonCodes: ["partial-timeout", "checkpoint-present"],
  expectedBoundedOutcome: true,
  hardFailure: false,
  counts: {
    checkpointFilesReviewed: 2,
    checkpointFilesInspected: 2,
    recentTimeouts: 1,
  },
  redaction: {
    rawPayloadOmitted: true,
    boundedReasonCodes: true,
    unsafeInputOmitted: false,
    rawCanaryDetected: false,
  },
};

describe("logReviewTimeoutClassification", () => {
  test("projects production-safe log fields and returns internal telemetry", () => {
    const { logger, entries } = createCaptureLogger();

    const telemetry = logReviewTimeoutClassification({
      logger,
      baseLog: { repo: "xbmc/repo-plugins", prNumber: 42 },
      classification: sampleClassification,
      deliveryId: "delivery-1",
      reviewOutputKey: "rk_test",
      prNumber: 42,
      chronicBudgetExhaustion: false,
      retryEnqueued: false,
    });

    expect(telemetry).toEqual({
      timeoutClassification: "expected-bounded-outcome",
      timeoutClassificationMode: "bounded-partial-timeout",
      timeoutClassificationReasons: ["partial-timeout", "checkpoint-present"],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("Review budget classification");
    expect(entries[0]!.bindings).toMatchObject({
      gate: "review-timeout-classification",
      gateResult: "expected-bounded-outcome",
      mode: "bounded-partial-budget-exhausted",
      reasonCodes: ["partial-budget-exhausted", "checkpoint-present"],
      recentBudgetExhaustions: 1,
      chronicBudgetExhaustion: false,
      retryEnqueued: false,
    });
    expect(entries[0]!.bindings.classification).toBeUndefined();
    expect(entries[0]!.bindings.mode).toBe("bounded-partial-budget-exhausted");
    expect(entries[0]!.bindings.reasonCodes).toEqual(["partial-budget-exhausted", "checkpoint-present"]);
  });
});
