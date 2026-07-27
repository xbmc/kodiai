import { describe, expect, test } from "bun:test";
import { willBlockedReviewFindingsNoticePublish } from "./review-blocked-findings-notice.ts";
import type {
  ReviewCandidatePublicationRuntimeCounts,
  ReviewCandidatePublicationRuntimeResult,
} from "../review-orchestration/review-candidate-publication-runtime.ts";

function baseCounts(
  overrides: Partial<ReviewCandidatePublicationRuntimeCounts> = {},
): ReviewCandidatePublicationRuntimeCounts {
  return {
    approvedReferences: 0,
    rewrittenReferences: 0,
    candidatePublishable: 0,
    candidatePublished: 0,
    candidateSkipped: 0,
    candidateBlocked: 0,
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
    ...overrides,
  };
}

function baseRuntime(
  overrides: Partial<ReviewCandidatePublicationRuntimeResult> = {},
): ReviewCandidatePublicationRuntimeResult {
  return {
    mode: "unblocked",
    reasons: [],
    counts: baseCounts(),
    detailsOnlyFindings: [],
    detailsSummary: {},
    ...overrides,
  } as ReviewCandidatePublicationRuntimeResult;
}

describe("willBlockedReviewFindingsNoticePublish", () => {
  test("false when there are no lifecycle findings", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime(),
      findingLifecycle: null,
      handlerPublishedReviewOutput: false,
    })).toBe(false);
  });

  test("true when findings exist and publication is blocked", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime({ mode: "blocked" }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 1, medium: 0, minor: 0 } } } as never,
      handlerPublishedReviewOutput: false,
    })).toBe(true);
  });

  test("false when findings exist but were already published elsewhere", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime({ counts: baseCounts({ candidatePublished: 1 }) }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 1, medium: 0, minor: 0 } } } as never,
      handlerPublishedReviewOutput: false,
    })).toBe(false);
  });

  test("false when the handler's own output already published a verdict, even if candidate publication is blocked", () => {
    expect(willBlockedReviewFindingsNoticePublish({
      candidatePublicationRuntime: baseRuntime({ mode: "blocked" }),
      findingLifecycle: { counts: { severity: { critical: 0, major: 1, medium: 0, minor: 0 } } } as never,
      handlerPublishedReviewOutput: true,
    })).toBe(false);
  });
});
