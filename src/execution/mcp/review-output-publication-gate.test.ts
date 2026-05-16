import { describe, expect, test } from "bun:test";

import { createReviewOutputPublicationGate } from "./review-output-publication-gate.ts";
import type { CandidatePublicationPolicyResult } from "../../specialists/candidate-publication-policy.ts";

function policyResult(overrides: Partial<CandidatePublicationPolicyResult> = {}): CandidatePublicationPolicyResult {
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

function deniedPolicyResult(overrides: Partial<CandidatePublicationPolicyResult> = {}): CandidatePublicationPolicyResult {
  return policyResult({
    allowed: false,
    status: "deny",
    verificationState: "unverified",
    reasonCategories: ["no-evidence", "publication-ineligible"],
    counts: {
      ...policyResult().counts,
      evidenceCount: 0,
      verifiedCount: 0,
      unverifiedCount: 1,
      publicationEligibleCount: 0,
    },
    ...overrides,
  });
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function expectSafeBridgeJson(value: unknown): void {
  const json = stringify(value);
  expect(json).not.toContain("CANARY raw body");
  expect(json).not.toContain("secret prompt");
  expect(json).not.toContain("@@ raw diff");
  expect(json).not.toContain("raw model output");
  expect(json).not.toContain("public github comment body");
  expect(json).not.toContain("tool payload contents");
  expect(json).not.toContain("raw fingerprint value");
  expect(json).not.toContain('"body"');
  expect(json).not.toContain('"prompt"');
  expect(json).not.toContain('"diff"');
  expect(json).not.toContain('"modelOutput"');
  expect(json).not.toContain('"githubCommentBody"');
  expect(json).not.toContain('"commentBody"');
}

function createGate(overrides: Partial<Parameters<typeof createReviewOutputPublicationGate>[0]> = {}) {
  return createReviewOutputPublicationGate({
    owner: "acme",
    repo: "repo",
    prNumber: 101,
    reviewOutputKey: "review-output-gate",
    candidateVerificationContext: {
      deliveryId: "delivery-gate",
      reviewOutputKey: "review-output-gate",
      correlationKey: "upstream-correlation-gate",
      docsConfigTruth: { evidence: [] },
    },
    ...overrides,
  });
}

describe("review output publication gate bridge capture", () => {
  test("captures allowed policy state before evidence sink observes the publication attempt", () => {
    const observedBridgeStates: unknown[] = [];
    let gate: ReturnType<typeof createReviewOutputPublicationGate>;
    gate = createGate({
      candidatePublicationPolicy: () => policyResult(),
      candidateVerificationPublicationEvidenceSink: () => {
        observedBridgeStates.push(gate.getCandidatePublicationBridgeCaptureState());
      },
    });

    const result = gate.evaluateInlineCandidatePublication({
      path: "src/file.ts",
      line: 10,
      side: "RIGHT",
      body: "CANARY raw body",
    });
    const bridge = gate.getCandidatePublicationBridgeCaptureState();
    const evidence = gate.getCandidateVerificationPublicationEvidenceSummary();

    expect(result?.allowed).toBe(true);
    expect(bridge.status).toBe("captured");
    if (bridge.status !== "captured") throw new Error("expected captured bridge state");
    expect(bridge.record).toMatchObject({
      status: "allowed",
      sourceLabel: "inline-mcp-review-comment",
      candidateRef: "candidate-safe-ref",
      verificationState: "verified",
      presence: {
        hasDeliveryId: true,
        hasReviewOutputKey: true,
        hasUpstreamCorrelationKey: true,
        hasPolicyCorrelationKey: true,
      },
    });
    expect(bridge.reducerHandoffInput).toMatchObject({
      bridgeId: bridge.record.recordKey,
      recordKey: bridge.record.recordKey,
      correlationKey: bridge.record.correlationKey,
      status: "allowed",
      sourceLabel: "inline-mcp-review-comment",
      downstreamHandoffOwner: {
        rowId: "candidate-finding-mcp-publication-bridge",
        requirementRefs: ["R130"],
        owner: { milestone: "M072", slice: "S01" },
      },
    });
    expect(evidence.counts).toMatchObject({ attempted: 1, allowed: 1, denied: 0 });
    expect(observedBridgeStates).toHaveLength(1);
    expect(observedBridgeStates[0]).toMatchObject({ status: "captured" });
    expectSafeBridgeJson(bridge);
  });

  test("captures denied policy state without changing evidence summary behavior", () => {
    const gate = createGate({ candidatePublicationPolicy: () => deniedPolicyResult() });

    const result = gate.evaluateInlineCandidatePublication({ path: "src/file.ts", line: 12, side: "RIGHT", body: "CANARY raw body" });
    const bridge = gate.getCandidatePublicationBridgeCaptureState();
    const evidence = gate.getCandidateVerificationPublicationEvidenceSummary();

    expect(result?.allowed).toBe(false);
    expect(bridge.status).toBe("captured");
    if (bridge.status !== "captured") throw new Error("expected captured bridge state");
    expect(bridge.record.status).toBe("denied");
    expect(bridge.record.reasonCategories).toEqual(["no-evidence", "publication-ineligible"]);
    expect(bridge.record.malformedReasonCodes).toEqual([]);
    expect(bridge.reducerHandoffInput.status).toBe("denied");
    expect(evidence.aggregateStatus).toBe("denied");
    expect(evidence.counts).toMatchObject({ attempted: 1, allowed: 0, denied: 1 });
    expect(evidence.publicationDenialCounts).toMatchObject({ "no-evidence": 1, "publication-ineligible": 1 });
    expectSafeBridgeJson(bridge);
  });

  test("captures fail-closed malformed bridge state when the policy throws", () => {
    const gate = createGate({
      candidatePublicationPolicy: () => {
        throw new Error("policy boom with secret prompt");
      },
    });

    const result = gate.evaluateInlineCandidatePublication({ path: "src/file.ts", body: "CANARY raw body", prompt: "secret prompt" });
    const bridge = gate.getCandidatePublicationBridgeCaptureState();
    const evidence = gate.getCandidateVerificationPublicationEvidenceSummary();

    expect(result?.allowed).toBe(false);
    expect(bridge.status).toBe("captured");
    if (bridge.status !== "captured") throw new Error("expected captured bridge state");
    expect(bridge.record.status).toBe("malformed");
    expect(bridge.record.reasonCategories).toEqual(["classifier-fail-closed", "publication-ineligible"]);
    expect(bridge.record.malformedReasonCodes).toEqual([
      "missing-delivery-id",
      "missing-review-output-key",
    ]);
    expect(bridge.reducerHandoffInput.status).toBe("malformed");
    expect(evidence.counts).toMatchObject({ attempted: 1, denied: 1 });
    expect(stringify(bridge)).not.toContain("policy boom");
    expectSafeBridgeJson(bridge);
  });

  test("captures malformed no-context attempts when explicit policy evaluation is enabled", () => {
    const gate = createReviewOutputPublicationGate({
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey: "review-output-gate",
      candidatePublicationPolicy: () => deniedPolicyResult({
        allowed: false,
        status: "deny",
        verificationState: null,
        reasonCategories: ["malformed-input", "publication-ineligible"],
        counts: { ...policyResult().counts, malformedRecordCount: 1, publicationEligibleCount: 0 },
        hasDeliveryId: false,
        hasReviewOutputKey: false,
        hasCorrelationKey: false,
      }),
    });

    const result = gate.evaluateInlineCandidatePublication({ body: "CANARY raw body" });
    const bridge = gate.getCandidatePublicationBridgeCaptureState();

    expect(result?.allowed).toBe(false);
    expect(bridge.status).toBe("captured");
    if (bridge.status !== "captured") throw new Error("expected captured bridge state");
    expect(bridge.record.status).toBe("malformed");
    expect(bridge.record.presence).toEqual({
      hasDeliveryId: false,
      hasReviewOutputKey: false,
      hasUpstreamCorrelationKey: false,
      hasPolicyCorrelationKey: false,
    });
    expect(bridge.record.malformedReasonCodes).toEqual([
      "missing-delivery-id",
      "missing-review-output-key",
      "missing-correlation-key",
    ]);
    expect(bridge.reducerHandoffInput.status).toBe("malformed");
    expectSafeBridgeJson(bridge);
  });

  test("retains bounded redaction diagnostics for unsafe candidate metadata only", () => {
    const gate = createGate({ candidatePublicationPolicy: () => policyResult() });

    gate.evaluateInlineCandidatePublication({
      path: "src/file.ts",
      line: 10,
      side: "RIGHT",
      body: "CANARY raw body",
      prompt: "secret prompt",
      modelOutput: "raw model output",
      githubCommentBody: "public github comment body",
      nested: {
        diff: "@@ raw diff",
        toolPayload: "tool payload contents",
        rawFingerprint: "raw fingerprint value",
      },
    });
    const bridge = gate.getCandidatePublicationBridgeCaptureState();

    expect(bridge.status).toBe("captured");
    if (bridge.status !== "captured") throw new Error("expected captured bridge state");
    expect(bridge.record.counts.unsafeInputFieldCount).toBe(7);
    expect(bridge.record.redactionFlags).toMatchObject({
      unsafeInputFieldCount: 7,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      githubCommentBodyIncluded: false,
      reducerHandoffIncludesRawPayload: false,
    });
    expect(bridge.reducerHandoffInput.redactionFlags).toEqual(bridge.record.redactionFlags);
    expectSafeBridgeJson(bridge);
  });
});
