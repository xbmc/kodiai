import { describe, expect, test } from "bun:test";
import {
  createCandidateVerificationPublicationEvidenceCollector,
  initialCandidateVerificationPublicationEvidenceSummary,
  projectCandidateVerificationPublicationEvidence,
  type CandidateVerificationPublicationEvidenceSummary,
  type CandidateVerificationPublicationEvidenceEvent,
} from "./candidate-verification-publication-evidence.ts";
import type { CandidatePublicationPolicyResult } from "./candidate-publication-policy.ts";

function policyResult(overrides: Partial<CandidatePublicationPolicyResult> = {}): CandidatePublicationPolicyResult {
  return {
    allowed: false,
    status: "deny",
    candidateRef: "candidate-public-123",
    verificationState: "disproven",
    reasonCategories: ["evidence-contradiction", "publication-ineligible"],
    counts: {
      candidateCount: 1,
      evidenceCount: 2,
      verifiedCount: 0,
      partiallyVerifiedCount: 0,
      unverifiedCount: 0,
      disprovenCount: 1,
      publicationEligibleCount: 0,
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
      unsafeInputFieldCount: 3,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
    },
    ...overrides,
  };
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

describe("candidate verification publication evidence projection", () => {
  test("projects denied, skipped, failed, allowed, and published events into aggregate-only counters", () => {
    let summary = initialCandidateVerificationPublicationEvidenceSummary();

    summary = projectCandidateVerificationPublicationEvidence(summary, {
      outcome: "denied",
      policyResult: policyResult(),
      metadata: {
        deliveryId: "delivery-m070",
        reviewOutputKey: "review-output-m070",
        correlationKey: "correlation-m070",
      },
    });
    summary = projectCandidateVerificationPublicationEvidence(summary, { outcome: "skipped", reason: "m070-candidate-verification-denied" });
    summary = projectCandidateVerificationPublicationEvidence(summary, { outcome: "failed", reason: "inline-publication-failed" });
    summary = projectCandidateVerificationPublicationEvidence(summary, {
      outcome: "allowed",
      policyResult: policyResult({
        allowed: true,
        status: "allow",
        verificationState: "partially_verified",
        reasonCategories: ["partial-support"],
        counts: { ...policyResult().counts, partiallyVerifiedCount: 1, disprovenCount: 0, publicationEligibleCount: 1 },
      }),
    });
    summary = projectCandidateVerificationPublicationEvidence(summary, { outcome: "published" });

    expect(summary.aggregateStatus).toBe("mixed");
    expect(summary.counts).toEqual({ attempted: 2, allowed: 1, denied: 1, published: 1, skipped: 1, failed: 1 });
    expect(summary.publicationDenialCounts["publication-ineligible"]).toBe(1);
    expect(summary.reasonCategories).toEqual(["evidence-contradiction", "publication-ineligible", "partial-support"]);
    expect(summary.verificationStateCounts).toMatchObject({ disproven: 1, partially_verified: 1 });
    expect(summary.candidateVerificationCounts.policyCandidateCount).toBe(2);
    expect(summary.metadata).toMatchObject({
      hasDeliveryId: true,
      hasReviewOutputKey: true,
      hasCorrelationKey: true,
      deliveryId: "delivery-m070",
      reviewOutputKey: "review-output-m070",
      correlationKey: "correlation-m070",
    });
    expect(summary.redactionFlags).toMatchObject({
      privateOnly: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
    });
  });

  test("deduplicates and caps bounded reason categories and denial counts", () => {
    let summary = initialCandidateVerificationPublicationEvidenceSummary();
    for (let index = 0; index < 20; index++) {
      summary = projectCandidateVerificationPublicationEvidence(summary, {
        outcome: "denied",
        policyResult: policyResult({
          reasonCategories: [
            "candidate-missing-key",
            "candidate-duplicate-key",
            "evidence-missing-key",
            "evidence-duplicate-key",
            "evidence-conflict",
            "evidence-contradiction",
            "evidence-unrecognized",
            "malformed-input",
            "input-truncated",
            "no-evidence",
            "partial-support",
            "full-support",
            "publication-ineligible",
            "classifier-fail-closed",
          ],
        }),
      });
    }

    expect(summary.reasonCategories).toHaveLength(12);
    expect(Object.keys(summary.publicationDenialCounts)).toHaveLength(12);
    expect(summary.counts.denied).toBe(20);
    expect(summary.publicationDenialCounts["candidate-missing-key"]).toBe(20);
  });

  test("malformed and missing policy results fail closed without throwing or leaking payload-shaped inputs", () => {
    const event = {
      outcome: "denied",
      reason: "RAW-PRIVATE-REASON-CANARY-SHOULD-NOT-LEAK",
      policyResult: null,
      candidate: {
        body: "RAW-CANDIDATE-BODY-CANARY",
        prompt: "RAW-PROMPT-CANARY",
        modelOutput: "RAW-MODEL-OUTPUT-CANARY",
        rawFingerprint: "RAW-FINGERPRINT-CANARY",
      },
      evidencePayload: { diff: "RAW-DIFF-CANARY", payload: "RAW-EVIDENCE-PAYLOAD-CANARY" },
    } as unknown as CandidateVerificationPublicationEvidenceEvent;

    const summary = projectCandidateVerificationPublicationEvidence(undefined, event);
    const serialized = serialize(summary);

    expect(summary.aggregateStatus).toBe("denied");
    expect(summary.counts).toEqual({ attempted: 1, allowed: 0, denied: 1, published: 0, skipped: 0, failed: 0 });
    expect(summary.reasonCategories).toEqual(["classifier-fail-closed", "publication-ineligible"]);
    expect(summary.candidateVerificationCounts.malformedRecordCount).toBe(1);
    for (const forbidden of [
      "RAW-PRIVATE-REASON-CANARY-SHOULD-NOT-LEAK",
      "RAW-CANDIDATE-BODY-CANARY",
      "RAW-PROMPT-CANARY",
      "RAW-MODEL-OUTPUT-CANARY",
      "RAW-FINGERPRINT-CANARY",
      "RAW-DIFF-CANARY",
      "RAW-EVIDENCE-PAYLOAD-CANARY",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("collector emits immutable bounded summaries and swallows sink failures", () => {
    const emitted: CandidateVerificationPublicationEvidenceSummary[] = [];
    const collector = createCandidateVerificationPublicationEvidenceCollector((summary) => {
      emitted.push(summary);
      throw new Error("sink unavailable");
    });

    expect(() => collector.record({ outcome: "allowed", policyResult: policyResult({ allowed: true, status: "allow", verificationState: "verified" }) })).not.toThrow();
    const before = collector.getSummary();
    expect(before.counts.allowed).toBe(1);
    expect(emitted).toHaveLength(1);

    (emitted[0]!.counts as { allowed: number }).allowed = 99;
    expect(collector.getSummary().counts.allowed).toBe(1);
  });
});
