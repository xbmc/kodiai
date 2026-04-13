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

  it("renders total wall-clock time and the six required phases in stable order", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: 2500,
        phases: [
          { name: "publication", status: "completed", durationMs: 400 },
          { name: "remote runtime", status: "completed", durationMs: 1200 },
          { name: "executor handoff", status: "completed", durationMs: 50 },
          { name: "retrieval/context assembly", status: "completed", durationMs: 300 },
          { name: "workspace preparation", status: "completed", durationMs: 200 },
          { name: "queue wait", status: "completed", durationMs: 350 },
        ],
      },
    });

    expect(result).toContain("- Total wall-clock: 2.5s");
    expect(result).toContain("- Phase timings:");

    const orderedLines = [
      "queue wait: 350ms",
      "workspace preparation: 200ms",
      "retrieval/context assembly: 300ms",
      "executor handoff: 50ms",
      "remote runtime: 1.2s",
      "publication: 400ms",
    ];

    let lastIndex = -1;
    for (const line of orderedLines) {
      const nextIndex = result.indexOf(line);
      expect(nextIndex).toBeGreaterThan(lastIndex);
      lastIndex = nextIndex;
    }
  });

  it("renders degraded and unavailable wording for malformed or missing phase timings instead of throwing", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: 3100,
        phases: [
          { name: "publication", status: "degraded", durationMs: 120, detail: "captured before publication completed" },
          { name: "remote runtime", status: "completed", durationMs: 800 },
          { name: "executor handoff", status: "completed", durationMs: 50 },
          { name: "workspace preparation", status: "bogus", durationMs: 200 } as never,
          { name: "queue wait", status: "completed", durationMs: Number.NaN } as never,
        ],
      },
    });

    expect(result).toContain("queue wait: unavailable (invalid phase timing data)");
    expect(result).toContain("workspace preparation: unavailable (invalid phase timing data)");
    expect(result).toContain("retrieval/context assembly: unavailable (phase timing unavailable)");
    expect(result).toContain("executor handoff: 50ms");
    expect(result).toContain("remote runtime: 800ms");
    expect(result).toContain("publication: 120ms (degraded: captured before publication completed)");
  });
});
