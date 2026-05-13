import { describe, expect, test } from "bun:test";

import {
  classifyCandidateVerification,
  type CandidateVerificationCandidateResult,
  type CandidateVerificationResult,
} from "./candidate-verification.ts";

function candidate(state: CandidateVerificationResult, index = 0): CandidateVerificationCandidateResult {
  const entry = state.candidates[index];
  expect(entry).toBeDefined();
  return entry as CandidateVerificationCandidateResult;
}

function serialized(result: CandidateVerificationResult): string {
  return JSON.stringify(result);
}

describe("classifyCandidateVerification", () => {
  test("classifies a fully supported candidate as verified and publication eligible", () => {
    const result = classifyCandidateVerification({
      normalReview: {
        deliveryId: " delivery-1 ",
        reviewOutputKey: " review-key-1 ",
        correlationKey: " corr-1 ",
        candidates: [{ candidateKey: "candidate-a", body: "PRIVATE CANDIDATE BODY" }],
      },
      docsConfigTruth: {
        evidence: [{ candidateKey: "candidate-a", decision: "verified", specialistProse: "PRIVATE SPECIALIST PROSE" }],
      },
    });

    expect(result.status).toBe("pass");
    expect(result.hasDeliveryId).toBe(true);
    expect(result.hasReviewOutputKey).toBe(true);
    expect(result.hasCorrelationKey).toBe(true);
    expect(candidate(result)).toMatchObject({
      candidateRef: "candidate-1",
      verificationState: "verified",
      publicationEligible: true,
      conflictFlags: [],
      reasonCategories: ["full-support"],
      hasCandidateKey: true,
      hasEvidenceKey: true,
      evidenceCount: 1,
      privateOnly: true,
    });
    expect(result.counts).toMatchObject({
      candidateCount: 1,
      evidenceCount: 1,
      verifiedCount: 1,
      publicationEligibleCount: 1,
      duplicateCount: 0,
      disagreementCount: 0,
      unclassifiableCount: 0,
    });
    expect(result.privateOnly).toBe(true);
    expect(result.publishesFindings).toBe(false);
  });

  test("classifies an undisputed partial support aggregate as partially verified and publication eligible", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: { evidence: [{ candidateKey: "candidate-a", decision: "partially_verified" }] },
    });

    expect(result.status).toBe("pass");
    expect(candidate(result)).toMatchObject({
      verificationState: "partially_verified",
      publicationEligible: true,
      conflictFlags: [],
      reasonCategories: ["partial-support"],
    });
    expect(result.counts.partiallyVerifiedCount).toBe(1);
  });

  test("classifies missing evidence as unverified and fails closed", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: { evidence: [] },
    });

    expect(result.status).toBe("fail_closed");
    expect(candidate(result)).toMatchObject({
      verificationState: "unverified",
      publicationEligible: false,
      conflictFlags: [],
      reasonCategories: ["no-evidence"],
      evidenceCount: 0,
    });
    expect(result.counts.unverifiedCount).toBe(1);
  });

  test("classifies contradiction evidence as disproven", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: { evidence: [{ candidateKey: "candidate-a", decision: "disproven" }] },
    });

    expect(result.status).toBe("fail_closed");
    expect(candidate(result)).toMatchObject({
      verificationState: "disproven",
      publicationEligible: false,
      conflictFlags: ["disagreement"],
      reasonCategories: ["evidence-contradiction", "evidence-conflict"],
      disagreementCount: 1,
      contradictionEvidenceCount: 1,
    });
    expect(result.counts.disprovenCount).toBe(1);
    expect(result.counts.disagreementCount).toBe(1);
  });

  test("counts exact duplicate evidence without inflating verification evidence", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: {
        evidence: [
          { candidateKey: "candidate-a", decision: "verified", evidenceId: "same" },
          { candidateKey: "candidate-a", decision: "verified", evidenceId: "same" },
        ],
      },
    });

    expect(result.status).toBe("fail_closed");
    expect(candidate(result)).toMatchObject({
      verificationState: "verified",
      publicationEligible: true,
      conflictFlags: ["duplicate"],
      reasonCategories: ["full-support", "evidence-duplicate-key"],
      evidenceCount: 1,
      duplicateEvidenceCount: 1,
    });
    expect(result.counts.duplicateCount).toBe(2);
  });

  test("counts conflicting lane outputs as disagreement and denies publication", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: {
        evidence: [
          { candidateKey: "candidate-a", decision: "verified", laneId: "docs" },
          { candidateKey: "candidate-a", decision: "contradiction", laneId: "config" },
        ],
      },
    });

    expect(result.status).toBe("fail_closed");
    expect(candidate(result)).toMatchObject({
      verificationState: "disproven",
      publicationEligible: false,
      conflictFlags: ["disagreement"],
      reasonCategories: ["full-support", "evidence-contradiction", "evidence-conflict"],
      evidenceCount: 2,
      disagreementCount: 2,
    });
    expect(result.counts.disagreementCount).toBe(2);
  });

  test("counts unknown evidence decisions as unclassifiable and fails closed", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: { evidence: [{ candidateKey: "candidate-a", decision: "invented-status" }] },
    });

    expect(result.status).toBe("fail_closed");
    expect(candidate(result)).toMatchObject({
      verificationState: "unverified",
      publicationEligible: false,
      conflictFlags: ["unclassifiable"],
      reasonCategories: ["evidence-unrecognized"],
      unclassifiableEvidenceCount: 1,
    });
    expect(result.counts.unclassifiableCount).toBe(1);
  });

  test("malformed input normalizes to bounded fail-closed diagnostics without throwing", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [null, { body: "missing key body" }, { candidateKey: "candidate-a" }] },
      docsConfigTruth: { evidence: "not-an-array" },
    });

    expect(result.status).toBe("fail_closed");
    expect(result.reasonCategories).toContain("malformed-input");
    expect(result.counts).toMatchObject({
      candidateCount: 3,
      evidenceCount: 0,
      unverifiedCount: 3,
      publicationEligibleCount: 0,
    });
    expect(result.counts.malformedRecordCount).toBeGreaterThanOrEqual(3);
    expect(result.candidates.map((entry) => entry.hasCandidateKey)).toEqual([false, false, true]);
    expect(result.candidates.every((entry) => entry.publicationEligible === false)).toBe(true);
  });

  test("empty aggregates fail closed with bounded zero counts", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [] },
      docsConfigTruth: { evidence: [] },
    });

    expect(result.status).toBe("fail_closed");
    expect(result.candidates).toEqual([]);
    expect(result.counts).toMatchObject({
      candidateCount: 0,
      evidenceCount: 0,
      verifiedCount: 0,
      partiallyVerifiedCount: 0,
      unverifiedCount: 0,
      disprovenCount: 0,
      publicationEligibleCount: 0,
    });
    expect(result.reasonCategories).toContain("no-evidence");
  });

  test("conflicting duplicate and disagreement evidence reports both flags while contradiction wins state precedence", () => {
    const result = classifyCandidateVerification({
      normalReview: { candidates: [{ candidateKey: "candidate-a" }] },
      docsConfigTruth: {
        evidence: [
          { candidateKey: "candidate-a", decision: "verified", evidenceId: "support-1" },
          { candidateKey: "candidate-a", decision: "verified", evidenceId: "support-1" },
          { candidateKey: "candidate-a", decision: "disproven", evidenceId: "deny-1" },
          { candidateKey: "candidate-a", decision: "disproven", evidenceId: "deny-1" },
        ],
      },
    });

    expect(result.status).toBe("fail_closed");
    expect(candidate(result)).toMatchObject({
      verificationState: "disproven",
      publicationEligible: false,
      conflictFlags: ["disagreement", "duplicate"],
      disagreementCount: 2,
      duplicateEvidenceCount: 2,
      contradictionEvidenceCount: 1,
    });
    expect(candidate(result).reasonCategories).toEqual(expect.arrayContaining([
      "full-support",
      "evidence-contradiction",
      "evidence-conflict",
      "evidence-duplicate-key",
    ]));
  });

  test("oversized arrays are clamped and reported without oversized output", () => {
    const manyCandidates = Array.from({ length: 30 }, (_, index) => ({ candidateKey: `candidate-${index}` }));
    const manyEvidence = Array.from({ length: 120 }, (_, index) => ({ candidateKey: `candidate-${index}`, decision: "verified" }));

    const result = classifyCandidateVerification({
      normalReview: { candidates: manyCandidates },
      docsConfigTruth: { evidence: manyEvidence },
    });

    expect(result.candidates).toHaveLength(25);
    expect(result.counts.truncatedCandidateCount).toBe(5);
    expect(result.counts.truncatedEvidenceCount).toBe(20);
    expect(result.reasonCategories).toContain("input-truncated");
  });

  test("serialized output does not expose raw candidate, specialist, prompt, diff, payload, or fingerprint content", () => {
    const result = classifyCandidateVerification({
      normalReview: {
        candidates: [{
          candidateKey: "candidate-a",
          fingerprint: "RAW-FINGERPRINT-SECRET",
          body: "RAW-CANDIDATE-BODY-SECRET",
          prompt: "RAW-PROMPT-SECRET",
          modelOutput: "RAW-MODEL-OUTPUT-SECRET",
          toolPayload: { token: "RAW-TOOL-PAYLOAD-SECRET" },
        }],
      },
      docsConfigTruth: {
        evidence: [{
          candidateKey: "candidate-a",
          decision: "verified",
          diff: "RAW-DIFF-SECRET",
          payload: "RAW-EVIDENCE-PAYLOAD-SECRET",
          specialistProse: "RAW-SPECIALIST-PROSE-SECRET",
        }],
      },
    });

    const output = serialized(result);
    for (const forbidden of [
      "RAW-FINGERPRINT-SECRET",
      "RAW-CANDIDATE-BODY-SECRET",
      "RAW-PROMPT-SECRET",
      "RAW-MODEL-OUTPUT-SECRET",
      "RAW-TOOL-PAYLOAD-SECRET",
      "RAW-DIFF-SECRET",
      "RAW-EVIDENCE-PAYLOAD-SECRET",
      "RAW-SPECIALIST-PROSE-SECRET",
      "candidate-a",
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
    });
  });
});
