import { describe, expect, mock, test } from "bun:test";
import { logBoundedFirstPassReviewPublished } from "./review-bounded-first-pass-evidence.ts";

describe("logBoundedFirstPassReviewPublished", () => {
  test("logs timeout bounded-first-pass evidence fields", () => {
    const logger = { info: mock(() => {}) };

    logBoundedFirstPassReviewPublished({
      logger,
      deliveryId: "delivery-1",
      prNumber: 42,
      partialCommentId: 101,
      boundedReason: "timeout-budget",
      evidenceSource: "checkpoint",
      coveredFiles: 1,
      inspectedFiles: 3,
      remainingFiles: 4,
      findingCount: 2,
      hasPartialResults: true,
      isChronicTimeout: false,
      recentTimeouts: 1,
      retryState: "scheduled",
      zeroEvidenceFailure: false,
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        deliveryId: "delivery-1",
        prNumber: 42,
        partialCommentId: 101,
        boundedReason: "timeout-budget",
        evidenceSource: "checkpoint",
        coveredFiles: 1,
        inspectedFiles: 3,
        remainingFiles: 4,
        findingCount: 2,
        hasPartialResults: true,
        isChronicTimeout: false,
        recentTimeouts: 1,
        retryState: "scheduled",
        zeroEvidenceFailure: false,
      },
      "Published bounded first-pass review on timeout",
    );
  });
});
