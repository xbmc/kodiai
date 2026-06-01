import { describe, expect, test } from "bun:test";
import { hasTrustedReviewReducerCounts, isTrustedReviewReducerResult } from "./review-reducer-log.ts";

describe("review reducer log helpers", () => {
  test("accepts trusted reducer count payloads", () => {
    expect(hasTrustedReviewReducerCounts({
      input: 1,
      kept: 1,
      suppressed: 0,
      rewritten: 0,
      deprioritized: 0,
      lowConfidence: 0,
      auditEvents: 0,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    })).toBe(true);
  });

  test("rejects malformed reducer results", () => {
    expect(isTrustedReviewReducerResult(null)).toBe(false);
    expect(isTrustedReviewReducerResult({ status: "ready" })).toBe(false);
  });
});
