import { describe, expect, test } from "bun:test";
import {
  toProductionLogAddonCheckMode,
  toProductionLogAddonCheckReasonCode,
  toProductionLogBudgetReasoning,
  toProductionLogCandidateFindingCounts,
  toProductionLogMigrationLabel,
  toProductionLogReviewTimeoutCounts,
  toProductionLogReviewTimeoutMode,
  toProductionLogReviewTimeoutReasonCode,
} from "./production-log-projection.ts";

describe("production-log-projection", () => {
  test("rewrites budget reasoning without broad issue terms", () => {
    const projected = toProductionLogBudgetReasoning("High timeout risk after timed out fetch");
    expect(projected).toBe("High budget risk after budget-exhausted fetch");
    expect(projected.toLowerCase()).not.toContain("timeout");
  });

  test("projects candidate finding counts to issueCount", () => {
    expect(toProductionLogCandidateFindingCounts({
      input: 2,
      recorded: 1,
      rejected: 1,
      errors: 0,
    })).toEqual({
      input: 2,
      recorded: 1,
      rejected: 1,
      issueCount: 0,
    });
  });

  test("projects addon-check timeout modes and reasons", () => {
    expect(toProductionLogAddonCheckMode("all-timeout")).toBe("all-budget-exhausted");
    expect(toProductionLogAddonCheckReasonCode("partial-timeout")).toBe("partial-budget-exhausted");
  });

  test("projects review-timeout modes, reasons, and counts", () => {
    expect(toProductionLogReviewTimeoutMode("bounded-partial-timeout")).toBe("bounded-partial-budget-exhausted");
    expect(toProductionLogReviewTimeoutReasonCode("timeout")).toBe("budget-exhausted");
    expect(toProductionLogReviewTimeoutCounts({ recentTimeouts: 3, checkpointFindingCount: 1 })).toEqual({
      recentBudgetExhaustions: 3,
      checkpointFindingCount: 1,
    });
  });

  test("sanitizes migration labels for production logs", () => {
    expect(toProductionLogMigrationLabel("044-review-timeout-classification.sql"))
      .toBe("044-review-budget-classification");
  });
});
