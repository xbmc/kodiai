import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  evaluateCandidatePublicationPolicy,
  type CandidatePublicationPolicyAttempt,
  type CandidatePublicationPolicyResult,
} from "./candidate-publication-policy.ts";

const BASE_CANDIDATE: CandidatePublicationPolicyAttempt = {
  path: "src/app.ts",
  side: "RIGHT",
  line: 42,
  startLine: 40,
  reviewOutputKey: "review-output-1",
  deliveryId: "delivery-1",
  correlationKey: "correlation-1",
  body: "Use a bounded retry here.",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateKey(candidate: CandidatePublicationPolicyAttempt = BASE_CANDIDATE): string {
  const material = {
    path: String(candidate.path ?? "").trim().slice(0, 256),
    side: String(candidate.side ?? "").trim().slice(0, 32),
    line: Number(candidate.line),
    startLine: Number(candidate.startLine),
    reviewOutputKey: String(candidate.reviewOutputKey ?? "").trim().slice(0, 256),
    deliveryId: String(candidate.deliveryId ?? "").trim().slice(0, 256),
    bodySignal: sha256(String(candidate.body ?? "").slice(0, 4096)),
  };
  return `m070-publication:${sha256(JSON.stringify(material))}`;
}

function policyWithEvidence(decision: string, candidate: CandidatePublicationPolicyAttempt = BASE_CANDIDATE): CandidatePublicationPolicyResult {
  return evaluateCandidatePublicationPolicy({
    candidate,
    docsConfigTruth: { evidence: [{ candidateKey: candidateKey(candidate), decision, evidenceId: `${decision}-1` }] },
  });
}

function serialized(result: CandidatePublicationPolicyResult): string {
  return JSON.stringify(result);
}

describe("evaluateCandidatePublicationPolicy", () => {
  test("allows a verified candidate through a safe bounded policy result", () => {
    const result = policyWithEvidence("verified");

    expect(result).toMatchObject({
      allowed: true,
      status: "allow",
      verificationState: "verified",
      reasonCategories: ["full-support"],
      hasDeliveryId: true,
      hasReviewOutputKey: true,
      hasCorrelationKey: true,
    });
    expect(result.candidateRef).toMatch(/^candidate-[a-f0-9]{12}$/);
    expect(result.counts).toMatchObject({
      policyCandidateCount: 1,
      candidateCount: 1,
      evidenceCount: 1,
      verifiedCount: 1,
      publicationEligibleCount: 1,
      duplicateCount: 0,
      disagreementCount: 0,
      unclassifiableCount: 0,
      malformedRecordCount: 0,
    });
  });

  test("allows an undisputed safe partial candidate", () => {
    const result = policyWithEvidence("partially_verified");

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("allow");
    expect(result.verificationState).toBe("partially_verified");
    expect(result.reasonCategories).toEqual(["partial-support"]);
    expect(result.counts.partiallyVerifiedCount).toBe(1);
  });

  test("denies missing evidence without throwing", () => {
    const result = evaluateCandidatePublicationPolicy({
      candidate: BASE_CANDIDATE,
      docsConfigTruth: { evidence: [] },
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("deny");
    expect(result.verificationState).toBe("unverified");
    expect(result.reasonCategories).toEqual(expect.arrayContaining([
      "no-evidence",
      "classifier-fail-closed",
      "publication-ineligible",
    ]));
    expect(result.counts.evidenceCount).toBe(0);
  });

  test("denies stale or non-matching evidence keys", () => {
    const result = evaluateCandidatePublicationPolicy({
      candidate: BASE_CANDIDATE,
      docsConfigTruth: { evidence: [{ candidateKey: "m070-publication:stale", decision: "verified" }] },
    });

    expect(result.allowed).toBe(false);
    expect(result.verificationState).toBe("unverified");
    expect(result.reasonCategories).toEqual(expect.arrayContaining([
      "no-evidence",
      "classifier-fail-closed",
      "publication-ineligible",
      "candidate-stale-or-nonmatching",
    ]));
    expect(result.counts.evidenceCount).toBe(1);
  });

  test("denies disproven and disagreement evidence", () => {
    const result = evaluateCandidatePublicationPolicy({
      candidate: BASE_CANDIDATE,
      docsConfigTruth: {
        evidence: [
          { candidateKey: candidateKey(), decision: "verified", evidenceId: "support" },
          { candidateKey: candidateKey(), decision: "disproven", evidenceId: "deny" },
        ],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.verificationState).toBe("disproven");
    expect(result.reasonCategories).toEqual(expect.arrayContaining([
      "full-support",
      "evidence-contradiction",
      "evidence-conflict",
      "classifier-fail-closed",
      "publication-ineligible",
    ]));
    expect(result.counts.disagreementCount).toBeGreaterThan(0);
    expect(result.counts.disprovenCount).toBe(1);
  });

  test("denies duplicate evidence even when the remaining evidence verifies", () => {
    const key = candidateKey();
    const result = evaluateCandidatePublicationPolicy({
      candidate: BASE_CANDIDATE,
      docsConfigTruth: {
        evidence: [
          { candidateKey: key, decision: "verified", evidenceId: "same" },
          { candidateKey: key, decision: "verified", evidenceId: "same" },
        ],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.verificationState).toBe("verified");
    expect(result.reasonCategories).toEqual(expect.arrayContaining([
      "full-support",
      "evidence-duplicate-key",
      "classifier-fail-closed",
    ]));
    expect(result.counts.duplicateCount).toBeGreaterThan(0);
  });

  test("denies unclassifiable and unrecognized evidence", () => {
    const result = policyWithEvidence("invented-status");

    expect(result.allowed).toBe(false);
    expect(result.verificationState).toBe("unverified");
    expect(result.reasonCategories).toEqual(expect.arrayContaining([
      "evidence-unrecognized",
      "classifier-fail-closed",
      "publication-ineligible",
    ]));
    expect(result.counts.unclassifiableCount).toBe(1);
  });

  test("denies malformed normal-review candidate attempts as bounded policy output", () => {
    const result = evaluateCandidatePublicationPolicy({
      candidate: null,
      docsConfigTruth: { evidence: [{ candidateKey: "ignored", decision: "verified" }] },
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("deny");
    expect(result.candidateRef).toBe("candidate-unavailable");
    expect(result.verificationState).toBeNull();
    expect(result.reasonCategories).toEqual(["malformed-input", "not-exactly-one-candidate"]);
    expect(result.counts).toMatchObject({
      policyCandidateCount: 0,
      candidateCount: 0,
      malformedRecordCount: 1,
    });
  });

  test("denies absent and malformed docs/config truth aggregates", () => {
    const absent = evaluateCandidatePublicationPolicy({ candidate: BASE_CANDIDATE });
    const malformed = evaluateCandidatePublicationPolicy({
      candidate: BASE_CANDIDATE,
      docsConfigTruth: { evidence: "not-an-array" },
    });

    for (const result of [absent, malformed]) {
      expect(result.allowed).toBe(false);
      expect(result.status).toBe("deny");
      expect(result.reasonCategories).toContain("malformed-input");
      expect(result.reasonCategories).toContain("classifier-fail-closed");
      expect(result.counts.malformedRecordCount).toBeGreaterThan(0);
    }
  });

  test("denies oversized candidate and evidence arrays through S01 caps", () => {
    const manyEvidence = Array.from({ length: 120 }, (_, index) => ({
      candidateKey: index === 0 ? candidateKey() : `stale-${index}`,
      decision: "verified",
      evidenceId: `evidence-${index}`,
    }));

    const result = evaluateCandidatePublicationPolicy({
      candidate: BASE_CANDIDATE,
      docsConfigTruth: { evidence: manyEvidence },
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("deny");
    expect(result.reasonCategories).toEqual(expect.arrayContaining([
      "input-truncated",
      "publication-ineligible",
    ]));
    expect(result.counts.truncatedEvidenceCount).toBe(20);
  });

  test("serialized output excludes raw candidate, specialist, prompt, model, diff, evidence, and fingerprint canaries", () => {
    const candidate: CandidatePublicationPolicyAttempt = {
      ...BASE_CANDIDATE,
      body: "RAW-CANDIDATE-BODY-CANARY",
      prompt: "RAW-PROMPT-CANARY",
      modelOutput: "RAW-MODEL-OUTPUT-CANARY",
      rawFingerprint: "RAW-FINGERPRINT-CANARY",
    };
    const result = evaluateCandidatePublicationPolicy({
      candidate,
      docsConfigTruth: {
        evidence: [{
          candidateKey: candidateKey(candidate),
          decision: "verified",
          specialistProse: "RAW-SPECIALIST-PROSE-CANARY",
          diff: "RAW-DIFF-CANARY",
          payload: "RAW-EVIDENCE-PAYLOAD-CANARY",
        }],
      },
    });

    const output = serialized(result);
    for (const forbidden of [
      "RAW-CANDIDATE-BODY-CANARY",
      "RAW-SPECIALIST-PROSE-CANARY",
      "RAW-PROMPT-CANARY",
      "RAW-MODEL-OUTPUT-CANARY",
      "RAW-DIFF-CANARY",
      "RAW-EVIDENCE-PAYLOAD-CANARY",
      "RAW-FINGERPRINT-CANARY",
      candidateKey(candidate),
    ]) {
      expect(output).not.toContain(forbidden);
    }

    expect(result.redactionFlags).toMatchObject({
      privateOnly: true,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
    });
  });
});
