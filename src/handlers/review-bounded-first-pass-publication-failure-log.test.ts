import { describe, expect, mock, test } from "bun:test";
import { logBoundedFirstPassPublicationFailure } from "./review-bounded-first-pass-publication-failure-log.ts";

describe("logBoundedFirstPassPublicationFailure", () => {
  test("logs bounded first-pass publication failure fields", () => {
    const logger = { warn: mock(() => {}) };
    const error = new Error("publication failed");

    logBoundedFirstPassPublicationFailure({
      logger,
      error,
      deliveryId: "delivery-1",
      prNumber: 42,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: error,
        deliveryId: "delivery-1",
        prNumber: 42,
      },
      "Failed to publish bounded first-pass review",
    );
  });
});
