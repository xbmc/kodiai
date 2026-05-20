import { describe, expect, test } from "bun:test";
import type { ReviewCandidateApprovalResult } from "./review-candidate-approval.ts";
import type {
  ReviewCandidateMovedToDetailsSummary,
  ReviewCandidatePublicationAdapterSummary,
  ReviewCandidatePublishedResultSummary,
} from "./review-candidate-publication-adapter.ts";
import {
  classifyReviewCandidatePublicationRuntime,
  createCandidatePublicationFlowEvidence,
  toReviewCandidatePublicationRuntimeConfigSnapshot,
  toReviewCandidatePublicationRuntimeDetailsSummary,
  type ReviewCandidatePublicationRuntimeInput,
} from "./review-candidate-publication-runtime.ts";

describe("review candidate publication runtime classifier", () => {
  test("classifies fully published approved candidate payloads as candidate-approved", () => {
    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 2 }),
      adapter: adapter({ publishable: 2, approved: 2 }),
      publisher: publisher([
        published("rcf-0000000000000001", 101),
        published("rcf-0000000000000002", 102),
      ]),
      convertedProcessedFindingCount: 2,
    }));

    expect(result.mode).toBe("candidate-approved");
    expect(result.counts).toMatchObject({
      approvedReferences: 2,
      candidatePublishable: 2,
      candidatePublished: 2,
      convertedProcessedFindings: 2,
      directPublished: 0,
      fallbackEvidence: 0,
      malformed: 0,
    });
    expect(result.reasons).toContain("candidate-publisher-published");
    expect(result.reasons).not.toContain("direct-fallback-attempted");
  });

  test("classifies partial candidate publication when approved payloads publish alongside skipped, blocked, and failed results", () => {
    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 4 }),
      adapter: adapter({ publishable: 4, approved: 4 }),
      publisher: publisher([
        published("rcf-0000000000000001", 101),
        { fingerprint: "rcf-0000000000000002", status: "skipped", reason: "already-published" },
        { fingerprint: "rcf-0000000000000003", status: "blocked", reason: "secret-detected" },
        { fingerprint: "rcf-0000000000000004", status: "failed", reason: "line-not-commentable-in-pr-diff" },
      ]),
      convertedProcessedFindingCount: 1,
    }));

    expect(result.mode).toBe("candidate-approved-partial");
    expect(result.counts).toMatchObject({ candidatePublished: 1, candidateSkipped: 1, candidateBlocked: 1, candidateFailed: 1 });
    expect(result.reasons).toEqual(expect.arrayContaining([
      "candidate-publisher-published",
      "candidate-publisher-skipped",
      "candidate-publisher-blocked",
      "candidate-publisher-failed",
    ]));
  });

  test("classifies direct publication as audited fallback when candidate shared publisher results are missing", () => {
    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 2 }),
      adapter: adapter({ publishable: 2, approved: 2 }),
      publisher: undefined,
      directPublication: { attempted: true, published: 2, reason: "direct publish used after missing shared publisher" },
    }));

    expect(result.mode).toBe("direct-fallback");
    expect(result.counts).toMatchObject({ candidatePublished: 0, directPublished: 2, fallbackEvidence: 2 });
    expect(result.reasons).toEqual(expect.arrayContaining(["missing-shared-publisher-results", "direct-fallback-published"]));
  });

  test("classifies safe details-only preservation as moved-to-details without direct fallback evidence", () => {
    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 1 }),
      adapter: adapter({ input: 1, publishable: 0, approved: 0, detailsOnlyFindings: 1, movedToDetails: 1 }),
      publisher: publisher([]),
      convertedProcessedFindingCount: 0,
    }));

    expect(result.mode).toBe("moved-to-details");
    expect(result.counts).toMatchObject({
      candidatePublished: 0,
      candidateMovedToDetails: 1,
      candidateDetailsOnlyFindings: 1,
      fallbackEvidence: 0,
      directPublished: 0,
      malformed: 0,
    });
    expect(result.reasons).toContain("candidate-moved-to-details");
    expect(result.reasons).not.toContain("direct-fallback-published");
    expect(result.detailsSummary.text).toContain("movedToDetails=1");
  });

  test("degrades and omits finding projection when moved-to-details metadata has unsafe redaction", () => {
    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 1 }),
      adapter: {
        ...adapter({ input: 1, publishable: 0, detailsOnlyFindings: 1, movedToDetails: 1 }),
        detailsOnlyFindings: [{
          fingerprint: "rcf-0000000000000001",
          lifecycle: "approved",
          severity: "major",
          category: "security",
          title: "Should not render",
          location: { path: "src/file.ts", line: 42 },
          reason: "line-not-commentable",
          excerpt: "secret sk-unsafe diff --git",
        }],
        movedToDetails: {
          ...emptyMovedToDetailsSummary(),
          counts: { total: 1, fromFixEligibility: 1, fromPublisherResult: 0, omitted: 0 },
          redaction: {
            rawCandidatePayloadsIncluded: false,
            rawPromptsIncluded: false,
            rawModelOutputIncluded: false,
            diffsIncluded: true,
            replacementTextIncluded: false,
            githubResponsePayloadsIncluded: false,
            secretLikeValuesIncluded: false,
            bounded: true,
          },
        } as never,
      },
    }));

    expect(result.mode).toBe("degraded");
    expect(result.reasons).toContain("malformed-moved-to-details");
    expect(result.detailsOnlyFindings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("sk-unsafe");
  });

  test("classifies attempted fallback as disallowed when policy blocks direct publication", () => {
    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 1, fallbackDisallowed: 1 }),
      adapter: adapter({ publishable: 0, skipped: 1 }),
      publisher: publisher([]),
      directPublication: { attempted: true, published: 0, allowed: false, reason: "policy said no" },
    }));

    expect(result.mode).toBe("fallback-disallowed");
    expect(result.counts).toMatchObject({ fallbackDisallowed: 1, directPublished: 0 });
    expect(result.reasons).toContain("direct-fallback-disallowed");
  });

  test("classifies no publishable or fully blocked candidate paths as blocked", () => {
    const noCandidates = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 0, suppressed: 3, rejected: 1 }),
      adapter: adapter({ input: 0, publishable: 0, skipped: 0 }),
      publisher: publisher([]),
    }));

    expect(noCandidates.mode).toBe("blocked");
    expect(noCandidates.reasons).toContain("no-candidate-publication-path");

    const blockedOnly = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 2 }),
      adapter: adapter({ publishable: 2, approved: 2 }),
      publisher: publisher([
        { fingerprint: "rcf-0000000000000001", status: "blocked", reason: "secret-detected" },
        { fingerprint: "rcf-0000000000000002", status: "blocked", reason: "secret-detected" },
      ]),
    }));

    expect(blockedOnly.mode).toBe("blocked");
    expect(blockedOnly.counts.candidateBlocked).toBe(2);
  });

  test("degrades instead of throwing on malformed summaries and unknown publisher status or reason values", () => {
    const result = classifyReviewCandidatePublicationRuntime({
      approval: null,
      adapter: { counts: { input: Number.NaN, publishable: -1 }, skipped: [{ reason: "diff --git sk-secret123" }] } as never,
      publisher: {
        counts: { input: 2, processed: Number.NaN, skipped: -1, blocked: 0, failed: 0, malformed: 1 },
        results: [
          { fingerprint: "rcf-0000000000000001", status: "weird", reason: "BEGIN PROMPT TOKEN=abc123" },
          null,
        ],
      } as never,
      convertedProcessedFindingCount: Number.NaN,
      directPublication: { attempted: true, published: 1, reason: "diff --git sk-secret123 BEGIN PROMPT" },
    });

    expect(result.mode).toBe("degraded");
    expect(result.counts.malformed).toBeGreaterThanOrEqual(3);
    expect(result.reasons).toEqual(expect.arrayContaining(["malformed-approval-summary", "unknown-publisher-status", "malformed-publisher-result"]));

    const publicText = JSON.stringify(result);
    for (const unsafe of ["diff --git", "sk-secret123", "BEGIN PROMPT", "TOKEN=abc123"]) {
      expect(publicText).not.toContain(unsafe);
    }
  });

  test("bounds reason lists, summary text, and safe snapshot fields under 10x candidate volume", () => {
    const manyResults = Array.from({ length: 100 }, (_, index) => ({
      fingerprint: `rcf-${index.toString(16).padStart(16, "0")}`,
      status: index % 5 === 0 ? "published" : "failed",
      reason: `oversized reason ${index} with sk-secret${index} BEGIN PROMPT diff --git ${"x".repeat(200)}`,
      ...(index % 5 === 0 ? { commentId: 1000 + index } : {}),
    }));

    const result = classifyReviewCandidatePublicationRuntime(input({
      approval: approval({ approved: 100 }),
      adapter: adapter({ input: 100, publishable: 100, approved: 100 }),
      publisher: { counts: { input: 100, processed: 20, skipped: 0, blocked: 0, failed: 80, malformed: 0 }, results: manyResults as never },
      convertedProcessedFindingCount: 20,
      directPublication: { attempted: true, published: 8, reason: "direct fallback reason should be bounded" },
    }));
    const details = toReviewCandidatePublicationRuntimeDetailsSummary(result);
    const snapshot = toReviewCandidatePublicationRuntimeConfigSnapshot(result);

    expect(result.mode).toBe("candidate-approved-partial");
    expect(result.reasons.length).toBeLessThanOrEqual(12);
    expect(result.publisherResultSample.length).toBeLessThanOrEqual(20);
    expect(details.label).toBe("Review candidate publication runtime");
    expect(details.text.length).toBeLessThanOrEqual(320);
    expect(snapshot.reasons.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(1200);

    const publicText = `${details.text} ${JSON.stringify(snapshot)} ${JSON.stringify(result.publisherResultSample)}`;
    for (const unsafe of ["sk-secret", "BEGIN PROMPT", "diff --git", "oversized reason"]) {
      expect(publicText).not.toContain(unsafe);
    }
  });

  test("helper represents candidate publication flow evidence without fabricated processed findings", () => {
    const evidence = createCandidatePublicationFlowEvidence({
      payloadFingerprints: ["rcf-0000000000000001", "rcf-0000000000000002"],
      publisher: publisher([
        published("rcf-0000000000000001", 101),
        { fingerprint: "rcf-0000000000000002", status: "skipped", reason: "already-published" },
      ]),
    });

    expect(evidence.payloadFingerprints).toEqual(["rcf-0000000000000001", "rcf-0000000000000002"]);
    expect(evidence.publishedCommentIds).toEqual([101]);
    expect(evidence.convertedProcessedFindingCount).toBe(1);
    expect(evidence.hasFabricatedProcessedFindings).toBe(false);
  });
});

function input(overrides: Partial<ReviewCandidatePublicationRuntimeInput> = {}): ReviewCandidatePublicationRuntimeInput {
  return {
    approval: approval({ approved: 0 }),
    adapter: adapter(),
    publisher: publisher([]),
    convertedProcessedFindingCount: 0,
    ...overrides,
  };
}

function approval(overrides: Partial<ReviewCandidateApprovalResult["counts"]> = {}): ReviewCandidateApprovalResult {
  const counts = {
    input: 0,
    approved: 0,
    rewritten: 0,
    suppressed: 0,
    deduped: 0,
    rejected: 0,
    fallbackDisallowed: 0,
    auditEvents: 0,
    ...overrides,
  };
  return {
    outcomes: [],
    approvedCandidates: [],
    rewrittenCandidates: [],
    counts,
    audit: [],
    detailsSummary: { label: "Review candidate approval", text: "Review candidate approval: test" },
  };
}

function adapter(overrides: Partial<ReviewCandidatePublicationAdapterSummary["counts"]> = {}): ReviewCandidatePublicationAdapterSummary {
  const counts = {
    input: 0,
    publishable: 0,
    skipped: 0,
    approved: 0,
    rewritten: 0,
    detailsOnlyFindings: 0,
    movedToDetails: 0,
    detailsOnlyOmitted: 0,
    ...overrides,
  };
  return {
    counts,
    skipped: [],
    fingerprints: [],
    fixEligibility: emptyFixEligibilitySummary(),
    fixOutcomes: [],
    detailsOnlyFindings: [],
    movedToDetails: emptyMovedToDetailsSummary(),
  };
}

function publisher(results: ReviewCandidatePublishedResultSummary["results"]): ReviewCandidatePublishedResultSummary {
  return {
    counts: {
      input: results.length,
      processed: results.filter((result) => result.status === "published" && typeof result.commentId === "number").length,
      skipped: results.filter((result) => result.status === "skipped" || result.status === "missing").length,
      blocked: results.filter((result) => result.status === "blocked").length,
      failed: results.filter((result) => result.status === "failed").length,
      malformed: results.filter((result) => result.status === "malformed").length,
      detailsOnlyFindings: 0,
      movedToDetails: 0,
      detailsOnlyOmitted: 0,
    },
    results,
    movedToDetails: emptyMovedToDetailsSummary(),
  };
}

function emptyMovedToDetailsSummary(): ReviewCandidateMovedToDetailsSummary {
  return {
    counts: { total: 0, fromFixEligibility: 0, fromPublisherResult: 0, omitted: 0 },
    reasonCounts: {},
    redaction: {
      rawCandidatePayloadsIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      replacementTextIncluded: false,
      githubResponsePayloadsIncluded: false,
      secretLikeValuesIncluded: false,
      bounded: true,
    },
  };
}

function emptyFixEligibilitySummary(): ReviewCandidatePublicationAdapterSummary["fixEligibility"] {
  return {
    schema: "same-pr-fix-eligibility.v1",
    status: "empty",
    counts: { input: 0, eligible: 0, blocked: 0, omitted: 0, capped: 0 },
    reasonCounts: {},
    omittedReasonCounts: {},
    redaction: {
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      diffsIncluded: false,
      unboundedDiffsIncluded: false,
      secretDetected: false,
    },
  };
}

function published(fingerprint: string, commentId: number): ReviewCandidatePublishedResultSummary["results"][number] {
  return { fingerprint, status: "published", reason: "published", commentId };
}
