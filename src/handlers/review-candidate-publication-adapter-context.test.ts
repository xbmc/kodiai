import { describe, expect, test } from "bun:test";
import { logReviewCandidatePublicationAdapterContext } from "./review-candidate-publication-adapter-context.ts";
import type {
  ReviewCandidatePublicationAdapterDetailsSummary,
  ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";

describe("logReviewCandidatePublicationAdapterContext", () => {
  test("emits bounded fix-eligibility and adapter summary logs", () => {
    const records: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const logger = {
      info: (fields: Record<string, unknown>, message: string) => {
        records.push({ fields, message });
      },
    };
    const adapter = createAdapterResult();
    const detailsSummary: ReviewCandidatePublicationAdapterDetailsSummary = {
      label: "Review candidate publication adapter",
      text: "adapter details",
    };

    logReviewCandidatePublicationAdapterContext({
      logger: logger as never,
      baseLog: { deliveryId: "base-delivery", repo: "acme/repo" },
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      adapter,
      detailsSummary,
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      fields: {
        deliveryId: "delivery-123",
        repo: "acme/repo",
        gate: "review-fix-eligibility",
        gateResult: "eligible",
        reviewOutputKey: "rok-123",
        schema: "same-pr-fix-eligibility.v1",
        counts: { input: 1, eligible: 1, blocked: 0, omitted: 0, capped: 0 },
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
      message: "Review fix eligibility summarized",
    });
    expect(records[1]).toEqual({
      fields: {
        deliveryId: "base-delivery",
        repo: "acme/repo",
        gate: "review-candidate-publication-adapter",
        gateResult: "publishable",
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
        payloadFingerprints: ["fingerprint-1"],
        fixEligibility: adapter.summary.fixEligibility,
        details: "adapter details",
      },
      message: "Review candidate publication adapter summarized",
    });
  });
});

function createAdapterResult(): ReviewCandidatePublicationAdapterResult {
  return {
    payloads: [],
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
      fingerprints: ["fingerprint-1"],
      fixEligibility: {
        schema: "same-pr-fix-eligibility.v1",
        status: "eligible",
        counts: { input: 1, eligible: 1, blocked: 0, omitted: 0, capped: 0 },
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
      },
    },
  };
}
