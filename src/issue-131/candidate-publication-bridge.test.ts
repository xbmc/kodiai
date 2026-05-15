import { describe, expect, test } from "bun:test";

import {
  CANDIDATE_PUBLICATION_BRIDGE_VERSION,
  createCandidatePublicationBridgeRecord,
  projectCandidatePublicationReducerHandoffInput,
  type CandidatePublicationBridgeInput,
  type CandidatePublicationBridgeRecord,
} from "./candidate-publication-bridge.ts";
import type { CandidatePublicationPolicyResult } from "../specialists/candidate-publication-policy.ts";
import { ISSUE_131_DEFERRED_HANDOFF_ROWS, type Issue131DeferredHandoffRow } from "./deferred-handoff.ts";

const unsafeFieldNames = [
  "prompt",
  "modelOutput",
  "diff",
  "body",
  "commentBody",
  "toolPayload",
  "rawFingerprint",
] as const;

function safePolicyResult(overrides: Partial<CandidatePublicationPolicyResult> = {}): CandidatePublicationPolicyResult {
  return {
    allowed: true,
    status: "allow",
    candidateRef: "candidate-safe-ref",
    verificationState: "verified",
    reasonCategories: ["full-support"],
    counts: {
      candidateCount: 1,
      evidenceCount: 1,
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
    hasDeliveryId: true,
    hasReviewOutputKey: true,
    hasCorrelationKey: true,
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
    },
    ...overrides,
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function expectNoUnsafePayloadJson(value: unknown): void {
  const json = stringify(value);
  expect(json).not.toContain("secret prompt");
  expect(json).not.toContain("raw model text");
  expect(json).not.toContain("@@ diff body");
  expect(json).not.toContain("public github body");
  expect(json).not.toContain("tool payload contents");
  expect(json).not.toContain("raw fingerprint value");
  for (const fieldName of unsafeFieldNames) {
    expect(json).not.toContain(`\"${fieldName}\"`);
  }
}

function expectNoUnsafeReducerClaims(value: unknown): void {
  const json = stringify(value);
  expect(json).not.toContain("reducerApproved");
  expect(json).not.toContain("published");
  expect(json).not.toContain("commentBody");
  expect(json).not.toContain("package verifier success");
  expect(json).not.toContain(".gsd/");
  expect(json).not.toContain(".planning/");
  expect(json).not.toContain(".audits/");
}

describe("candidate publication bridge", () => {
  test("normalizes a verified candidate into deterministic safe bridge and reducer records", () => {
    const input: CandidatePublicationBridgeInput = {
      sourceLabel: "normal-review",
      upstreamCorrelationKey: "upstream-correlation-key-that-is-safe",
      policyResult: safePolicyResult(),
      candidateMetadata: {
        deliveryId: "delivery-123",
        reviewOutputKey: "review-output-456",
        correlationKey: "candidate-correlation-789",
        prompt: "secret prompt",
        nested: {
          modelOutput: "raw model text",
          diff: "@@ diff body",
          body: "public github body",
          commentBody: "public github body",
          toolPayload: "tool payload contents",
          rawFingerprint: "raw fingerprint value",
        },
      },
    };

    const first = createCandidatePublicationBridgeRecord(input);
    const second = createCandidatePublicationBridgeRecord(input);
    const handoff = projectCandidatePublicationReducerHandoffInput(first);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      bridgeVersion: CANDIDATE_PUBLICATION_BRIDGE_VERSION,
      status: "allowed",
      sourceLabel: "normal-review",
      candidateRef: "candidate-safe-ref",
      verificationState: "verified",
      presence: {
        hasDeliveryId: true,
        hasReviewOutputKey: true,
        hasUpstreamCorrelationKey: true,
        hasPolicyCorrelationKey: true,
      },
      reasonCategories: ["full-support"],
      malformedReasonCodes: [],
      redactionFlags: {
        privateOnly: true,
        candidateAttemptIncluded: false,
        candidateKeyIncluded: false,
        githubCommentBodyIncluded: false,
        reducerHandoffIncludesRawPayload: false,
        discardedRawPayload: true,
        discardedPublicationFields: true,
        discardedEvidencePayloads: true,
      },
    });
    expect(first.counts).toMatchObject({
      candidateCount: 1,
      evidenceCount: 1,
      verifiedCount: 1,
      policyCandidateCount: 1,
      unsafeInputFieldCount: 7,
    });
    expect(first.correlationKey).toMatch(/^candidate-publication-bridge:[a-f0-9]{32}$/);
    expect(handoff).toEqual({
      bridgeVersion: first.bridgeVersion,
      bridgeId: first.recordKey,
      recordKey: first.recordKey,
      correlationKey: first.correlationKey,
      sourceLabel: "normal-review",
      status: "allowed",
      candidateRef: "candidate-safe-ref",
      verificationState: "verified",
      presence: first.presence,
      counts: first.counts,
      reasonCategories: ["full-support"],
      malformedReasonCodes: [],
      redactionFlags: first.redactionFlags,
      downstreamHandoffOwner: {
        rowId: "candidate-finding-mcp-publication-bridge",
        requirementRefs: ["R130"],
        owner: { milestone: "M072", slice: "S01" },
        consumerOwnerLabel: "M072/S01 candidate-publication bridge owner",
        proofRequiredBeforePromotion: "Source-owned candidate capture before public GitHub publication, reducer handoff input shape, and package verifier row proving the bridge without raw candidate payloads.",
        reason: "M071 only proves foundation readiness; candidate publication remains deferred to the bridge implementation owner.",
      },
    });
    expectNoUnsafePayloadJson(first);
    expectNoUnsafePayloadJson(handoff);
    expectNoUnsafeReducerClaims(handoff);
  });

  test("fails closed into a denied malformed record when policy evaluation throws", () => {
    const record = createCandidatePublicationBridgeRecord({
      sourceLabel: "throwing-policy",
      candidatePolicyInput: { candidate: { deliveryId: "delivery-123" } },
      evaluatePolicy: () => {
        throw new Error("policy boom with secret prompt");
      },
    });

    expect(record.status).toBe("malformed");
    expect(record.reasonCategories).toEqual(["malformed-input", "policy-evaluation-failed", "publication-ineligible"]);
    expect(record.malformedReasonCodes).toEqual([
      "missing-delivery-id",
      "missing-review-output-key",
      "missing-correlation-key",
      "policy-evaluation-failed",
    ]);
    expect(record.presence).toMatchObject({
      hasDeliveryId: false,
      hasReviewOutputKey: false,
      hasUpstreamCorrelationKey: false,
      hasPolicyCorrelationKey: false,
    });
    expect(record.counts.malformedRecordCount).toBe(1);
    expect(record.redactionFlags.discardedRawPayload).toBe(false);
    expect(stringify(record)).not.toContain("policy boom");
    expect(stringify(record)).not.toContain("secret prompt");
  });

  test("denies absent verification evidence with missing metadata reason codes", () => {
    const record = createCandidatePublicationBridgeRecord({
      sourceLabel: "normal-review",
      policyResult: safePolicyResult({
        allowed: false,
        status: "deny",
        verificationState: "unverified",
        reasonCategories: ["no-evidence", "publication-ineligible"],
        counts: {
          ...safePolicyResult().counts,
          evidenceCount: 0,
          verifiedCount: 0,
          unverifiedCount: 1,
          publicationEligibleCount: 0,
        },
        hasDeliveryId: false,
        hasReviewOutputKey: false,
        hasCorrelationKey: false,
      }),
    });

    expect(record.status).toBe("denied");
    expect(record.presence).toEqual({
      hasDeliveryId: false,
      hasReviewOutputKey: false,
      hasUpstreamCorrelationKey: false,
      hasPolicyCorrelationKey: false,
    });
    expect(record.malformedReasonCodes).toEqual([
      "missing-delivery-id",
      "missing-review-output-key",
      "missing-correlation-key",
    ]);
    expect(record.reasonCategories).toEqual(["no-evidence", "publication-ineligible"]);
  });

  test("bounds oversized reason arrays, strings, labels, and count inputs", () => {
    const reasons = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? "full-support" : `oversized-reason-${index}`));
    const record = createCandidatePublicationBridgeRecord({
      sourceLabel: "x".repeat(500),
      upstreamCorrelationKey: "u".repeat(500),
      policyResult: safePolicyResult({
        reasonCategories: reasons as CandidatePublicationPolicyResult["reasonCategories"],
        counts: {
          ...safePolicyResult().counts,
          candidateCount: 999_999,
          evidenceCount: Number.POSITIVE_INFINITY,
          malformedRecordCount: -10,
        },
      }),
    });

    expect(record.sourceLabel).toHaveLength(80);
    expect(record.reasonCategories).toHaveLength(12);
    expect(record.reasonCategories[0]).toBe("full-support");
    expect(record.reasonCategories.every((reason) => reason.length <= 80)).toBe(true);
    expect(record.counts.candidateCount).toBe(10_000);
    expect(record.counts.evidenceCount).toBe(0);
    expect(record.counts.malformedRecordCount).toBe(0);
    expect(record.presence.hasUpstreamCorrelationKey).toBe(true);
    expect(record.correlationKey).toMatch(/^candidate-publication-bridge:[a-f0-9]{32}$/);
  });

  test("malformed input and nested raw fields are redacted from diagnostics", () => {
    const record = createCandidatePublicationBridgeRecord({
      sourceLabel: "malformed-source",
      candidatePolicyInput: null,
      candidateMetadata: {
        prompt: "secret prompt",
        modelOutput: "raw model text",
        evidence: [{ diff: "@@ diff body", rawFingerprint: "raw fingerprint value" }],
        publication: { body: "public github body", commentBody: "public github body" },
        tools: { toolPayload: "tool payload contents" },
      },
    });

    expect(record.status).toBe("malformed");
    expect(record.reasonCategories).toEqual(["malformed-input", "not-exactly-one-candidate", "publication-ineligible"]);
    expect(record.malformedReasonCodes).toContain("missing-delivery-id");
    expect(record.malformedReasonCodes).toContain("missing-review-output-key");
    expect(record.malformedReasonCodes).toContain("missing-correlation-key");
    expect(record.redactionFlags).toMatchObject({
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      reducerHandoffIncludesRawPayload: false,
      githubCommentBodyIncluded: false,
    });
    expect(record.counts.unsafeInputFieldCount).toBe(7);
    expectNoUnsafePayloadJson(record);
    expectNoUnsafePayloadJson(projectCandidatePublicationReducerHandoffInput(record));
  });

  test("malformed bridge records fail closed to unavailable reducer handoff", () => {
    const malformed = { ...createCandidatePublicationBridgeRecord({ policyResult: safePolicyResult() }), recordKey: "" } as CandidatePublicationBridgeRecord;
    const handoff = projectCandidatePublicationReducerHandoffInput(malformed);

    expect(handoff.status).toBe("denied");
    expect(handoff.candidateRef).toBe("candidate-unavailable");
    expect(handoff.reasonCategories).toEqual(["handoff-row-unavailable", "malformed-input", "publication-ineligible"]);
    expect(handoff.downstreamHandoffOwner).toBeNull();
    expect(handoff.redactionFlags.reducerHandoffIncludesRawPayload).toBe(false);
    expectNoUnsafeReducerClaims(handoff);
  });

  test("missing or deformed candidate bridge handoff row fails closed without synthesizing ownership", () => {
    const record = createCandidatePublicationBridgeRecord({ policyResult: safePolicyResult() });
    const rowsWithoutBridge = ISSUE_131_DEFERRED_HANDOFF_ROWS.filter((row) => row.rowId !== "candidate-finding-mcp-publication-bridge");
    const deformedRows = [
      {
        rowId: "candidate-finding-mcp-publication-bridge",
        requirementRefs: [],
        owner: { milestone: "M073", slice: "S99" },
        consumerOwnerLabel: "bad owner",
        proofRequiredBeforePromotion: "bad .gsd/path package verifier success claim",
        reason: "bad",
      },
    ] as unknown as readonly Issue131DeferredHandoffRow[];

    for (const handoff of [
      projectCandidatePublicationReducerHandoffInput(record, rowsWithoutBridge),
      projectCandidatePublicationReducerHandoffInput(record, deformedRows),
    ]) {
      expect(handoff.status).toBe("denied");
      expect(handoff.downstreamHandoffOwner).toBeNull();
      expect(handoff.reasonCategories).toContain("handoff-row-unavailable");
      expectNoUnsafeReducerClaims(handoff);
    }
  });

  test("reducer handoff projection preserves M072 S01 R130 ownership without publication claims", () => {
    const handoff = projectCandidatePublicationReducerHandoffInput(createCandidatePublicationBridgeRecord({
      sourceLabel: "ownership-proof",
      policyResult: safePolicyResult({ allowed: false, status: "deny", reasonCategories: ["no-evidence"] }),
    }));

    expect(handoff.downstreamHandoffOwner).toMatchObject({
      rowId: "candidate-finding-mcp-publication-bridge",
      requirementRefs: ["R130"],
      owner: { milestone: "M072", slice: "S01" },
    });
    expect(handoff.status).toBe("denied");
    expect(handoff.reasonCategories).toEqual(["no-evidence", "publication-ineligible"]);
    expectNoUnsafeReducerClaims(handoff);
  });
});
