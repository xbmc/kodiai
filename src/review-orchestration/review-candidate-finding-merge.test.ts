import { describe, expect, test } from "bun:test";
import type { ProcessedReviewFinding } from "./review-reducer.ts";
import {
  isCandidatePublicationDraft,
  mergeCandidatePublishedFindings,
  reviewFindingIdentityKey,
} from "./review-candidate-finding-merge.ts";

function finding(overrides: Partial<ProcessedReviewFinding>): ProcessedReviewFinding {
  return {
    filePath: "src/a.ts",
    title: "issue",
    severity: "major",
    category: "correctness",
    ...overrides,
  } as ProcessedReviewFinding;
}

describe("reviewFindingIdentityKey", () => {
  test("prefers candidate fingerprint when present", () => {
    expect(reviewFindingIdentityKey(finding({ candidateFingerprint: "fp-1" }))).toBe("candidate:fp-1");
  });

  test("falls back to comment id and content identity", () => {
    expect(reviewFindingIdentityKey(finding({ commentId: 42 }))).toBe("comment:42");
    expect(reviewFindingIdentityKey(finding({ startLine: 10, endLine: 12 }))).toBe("content:src/a.ts:issue:10:12");
  });
});

describe("mergeCandidatePublishedFindings", () => {
  test("deduplicates merged findings by identity key", () => {
    const direct = [finding({ candidateFingerprint: "fp-1", title: "direct" })];
    const candidate = [finding({ candidateFingerprint: "fp-1", title: "candidate" }), finding({ candidateFingerprint: "fp-2" })];

    expect(mergeCandidatePublishedFindings(direct, candidate)).toHaveLength(2);
    expect(mergeCandidatePublishedFindings(direct, candidate)[0]!.title).toBe("direct");
  });
});

describe("isCandidatePublicationDraft", () => {
  test("detects candidate publication draft markers", () => {
    expect(isCandidatePublicationDraft({ candidatePublicationDraft: true })).toBeTrue();
    expect(isCandidatePublicationDraft({ candidatePublicationDraft: false })).toBeFalse();
  });
});
