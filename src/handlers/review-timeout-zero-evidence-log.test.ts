import { describe, expect, mock, test } from "bun:test";
import { logReviewTimeoutZeroEvidenceWarning } from "./review-timeout-zero-evidence-log.ts";

describe("logReviewTimeoutZeroEvidenceWarning", () => {
  test("logs zero-evidence timeout warning fields", () => {
    const logger = { warn: mock(() => {}) };

    logReviewTimeoutZeroEvidenceWarning({
      logger,
      deliveryId: "delivery-1",
      prNumber: 42,
      reviewOutputKey: "owner/repo#42:abc123",
      zeroEvidenceWarning: {
        boundedReason: "timeout",
        evidenceSource: "none",
        zeroEvidenceFailure: true,
      },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        deliveryId: "delivery-1",
        prNumber: 42,
        boundedReason: "timeout",
        evidenceSource: "none",
        zeroEvidenceFailure: true,
        reviewOutputKey: "owner/repo#42:abc123",
      },
      "Constrained timeout remained a zero-evidence hard failure",
    );
  });
});
