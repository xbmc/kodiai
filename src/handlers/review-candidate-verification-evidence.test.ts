import { describe, expect, test } from "bun:test";
import type { ExecutionResult } from "../execution/types.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import { runReviewWithShadowMetrics } from "./review-shadow-specialist-metrics.test.ts";

const rawCandidateCanary = "M070_RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK";
const specialistCanary = "M070_SPECIALIST_PROSE_SHOULD_NOT_LEAK";
const promptCanary = "M070_PROMPT_SHOULD_NOT_LEAK";
const diffCanary = "M070_DIFF_SHOULD_NOT_LEAK";
const fingerprintCanary = "M070_FINGERPRINT_SHOULD_NOT_LEAK";
const toolPayloadCanary = "M070_TOOL_PAYLOAD_SHOULD_NOT_LEAK";
const evidencePayloadCanary = "M070_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK";

function buildEvidence(): CandidateVerificationPublicationEvidenceSummary {
  return {
    aggregateStatus: "mixed",
    counts: { attempted: 3, allowed: 1, denied: 2, published: 1, skipped: 1, failed: 1 },
    publicationDenialCounts: {
      "publication-ineligible": 2,
      "evidence-conflict": 1,
    },
    reasonCategories: ["publication-ineligible", "evidence-conflict"],
    verificationStateCounts: {
      verified: 1,
      partially_verified: 0,
      unverified: 1,
      disproven: 1,
      unavailable: 0,
    },
    candidateVerificationCounts: {
      candidateCount: 3,
      evidenceCount: 4,
      verifiedCount: 1,
      partiallyVerifiedCount: 0,
      unverifiedCount: 1,
      disprovenCount: 1,
      publicationEligibleCount: 1,
      duplicateCount: 0,
      disagreementCount: 1,
      unclassifiableCount: 0,
      malformedRecordCount: 0,
      truncatedCandidateCount: 0,
      truncatedEvidenceCount: 0,
      policyCandidateCount: 3,
    },
    metadata: {
      hasDeliveryId: true,
      hasReviewOutputKey: true,
      hasCorrelationKey: true,
      deliveryId: "delivery-m070-evidence",
      reviewOutputKey: "review-output-m070-evidence",
      correlationKey: "corr-m070-evidence",
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
      unsafeInputFieldCount: 7,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      publicationEvidenceIncluded: false,
    },
  };
}

function buildExecutionResult(evidence: CandidateVerificationPublicationEvidenceSummary): ExecutionResult {
  return {
    conclusion: "success",
    published: false,
    costUsd: 0,
    numTurns: 1,
    durationMs: 1,
    sessionId: "session-m070-evidence",
    errorMessage: undefined,
    model: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    cacheReadTokens: undefined,
    cacheCreationTokens: undefined,
    stopReason: undefined,
    candidateVerificationPublicationEvidence: {
      ...evidence,
      // Canaries are deliberately outside the bounded projection contract. The handler and
      // formatter must ignore them even if malformed callers attach extra private fields.
      candidate: rawCandidateCanary,
      specialistProse: specialistCanary,
      prompt: promptCanary,
      diff: diffCanary,
      fingerprint: fingerprintCanary,
      toolPayload: toolPayloadCanary,
      evidencePayload: evidencePayloadCanary,
    } as never,
  };
}

describe("review handler M070 candidate-verification aggregate evidence", () => {
  test("publishes compact Review Details projection and structured logs without leaking private payloads", async () => {
    const evidence = buildEvidence();
    const scenario = await runReviewWithShadowMetrics({
      autoApprove: false,
      executorExecute: async () => buildExecutionResult(evidence),
    });

    const visibleBodies = [
      ...scenario.issueCreatePayloads.map((payload) => String(payload.body ?? "")),
      ...scenario.issueUpdatePayloads.map((payload) => String(payload.body ?? "")),
      ...scenario.reviewCreatePayloads.map((payload) => String(payload.body ?? "")),
      ...scenario.reviewUpdatePayloads.map((payload) => String(payload.body ?? "")),
    ].join("\n");

    expect(visibleBodies).toContain("- M070 candidate verification publication: status=mixed");
    expect(visibleBodies).toContain("counts=attempted:3,allowed:1,denied:2,published:1,skipped:1,failed:1");
    expect(visibleBodies).toContain("denialCounts=publication-ineligible:2,evidence-conflict:1");
    expect(visibleBodies).toContain("deliveryIdValue:delivery-m070-evidence");
    expect(visibleBodies).toContain("reviewOutputKeyValue:review-output-m070-evidence");
    expect(visibleBodies).toContain("correlationKeyValue:corr-m070-evidence");
    expect(visibleBodies).toContain("redaction=privateOnly:y,candidateBodies:n,specialistProse:n,rawPrompts:n,rawModelOutput:n,diffs:n,evidencePayloads:n,rawFingerprints:n,publicationEvidence:n,unsafeFields:7");

    const log = scenario.entries.find((entry) => entry.data?.gate === "m070-candidate-verification-evidence");
    expect(log?.data).toMatchObject({
      gate: "m070-candidate-verification-evidence",
      aggregateStatus: "mixed",
      attemptedCount: 3,
      allowedCount: 1,
      deniedCount: 2,
      publishedCount: 1,
      skippedCount: 1,
      failedCount: 1,
      publicationDenialCounts: { "publication-ineligible": 2, "evidence-conflict": 1 },
      reasonCategories: ["publication-ineligible", "evidence-conflict"],
      hasDeliveryId: true,
      hasReviewOutputKey: true,
      hasCorrelationKey: true,
      deliveryId: "delivery-m070-evidence",
      reviewOutputKey: "review-output-m070-evidence",
      correlationKey: "corr-m070-evidence",
      privateOnly: true,
      candidateBodiesIncluded: false,
      specialistProseIncluded: false,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      diffsIncluded: false,
      evidencePayloadsIncluded: false,
      rawFingerprintsIncluded: false,
      publicationEvidenceIncluded: false,
      unsafeInputFieldCount: 7,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedEvidencePayloads: true,
      candidateAttemptIncluded: false,
      candidateKeyIncluded: false,
      boundedness: "aggregate-only",
    });
    expect(log?.data).not.toHaveProperty("candidate");
    expect(log?.data).not.toHaveProperty("specialistProse");
    expect(log?.data).not.toHaveProperty("prompt");
    expect(log?.data).not.toHaveProperty("diff");
    expect(log?.data).not.toHaveProperty("fingerprint");
    expect(log?.data).not.toHaveProperty("toolPayload");
    expect(log?.data).not.toHaveProperty("evidencePayload");

    const serializedSurfaces = JSON.stringify({ visibleBodies, log: log?.data, entries: scenario.entries });
    for (const forbidden of [
      rawCandidateCanary,
      specialistCanary,
      promptCanary,
      diffCanary,
      fingerprintCanary,
      toolPayloadCanary,
      evidencePayloadCanary,
    ]) {
      expect(serializedSurfaces).not.toContain(forbidden);
    }
  });
});
