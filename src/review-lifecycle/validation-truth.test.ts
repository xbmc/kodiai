import { describe, expect, test } from "bun:test";
import { normalizeFindingLifecycle, type ReviewFindingInput, type ReviewFindingLifecycleRecord } from "./finding-lifecycle.ts";
import {
  reduceValidationTruth,
  type SamePrFixTruthEvidence,
  type ValidationTruthEvidence,
} from "./validation-truth.ts";

const baseCorrelation = {
  repo: "acme/widgets",
  pullNumber: 42,
  reviewOutputKey: "review-details-42",
  deliveryId: "delivery-abc",
  commitSha: "abc123def456",
};

function finding(overrides: Partial<ReviewFindingInput> = {}): ReviewFindingInput {
  return {
    filePath: "src/service.ts",
    startLine: 12,
    endLine: 14,
    severity: "major",
    category: "correctness",
    title: "Missing rollback when publish fails",
    confidence: 88,
    actionability: "actionable",
    validationNeeds: ["needs-tests"],
    revalidationState: "pending",
    evidenceRefs: [{ kind: "file", ref: "src/service.ts:12" }],
    reasonCodes: ["missing-rollback"],
    statusHistory: [{ status: "detected", reasonCode: "review-detected" }],
    ...overrides,
  };
}

function record(overrides: Partial<ReviewFindingInput> = {}): ReviewFindingLifecycleRecord {
  const result = normalizeFindingLifecycle({ ...baseCorrelation, findings: [finding(overrides)] });
  const normalized = result.records[0];
  if (!normalized) throw new Error("expected normalized finding");
  return normalized;
}

function fixFor(finding: ReviewFindingLifecycleRecord, overrides: Partial<SamePrFixTruthEvidence> = {}): SamePrFixTruthEvidence {
  return {
    reviewOutputKey: finding.reviewOutputKey,
    deliveryId: finding.deliveryId,
    repo: finding.repo,
    pullNumber: finding.pullNumber,
    findingId: finding.id,
    status: "suggested",
    suggested: true,
    replacementText: "private replacement text must not project",
    ...overrides,
  };
}

function validationFor(
  finding: ReviewFindingLifecycleRecord,
  overrides: Partial<ValidationTruthEvidence> = {},
): ValidationTruthEvidence {
  return {
    reviewOutputKey: finding.reviewOutputKey,
    deliveryId: finding.deliveryId,
    repo: finding.repo,
    pullNumber: finding.pullNumber,
    findingId: finding.id,
    status: "passed",
    evidenceFresh: true,
    ...overrides,
  };
}

describe("reduceValidationTruth", () => {
  test("keeps suggested same-PR fixes non-resolved when validation is missing", () => {
    const lifecycle = record();
    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      findings: [lifecycle],
      samePrFixes: [fixFor(lifecycle)],
    });

    expect(result.records[0]).toMatchObject({
      id: lifecycle.id,
      status: "suggested",
      hasSuggestedFix: true,
      reasonCodes: ["suggested-but-open", "validation-missing"],
      validation: { present: false, passed: false, fresh: false },
    });
    expect(result.projection.counts).toMatchObject({ detected: 1, suggested: 1, resolved: 0 });
    expect(result.projection.reasonCounts).toMatchObject({ "suggested-but-open": 1, "validation-missing": 1 });
  });

  test("resolves only with same-identity fresh validation and required fresh revalidation", () => {
    const lifecycle = record();
    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      requireRevalidation: true,
      findings: [lifecycle],
      samePrFixes: [fixFor(lifecycle)],
      validations: [validationFor(lifecycle)],
      revalidations: [validationFor(lifecycle)],
    });

    expect(result.records[0]).toMatchObject({
      status: "resolved",
      reasonCodes: ["suggested-but-open", "validation-passed", "revalidation-passed", "resolved"],
      validation: { present: true, passed: true, fresh: true },
      revalidation: { present: true, passed: true, fresh: true },
    });
    expect(result.projection.counts).toMatchObject({ detected: 1, suggested: 1, validated: 1, revalidated: 1, resolved: 1 });
    expect(result.projection.evidenceFreshness).toMatchObject({ fresh: 1, stale: 0, missingValidation: 0, missingRevalidation: 0 });
  });

  test("requires matching finding identity before validation can close a finding", () => {
    const lifecycle = record();
    const other = record({ title: "Different finding identity" });
    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      findings: [lifecycle],
      validations: [validationFor(other, { findingId: other.id })],
    });

    expect(result.records[0]?.status).toBe("open");
    expect(result.records[0]?.reasonCodes).toEqual(["validation-missing"]);
    expect(result.projection.counts.resolved).toBe(0);
  });

  test("preserves non-resolved states for failed, stale, missing, and failed revalidation evidence", () => {
    const failedValidation = record({ title: "Failed validation" });
    const staleValidation = record({ title: "Stale validation" });
    const missingRevalidation = record({ title: "Missing revalidation" });
    const failedRevalidation = record({ title: "Failed revalidation" });

    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      requireRevalidation: true,
      findings: [failedValidation, staleValidation, missingRevalidation, failedRevalidation],
      validations: [
        validationFor(failedValidation, { status: "failed" }),
        validationFor(staleValidation, { evidenceFresh: false }),
        validationFor(missingRevalidation),
        validationFor(failedRevalidation),
      ],
      revalidations: [validationFor(failedRevalidation, { status: "failed" })],
    });

    expect(result.records.map((truth) => [truth.status, truth.reasonCodes.at(-1)])).toEqual([
      ["open", "validation-failed"],
      ["uncertain", "validation-stale"],
      ["uncertain", "revalidation-missing"],
      ["open", "revalidation-failed"],
    ]);
    expect(result.projection.counts.resolved).toBe(0);
    expect(result.projection.reasonCounts).toMatchObject({
      "validation-failed": 1,
      "validation-stale": 1,
      "revalidation-missing": 1,
      "revalidation-failed": 1,
    });
  });

  test("fails closed for malformed review correlation and blocked or degraded evidence", () => {
    const malformed = record({ title: "Malformed correlation" });
    const blocked = record({ title: "Blocked evidence" });
    const degraded = record({ title: "Degraded evidence" });

    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      findings: [malformed, blocked, degraded],
      validations: [
        validationFor(malformed, { reviewOutputKey: "wrong-review-key" }),
        validationFor(blocked, { status: "blocked" }),
        validationFor(degraded, { status: "degraded" }),
      ],
    });

    expect(result.records.map((truth) => [truth.status, truth.reasonCodes])).toEqual([
      ["degraded", ["degraded"]],
      ["blocked", ["blocked"]],
      ["degraded", ["degraded"]],
    ]);
    expect(result.projection.status).toBe("degraded");
    expect(result.projection.counts).toMatchObject({ blocked: 1, degraded: 2, resolved: 0 });
  });

  test("caps public arrays so large reviews increase counts instead of visible volume", () => {
    const findings = Array.from({ length: 24 }, (_, index) => record({
      filePath: `src/file-${index}.ts`,
      startLine: index + 1,
      endLine: index + 1,
      title: `Finding ${index}`,
    }));
    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      findings,
      validations: findings.map((item, index) => validationFor(item, { status: index % 2 === 0 ? "failed" : "passed" })),
    });

    expect(result.projection.counts.detected).toBe(24);
    expect(result.projection.references).toHaveLength(5);
    expect(result.projection.omitted.references).toBe(19);
    expect(Object.keys(result.projection.reasonCounts).length).toBeLessThanOrEqual(8);
  });

  test("does not leak raw prompts, model output, candidate bodies, replacements, tool payloads, secrets, or diffs", () => {
    const lifecycle = record();
    const result = reduceValidationTruth({
      reviewOutputKey: baseCorrelation.reviewOutputKey,
      deliveryId: baseCorrelation.deliveryId,
      requireRevalidation: true,
      findings: [lifecycle],
      samePrFixes: [fixFor(lifecycle, {
        rawPrompt: "RAW_PROMPT_CANARY BEGIN PROMPT hidden instructions",
        rawModelOutput: "RAW_MODEL_OUTPUT_CANARY model output",
        candidateBody: "CANDIDATE_BODY_CANARY candidate body",
        replacementText: "REPLACEMENT_CANARY token=sk-supersecret12345",
        toolPayload: { private: "TOOL_PAYLOAD_CANARY" },
        diffText: "DIFF_TEXT_CANARY diff --git a/src/a.ts b/src/a.ts",
      })],
      validations: [validationFor(lifecycle, { rawPayload: { private: "RAW_PAYLOAD_CANARY" } })],
      revalidations: [validationFor(lifecycle)],
    });

    const projectionJson = JSON.stringify(result.projection);
    for (const forbidden of [
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "CANDIDATE_BODY_CANARY",
      "REPLACEMENT_CANARY",
      "sk-supersecret12345",
      "TOOL_PAYLOAD_CANARY",
      "DIFF_TEXT_CANARY",
      "diff --git",
      "RAW_PAYLOAD_CANARY",
    ]) {
      expect(projectionJson).not.toContain(forbidden);
    }
    expect(result.projection.redaction).toMatchObject({
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      replacementTextIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
    });
    expect(result.projection.redaction.unsafeInputFieldCount).toBeGreaterThan(0);
  });
});
