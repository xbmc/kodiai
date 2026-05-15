import { describe, expect, test } from "bun:test";

import {
  projectReviewHandlerCandidatePublicationBridgeEvidence,
  REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL,
} from "./review-handler-publication-bridge.ts";
import type { Issue131DeferredHandoffRow } from "./deferred-handoff.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";

const unsafeCanaries = [
  "secret prompt",
  "raw model text",
  "@@ diff body",
  "public github body",
  "tool payload contents",
  "raw fingerprint value",
  "candidate body should not escape",
  "specialist prose should not escape",
] as const;

const unsafeFieldNames = [
  "prompt",
  "modelOutput",
  "diff",
  "body",
  "commentBody",
  "toolPayload",
  "rawFingerprint",
  "candidateBodiesIncluded",
  "specialistProseIncluded",
  "publicationEvidenceIncluded",
] as const;

function summary(overrides: Partial<CandidateVerificationPublicationEvidenceSummary> = {}): CandidateVerificationPublicationEvidenceSummary {
  return {
    aggregateStatus: "published",
    counts: { attempted: 1, allowed: 1, denied: 0, published: 1, skipped: 0, failed: 0 },
    publicationDenialCounts: {},
    reasonCategories: ["full-support"],
    verificationStateCounts: { verified: 1, partially_verified: 0, unverified: 0, disproven: 0, unavailable: 0 },
    candidateVerificationCounts: {
      candidateCount: 1,
      evidenceCount: 2,
      verifiedCount: 1,
      partiallyVerifiedCount: 0,
      unverifiedCount: 0,
      disprovenCount: 0,
      publicationEligibleCount: 1,
      duplicateCount: 0,
      disagreementCount: 0,
      unclassifiableCount: 0,
      malformedRecordCount: 0,
      truncatedCandidateCount: 0,
      truncatedEvidenceCount: 0,
      policyCandidateCount: 1,
    },
    metadata: {
      hasDeliveryId: true,
      hasReviewOutputKey: true,
      hasCorrelationKey: true,
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      correlationKey: "correlation-789",
    },
    redactionFlags: {
      privateOnly: true,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
      unsafeInputFieldCount: 0,
      discardedRawPayload: false,
      discardedPublicationFields: false,
      discardedEvidencePayloads: false,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      publicationEvidenceIncluded: false,
    },
    ...overrides,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function expectNoRawLeak(value: unknown): void {
  const serialized = json(value);
  for (const canary of unsafeCanaries) {
    expect(serialized).not.toContain(canary);
  }
  expect(serialized).not.toContain("githubCommentBody\":true");
  expect(serialized).not.toContain("rawPayloadsIncluded\":true");
  expect(serialized).not.toContain("reducerHandoffIncludesRawPayload\":true");
}

describe("review handler publication bridge projection", () => {
  test("projects allowed published evidence into safe bridge, reducer, log, and Review Details records", () => {
    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary(),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });
    const repeat = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary(),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });

    expect(projection).toEqual(repeat);
    expect(projection.bridgeRecord).toMatchObject({
      status: "allowed",
      sourceLabel: REVIEW_HANDLER_PUBLICATION_BRIDGE_SOURCE_LABEL,
      policyStatus: "allow",
      verificationState: "verified",
      presence: {
        hasDeliveryId: true,
        hasReviewOutputKey: true,
        hasUpstreamCorrelationKey: true,
        hasPolicyCorrelationKey: true,
      },
      reasonCategories: ["full-support"],
      malformedReasonCodes: [],
    });
    expect(projection.bridgeRecord.counts).toMatchObject({
      candidateCount: 1,
      evidenceCount: 2,
      verifiedCount: 1,
      publicationEligibleCount: 1,
      malformedRecordCount: 0,
      unsafeInputFieldCount: 0,
    });
    expect(projection.reducerHandoffInput).toMatchObject({
      bridgeId: projection.bridgeRecord.recordKey,
      recordKey: projection.bridgeRecord.recordKey,
      correlationKey: projection.bridgeRecord.correlationKey,
      status: "allowed",
      downstreamHandoffOwner: {
        rowId: "candidate-finding-mcp-publication-bridge",
        requirementRefs: ["R130"],
        owner: { milestone: "M072", slice: "S01" },
      },
    });
    expect(projection.logFields).toMatchObject({
      candidatePublicationBridgeStatus: "allowed",
      candidatePublicationBridgeRecordKey: projection.bridgeRecord.recordKey,
      candidatePublicationBridgeCorrelationKey: projection.bridgeRecord.correlationKey,
      candidatePublicationReducerHandoffAvailable: true,
      candidatePublicationBridgeReasonCategories: ["full-support"],
      candidatePublicationBridgeMalformedReasonCodes: [],
      candidatePublicationBridgePrivateOnly: true,
    });
    expect(projection.reviewDetails).toMatchObject({
      status: "allowed",
      recordKey: projection.bridgeRecord.recordKey,
      correlationKey: projection.bridgeRecord.correlationKey,
      reducerHandoffAvailable: true,
      counts: {
        candidateCount: 1,
        evidenceCount: 2,
        verifiedCount: 1,
        publicationEligibleCount: 1,
        malformedRecordCount: 0,
        unsafeInputFieldCount: 0,
      },
      redaction: {
        privateOnly: true,
        rawPayloadsIncluded: false,
        publicationFieldsIncluded: false,
        evidencePayloadsIncluded: false,
        githubCommentBodyIncluded: false,
        reducerHandoffIncludesRawPayload: false,
      },
    });
    expectNoRawLeak(projection);
  });

  test("projects denied evidence without weakening handoff owner preservation", () => {
    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary({
        aggregateStatus: "denied",
        counts: { attempted: 1, allowed: 0, denied: 1, published: 0, skipped: 0, failed: 0 },
        reasonCategories: ["no-evidence", "publication-ineligible"],
        verificationStateCounts: { verified: 0, partially_verified: 0, unverified: 1, disproven: 0, unavailable: 0 },
        candidateVerificationCounts: {
          ...summary().candidateVerificationCounts,
          evidenceCount: 0,
          verifiedCount: 0,
          unverifiedCount: 1,
          publicationEligibleCount: 0,
        },
      }),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });

    expect(projection.bridgeRecord.status).toBe("denied");
    expect(projection.bridgeRecord.reasonCategories).toEqual(["no-evidence", "publication-ineligible"]);
    expect(projection.reducerHandoffInput.downstreamHandoffOwner).toMatchObject({
      rowId: "candidate-finding-mcp-publication-bridge",
      owner: { milestone: "M072", slice: "S01" },
    });
    expect(projection.reviewDetails.reducerHandoffAvailable).toBe(true);
    expectNoRawLeak(projection);
  });

  test("treats missing evidence as unavailable skipped diagnostics that fail closed", () => {
    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: undefined,
      deliveryId: undefined,
      reviewOutputKey: undefined,
      upstreamCorrelationKey: undefined,
    });

    expect(projection.bridgeRecord.status).toBe("denied");
    expect(projection.bridgeRecord.policyStatus).toBe("deny");
    expect(projection.bridgeRecord.reasonCategories).toEqual(["no-evidence", "publication-ineligible"]);
    expect(projection.bridgeRecord.malformedReasonCodes).toEqual([
      "missing-delivery-id",
      "missing-review-output-key",
      "missing-correlation-key",
    ]);
    expect(projection.bridgeRecord.presence).toEqual({
      hasDeliveryId: false,
      hasReviewOutputKey: false,
      hasUpstreamCorrelationKey: false,
      hasPolicyCorrelationKey: false,
    });
    expect(projection.reviewDetails.status).toBe("denied");
    expectNoRawLeak(projection);
  });

  test("malformed wrong-shaped evidence returns denied malformed bridge diagnostics without throwing", () => {
    const malformedEvidence = {
      aggregateStatus: "published",
      counts: "wrong",
      prompt: "secret prompt",
      nested: {
        modelOutput: "raw model text",
        diff: "@@ diff body",
        body: "public github body",
        commentBody: "public github body",
        toolPayload: "tool payload contents",
        rawFingerprint: "raw fingerprint value",
      },
    } as unknown as CandidateVerificationPublicationEvidenceSummary;

    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: malformedEvidence,
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });

    expect(projection.bridgeRecord.status).toBe("malformed");
    expect(projection.bridgeRecord.reasonCategories).toEqual(["no-evidence", "malformed-input", "publication-ineligible"]);
    expect(projection.bridgeRecord.malformedReasonCodes).toEqual([]);
    expect(projection.bridgeRecord.counts.malformedRecordCount).toBe(1);
    expect(projection.bridgeRecord.counts.unsafeInputFieldCount).toBeGreaterThanOrEqual(7);
    expect(projection.bridgeRecord.redactionFlags).toMatchObject({
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      githubCommentBodyIncluded: false,
      reducerHandoffIncludesRawPayload: false,
    });
    expectNoRawLeak(projection);
  });

  test("unsafe redaction flags deny as malformed and redact Review Details", () => {
    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary({
        redactionFlags: {
          ...summary().redactionFlags,
          candidateBodiesIncluded: true as false,
          specialistProseIncluded: true as false,
          rawPromptsIncluded: true as false,
          publicationEvidenceIncluded: true as false,
          unsafeInputFieldCount: 4,
        },
      }),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });

    expect(projection.bridgeRecord.status).toBe("malformed");
    expect(projection.bridgeRecord.reasonCategories).toEqual(["full-support", "malformed-input", "publication-ineligible"]);
    expect(projection.bridgeRecord.counts.malformedRecordCount).toBe(1);
    expect(projection.bridgeRecord.counts.unsafeInputFieldCount).toBe(4);
    expect(projection.reviewDetails.redaction).toMatchObject({
      rawPayloadsIncluded: false,
      publicationFieldsIncluded: false,
      evidencePayloadsIncluded: false,
      githubCommentBodyIncluded: false,
      reducerHandoffIncludesRawPayload: false,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
    });
    expectNoRawLeak(projection);
  });

  test("bounds oversized counts and reasons while keeping stable keys", () => {
    const manyReasons = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? "full-support" : `oversized-reason-${index}`));
    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary({
        reasonCategories: manyReasons as CandidateVerificationPublicationEvidenceSummary["reasonCategories"],
        candidateVerificationCounts: {
          ...summary().candidateVerificationCounts,
          candidateCount: 999_999,
          evidenceCount: Number.POSITIVE_INFINITY,
          malformedRecordCount: -1,
        },
      }),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });
    const repeat = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary({
        reasonCategories: manyReasons as CandidateVerificationPublicationEvidenceSummary["reasonCategories"],
        candidateVerificationCounts: {
          ...summary().candidateVerificationCounts,
          candidateCount: 999_999,
          evidenceCount: Number.POSITIVE_INFINITY,
          malformedRecordCount: -1,
        },
      }),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });

    expect(projection.bridgeRecord).toEqual(repeat.bridgeRecord);
    expect(projection.bridgeRecord.reasonCategories).toHaveLength(12);
    expect(projection.bridgeRecord.reasonCategories[0]).toBe("full-support");
    expect(projection.bridgeRecord.counts.candidateCount).toBe(10_000);
    expect(projection.bridgeRecord.counts.evidenceCount).toBe(0);
    expect(projection.bridgeRecord.counts.malformedRecordCount).toBe(0);
    expect(projection.bridgeRecord.recordKey).toMatch(/^candidate-publication-record:[a-f0-9]{32}$/);
    expect(projection.bridgeRecord.correlationKey).toMatch(/^candidate-publication-bridge:[a-f0-9]{32}$/);
  });

  test("missing deferred handoff owner surfaces unavailable reducer handoff without raw claims", () => {
    const deformedRows = [
      {
        rowId: "candidate-finding-mcp-publication-bridge",
        requirementRefs: [],
        owner: { milestone: "M073", slice: "S99" },
        consumerOwnerLabel: "bad owner",
        proofRequiredBeforePromotion: "bad package verifier success claim",
        reason: "bad",
      },
    ] as unknown as readonly Issue131DeferredHandoffRow[];

    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: summary(),
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
      deferredHandoffRows: deformedRows,
    });

    expect(projection.bridgeRecord.status).toBe("allowed");
    expect(projection.reducerHandoffInput.status).toBe("denied");
    expect(projection.reducerHandoffInput.downstreamHandoffOwner).toBeNull();
    expect(projection.reducerHandoffInput.reasonCategories).toContain("handoff-row-unavailable");
    expect(projection.logFields.candidatePublicationReducerHandoffAvailable).toBe(false);
    expect(projection.reviewDetails.reducerHandoffAvailable).toBe(false);
    expectNoRawLeak(projection);
  });

  test("raw canary field names and payload values do not appear in public projection JSON", () => {
    const projection = projectReviewHandlerCandidatePublicationBridgeEvidence({
      evidenceSummary: {
        ...summary(),
        prompt: "secret prompt",
        modelOutput: "raw model text",
        diff: "@@ diff body",
        body: "public github body",
        commentBody: "public github body",
        toolPayload: "tool payload contents",
        rawFingerprint: "raw fingerprint value",
        candidateBody: "candidate body should not escape",
        specialistProse: "specialist prose should not escape",
      } as CandidateVerificationPublicationEvidenceSummary,
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      upstreamCorrelationKey: "upstream-correlation-789",
    });

    const serialized = json(projection);
    expect(projection.bridgeRecord.status).toBe("malformed");
    for (const canary of unsafeCanaries) {
      expect(serialized).not.toContain(canary);
    }
    for (const fieldName of unsafeFieldNames) {
      expect(serialized).not.toContain(`\"${fieldName}\":true`);
    }
    expect(projection.bridgeRecord.redactionFlags).toMatchObject({
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      githubCommentBodyIncluded: false,
      reducerHandoffIncludesRawPayload: false,
    });
  });
});
