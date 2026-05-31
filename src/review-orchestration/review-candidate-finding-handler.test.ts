import { describe, expect, test } from "bun:test";
import {
  resolveReviewCandidateFindingResult,
  sanitizeReviewCandidateReason,
} from "./review-candidate-finding-handler.ts";

describe("review candidate finding handler helpers", () => {
  test("sanitizes unsafe candidate reasons", () => {
    expect(sanitizeReviewCandidateReason("sk-abc123 leaked token")).toBe("redacted-leaked-token");
  });

  test("returns unavailable result when candidate metadata is missing", () => {
    const result = resolveReviewCandidateFindingResult({
      candidateFinding: null,
      repo: "kodiai",
      pullNumber: 1,
      reviewOutputKey: "output-1",
      deliveryId: "delivery-1",
    });

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("candidate-metadata-missing");
  });
});
