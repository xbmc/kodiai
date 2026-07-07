import { describe, expect, test } from "bun:test";
import type { ProcessedReviewFinding, ReviewReducerResult } from "../review-orchestration/review-reducer.ts";
import type { ReviewCandidatePublishedFindingResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import { resolveReviewFindingPublicationContext } from "./review-finding-publication-context.ts";

function finding(overrides: Partial<ProcessedReviewFinding> = {}): ProcessedReviewFinding {
  return {
    commentId: overrides.commentId ?? 1,
    filePath: overrides.filePath ?? "src/app.ts",
    title: overrides.title ?? "Finding",
    body: overrides.body ?? "Body",
    severity: overrides.severity ?? "medium",
    category: overrides.category ?? "correctness",
    confidence: overrides.confidence ?? 80,
    suppressed: overrides.suppressed ?? false,
    ...overrides,
  };
}

function reducer(overrides: Partial<ReviewReducerResult> = {}): ReviewReducerResult {
  const direct = finding({ commentId: 10, title: "direct" });
  const draft = finding({
    commentId: 11,
    title: "draft",
    candidateFingerprint: "candidate-draft",
    candidatePublicationDraft: true,
  });
  return {
    status: "ready",
    findings: [direct, draft],
    visibleFindings: [direct, draft],
    filteredInlineFindings: [draft],
    lowConfidenceFindings: [draft],
    suppressionMatchCounts: new Map([["exact", 1]]),
    filterRecords: [{
      commentId: 11,
      originalTitle: "draft",
      action: "suppressed",
      reason: "candidate-draft",
      classificationEvidence: [],
    }],
    prioritizationStats: {
      findingsScored: 2,
      topScore: 10,
      thresholdScore: 5,
      selectedFindings: 1,
      omittedFindings: 1,
    },
    detailsSummary: { label: "Review reducer", text: "summary", status: "ready" },
    ...overrides,
  } as ReviewReducerResult;
}

function publishedCandidate(): ReviewCandidatePublishedFindingResult {
  return {
    findings: [
      finding({
        commentId: 101,
        title: "published candidate",
        candidateFingerprint: "candidate-published",
        candidatePublicationLifecycle: "approved",
        publicationStatus: "published",
      }),
    ],
    detailsOnlyFindings: [],
    summary: {
      counts: {
        input: 1,
        processed: 1,
        skipped: 0,
        blocked: 0,
        failed: 0,
        malformed: 0,
      },
      results: [{
        fingerprint: "candidate-published",
        status: "published",
        reason: "published",
        commentId: 101,
      }],
    },
  };
}

describe("resolveReviewFindingPublicationContext", () => {
  test("drops unpublished candidate drafts and merges published candidate findings", () => {
    const context = resolveReviewFindingPublicationContext({
      reducer: reducer(),
      candidatePublishedFindings: publishedCandidate(),
      adapterDetailsSummary: {
        label: "Review candidate publication adapter",
        text: "adapter summary",
      },
    });

    expect(context.processedFindings.map((item) => item.title)).toEqual(["direct", "published candidate"]);
    expect(context.visibleFindings.map((item) => item.title)).toEqual(["direct", "published candidate"]);
    expect(context.lowConfidenceFindings).toEqual([]);
    expect(context.filteredInlineFindings).toEqual([]);
    expect([...context.suppressionMatchCounts.entries()]).toEqual([["exact", 1]]);
    expect(context.filterResult).toEqual({
      filtered: [{
        commentId: 11,
        originalTitle: "draft",
        action: "suppressed",
        reason: "candidate-draft",
        classificationEvidence: [],
      }],
    });
    expect(context.reviewReducerDetailsSummary).toEqual({ label: "Review reducer", text: "summary", status: "ready" });
    expect(context.reviewCandidatePublicationAdapterDetailsSummary).toEqual({
      label: "Review candidate publication adapter",
      text: "adapter summary",
    });
  });
});
