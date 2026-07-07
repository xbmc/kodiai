import { describe, expect, test } from "bun:test";
import { resolveReviewDetailsRuntimeContext } from "./review-details-runtime-context.ts";

describe("resolveReviewDetailsRuntimeContext", () => {
  test("counts findings, suppressions, line counts, and operational Review Details signal", () => {
    const context = resolveReviewDetailsRuntimeContext({
      processedFindings: [
        { severity: "critical", suppressed: false },
        { severity: "major", suppressed: true },
        { severity: "major", suppressed: false },
        { severity: "minor", suppressed: false },
      ],
      filteredInlineFindings: [],
      diffLinesAdded: 12,
      diffLinesRemoved: 8,
      prApiLinesAdded: 100,
      prApiLinesRemoved: 50,
      reviewPlanDetailsSummary: { text: "Review plan: ready doctrine=skipped" },
      reviewCandidatePublicationRuntime: {
        mode: "blocked",
        reasons: ["approval-blocked", "no-candidate-publication-path"],
      },
    });

    expect(context.findingCounts).toEqual({
      critical: 1,
      major: 2,
      medium: 0,
      minor: 1,
    });
    expect(context.suppressionsApplied).toBe(1);
    expect(context.reviewDetailsLineCounts).toEqual({
      linesAdded: 12,
      linesRemoved: 8,
      source: "local-diff",
    });
    expect(context.linesChanged).toBe(20);
    expect(context.hasReviewDetailsOperationalSignal).toBe(true);
  });

  test("uses PR API line counts when local diff counts are unavailable", () => {
    const context = resolveReviewDetailsRuntimeContext({
      processedFindings: [],
      filteredInlineFindings: [],
      diffLinesAdded: 0,
      diffLinesRemoved: 0,
      prApiLinesAdded: 3,
      prApiLinesRemoved: 4,
      reviewPlanDetailsSummary: { text: "Review plan: ready doctrine=skipped" },
      reviewCandidatePublicationRuntime: {
        mode: "blocked",
        reasons: ["approval-blocked", "no-candidate-publication-path"],
      },
    });

    expect(context.reviewDetailsLineCounts).toEqual({
      linesAdded: 3,
      linesRemoved: 4,
      source: "github-pr-api-fallback",
    });
    expect(context.linesChanged).toBe(7);
    expect(context.hasReviewDetailsOperationalSignal).toBe(false);
  });

  test("treats doctrine and non-default candidate publication modes as operational signals", () => {
    const doctrineContext = resolveReviewDetailsRuntimeContext({
      processedFindings: [],
      filteredInlineFindings: [],
      diffLinesAdded: 1,
      diffLinesRemoved: 0,
      prApiLinesAdded: 0,
      prApiLinesRemoved: 0,
      reviewPlanDetailsSummary: { text: "Review plan: ready doctrine=applied/1/0/0" },
      reviewCandidatePublicationRuntime: {
        mode: "blocked",
        reasons: ["approval-blocked", "no-candidate-publication-path"],
      },
    });
    const candidateRuntimeContext = resolveReviewDetailsRuntimeContext({
      processedFindings: [],
      filteredInlineFindings: [],
      diffLinesAdded: 1,
      diffLinesRemoved: 0,
      prApiLinesAdded: 0,
      prApiLinesRemoved: 0,
      reviewPlanDetailsSummary: { text: "Review plan: ready doctrine=skipped" },
      reviewCandidatePublicationRuntime: {
        mode: "candidate-approved",
        reasons: ["candidate-publisher-published"],
      },
    });

    expect(doctrineContext.hasReviewDetailsOperationalSignal).toBe(true);
    expect(candidateRuntimeContext.hasReviewDetailsOperationalSignal).toBe(true);
  });
});
