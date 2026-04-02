import { describe, it, expect } from "bun:test";
import { formatReviewDetailsSummary } from "./review-utils.ts";

// Minimal valid params shared across all tests
const BASE_PARAMS = {
  reviewOutputKey: "test-key-001",
  filesReviewed: 3,
  linesAdded: 50,
  linesRemoved: 10,
  findingCounts: { critical: 0, major: 1, medium: 2, minor: 0 },
  profileSelection: {
    selectedProfile: "balanced" as const,
    source: "auto" as const,
    linesChanged: 60,
    autoBand: null,
  },
};

describe("formatReviewDetailsSummary", () => {
  it("renders usage line when usageLimit is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      usageLimit: {
        utilization: 0.75,
        rateLimitType: "seven_day",
        resetsAt: 1735000000,
      },
    });

    expect(result).toContain("75% of seven_day limit");
    expect(result).toContain("resets ");

    // Calling without usageLimit should not contain the usage line
    const resultWithout = formatReviewDetailsSummary({ ...BASE_PARAMS });
    expect(resultWithout).not.toContain("Claude Code usage");
  });

  it("renders token line when tokenUsage is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.0123,
      },
    });

    expect(result).toContain("in /");
    expect(result).toContain("out");
    expect(result).toContain("0.0123");
  });

  it("omits usage and token lines when fields absent", () => {
    const result = formatReviewDetailsSummary({ ...BASE_PARAMS });

    expect(result).not.toContain("Claude Code usage:");
    expect(result).not.toContain("Tokens:");
  });
});
