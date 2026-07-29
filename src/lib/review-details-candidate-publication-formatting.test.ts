import { describe, expect, test } from "bun:test";
import { formatReviewCandidatePublicationDetailsLine } from "./review-details-candidate-publication-formatting.ts";
import type { ReviewCandidatePublicationRuntimeDetailsSummary } from "../review-orchestration/review-candidate-publication-runtime.ts";

function baseCounts() {
  return {
    approvedReferences: 0,
    rewrittenReferences: 0,
    candidatePublishable: 0,
    candidatePublished: 0,
    candidateSkipped: 0,
    candidateBlocked: 1,
    candidateFailed: 0,
    candidateMalformed: 0,
    candidateMovedToDetails: 0,
    candidateDetailsOnlyFindings: 0,
    candidateDetailsOnlyOmitted: 0,
    fixEligibilityBlocked: 0,
    nonPublishableReferences: 0,
    convertedProcessedFindings: 0,
    directAttempted: 0,
    directPublished: 0,
    fallbackEvidence: 0,
    fallbackDisallowed: 0,
    malformed: 0,
  };
}

describe("formatReviewCandidatePublicationDetailsLine", () => {
  test("redacts secret-shaped bucket reasons the same way as top-level reasons", () => {
    const summary: ReviewCandidatePublicationRuntimeDetailsSummary = {
      label: "Review candidate publication runtime",
      text: "present",
      mode: "blocked",
      counts: baseCounts(),
      reasons: ["approval-blocked"],
      outcomeBuckets: {
        blocked: {
          mode: "blocked",
          count: 1,
          reasons: ["sk-abcdef1234567890abcdef1234567890"],
        },
      },
    };

    const lines = formatReviewCandidatePublicationDetailsLine(summary);
    const rendered = lines.join("\n");
    expect(rendered).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(rendered).toContain("buckets=");
  });

  test("redacts a ghp_ token shaped bucket reason", () => {
    const summary: ReviewCandidatePublicationRuntimeDetailsSummary = {
      label: "Review candidate publication runtime",
      text: "present",
      mode: "blocked",
      counts: baseCounts(),
      reasons: ["approval-blocked"],
      outcomeBuckets: {
        blocked: {
          mode: "blocked",
          count: 1,
          reasons: ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
        },
      },
    };

    const lines = formatReviewCandidatePublicationDetailsLine(summary);
    const rendered = lines.join("\n");
    expect(rendered).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  test("keeps a normal bucket reason visible", () => {
    const summary: ReviewCandidatePublicationRuntimeDetailsSummary = {
      label: "Review candidate publication runtime",
      text: "present",
      mode: "blocked",
      counts: baseCounts(),
      reasons: ["approval-blocked"],
      outcomeBuckets: {
        blocked: {
          mode: "blocked",
          count: 1,
          reasons: ["approval-blocked"],
        },
      },
    };

    const lines = formatReviewCandidatePublicationDetailsLine(summary);
    const rendered = lines.join("\n");
    expect(rendered).toContain("approval-blocked");
  });
});
