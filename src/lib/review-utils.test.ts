import { describe, it, expect } from "bun:test";
import { formatReviewDetailsSummary } from "./review-utils.ts";
import { projectContributorExperienceContract } from "../contributor/experience-contract.ts";

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
  contributorExperience: projectContributorExperienceContract({
    source: "author-cache",
    tier: "regular",
  }).reviewDetails,
};

describe("formatReviewDetailsSummary", () => {
  it("renders contributor-experience contract wording without raw tier leakage", () => {
    const cases = [
      {
        projection: projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "established",
        }).reviewDetails,
        expected:
          "- Contributor experience: profile-backed (using linked contributor profile guidance)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "author-cache",
          tier: "regular",
        }).reviewDetails,
        expected:
          "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "none",
          tier: null,
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-unknown (no reliable contributor signal available)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "senior",
          optedOut: true,
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-opt-out (contributor-specific guidance disabled by opt-out)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "github-search",
          tier: "regular",
          degraded: true,
          degradationPath: "search-api-rate-limit",
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-degraded (fallback signals unavailable: search-api-rate-limit)",
      },
    ];

    for (const testCase of cases) {
      const result = formatReviewDetailsSummary({
        ...BASE_PARAMS,
        contributorExperience: testCase.projection,
      });

      expect(result).toContain(testCase.expected);
      expect(result).not.toContain("- Author tier:");
      expect(result).not.toContain("developing guidance");
      expect(result).not.toContain("established contributor guidance");
      expect(result).not.toContain("senior contributor guidance");
    }
  });

  it("renders usage line when usageLimit is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      usageLimit: {
        utilization: 0.75,
        rateLimitType: "seven_day",
        resetsAt: 1735000000,
      },
    });

    expect(result).toContain("25% of seven_day limit remaining");
    expect(result).toContain("resets ");

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
