import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { ReviewCandidateApprovalResult } from "../review-orchestration/review-candidate-approval.ts";
import type { ReviewCandidatePublicationAdapterResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import { resolveReviewCandidatePublicationRuntimeContext } from "./review-candidate-publication-runtime-context.ts";

function approval(): ReviewCandidateApprovalResult {
  return {
    outcomes: [{ lifecycle: "approved", reason: "candidate-approved", fingerprint: "fp-a" }],
    approvedCandidates: [],
    rewrittenCandidates: [],
    counts: {
      input: 1,
      approved: 1,
      rewritten: 0,
      suppressed: 0,
      deduped: 0,
      rejected: 0,
      fallbackDisallowed: 0,
      auditEvents: 1,
    },
    audit: [{ lifecycle: "approved", reason: "candidate-approved" }],
    detailsSummary: { label: "Review candidate approval", text: "approved=1" },
  };
}

function adapter(): ReviewCandidatePublicationAdapterResult {
  return {
    payloads: [{
      candidateFingerprint: "fp-a",
      candidatePublicationLifecycle: "approved",
      source: "candidate",
      publication: {
        location: { path: "src/app.ts", line: 12 },
        body: "body fp-a",
      },
      finding: {
        filePath: "src/app.ts",
        title: "Finding fp-a",
        severity: "major",
        category: "correctness",
      },
    }],
    summary: {
      counts: {
        input: 1,
        publishable: 1,
        skipped: 0,
        approved: 1,
        rewritten: 0,
        detailsOnlyFindings: 0,
        movedToDetails: 0,
        detailsOnlyOmitted: 0,
      },
      skipped: [],
      fingerprints: ["fp-a"],
      fixEligibility: {
        schema: "same-pr-fix-eligibility.v1",
        status: "eligible",
        counts: {
          input: 1,
          eligible: 1,
          blocked: 0,
          omitted: 0,
          capped: 0,
        },
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
      },
      fixOutcomes: [],
      detailsOnlyFindings: [],
      movedToDetails: {
        counts: {
          total: 0,
          fromFixEligibility: 0,
          fromPublisherResult: 0,
          omitted: 0,
        },
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
      },
    },
  };
}

describe("resolveReviewCandidatePublicationRuntimeContext", () => {
  test("converts publisher results, builds flow evidence, and logs runtime projection", () => {
    const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const logger = {
      info(payload: Record<string, unknown>, message: string) {
        logs.push({ payload, message });
      },
      warn(payload: Record<string, unknown>, message: string) {
        logs.push({ payload, message });
      },
    } as Logger;
    const results = new Map<string, InlineReviewPublicationResult>([
      ["fp-a", { status: "published", commentId: 101, content: [{ type: "text", text: "ok" }] }],
    ]);

    const context = resolveReviewCandidatePublicationRuntimeContext({
      approval: approval(),
      adapter: adapter(),
      publisherResults: results,
      directPublication: {
        attempted: true,
        allowed: true,
        publishedFindingCount: 2,
        resultPublished: false,
      },
      logger,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(context.publishedFindings.findings.map((finding) => finding.commentId)).toEqual([101]);
    expect(context.flow.publishedCommentIds).toEqual([101]);
    expect(context.runtime.counts.directPublished).toBe(2);
    expect(context.adapterDetailsSummary.label).toBe("Review candidate publication adapter");
    expect(logs).toEqual([
      expect.objectContaining({
        message: "Review candidate publication completed",
      }),
    ]);
  });
});
