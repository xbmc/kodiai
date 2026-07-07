import { describe, expect, mock, test } from "bun:test";
import { logReviewTimeoutRetryEnqueue } from "./review-timeout-retry-enqueue-log.ts";

describe("logReviewTimeoutRetryEnqueue", () => {
  test("logs retry enqueue evidence fields", () => {
    const logger = { info: mock(() => {}) };

    logReviewTimeoutRetryEnqueue({
      logger,
      deliveryId: "delivery-1",
      prNumber: 42,
      retryFiles: 3,
      scopeRatio: 0.5,
      retryTimeout: 120,
      retryRiskLevel: "medium",
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        deliveryId: "delivery-1",
        prNumber: 42,
        retryFiles: 3,
        scopeRatio: 0.5,
        retryTimeout: 120,
        retryRiskLevel: "medium",
      },
      "Enqueueing retry with reduced scope",
    );
  });
});
