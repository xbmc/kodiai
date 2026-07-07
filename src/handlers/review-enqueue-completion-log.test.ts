import { describe, expect, mock, test } from "bun:test";
import { logReviewEnqueueCompleted } from "./review-enqueue-completion-log.ts";

describe("logReviewEnqueueCompleted", () => {
  test("logs enqueue completion with base fields", () => {
    const logger = { info: mock(() => {}) };

    logReviewEnqueueCompleted({
      logger,
      baseLog: {
        deliveryId: "delivery-1",
        prNumber: 42,
      },
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        deliveryId: "delivery-1",
        prNumber: 42,
        gate: "enqueue",
        gateResult: "completed",
      },
      "Review enqueue completed",
    );
  });
});
