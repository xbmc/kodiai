import { describe, expect, test } from "bun:test";

import {
  EXPECTED_PACKAGE_SCRIPT,
  M070_S05_CHECK_IDS,
  evaluateM070S05Integration,
  main,
  parseM070S05Args,
  runM070S05Scenario,
  type M070S05ScenarioRow,
} from "./verify-m070-s05.ts";
import { evaluateM070VerifierScenario, type M070ScenarioName, type M070StatusCode } from "./verify-m070.ts";

const GENERATED_AT = "2026-05-10T00:00:00.000Z";
const CANARY = "M070_S05_TEST_CANARY_SHOULD_NOT_LEAK";

type Spec = {
  readonly kind: M070S05ScenarioRow["scenario"];
  readonly verifierScenario: M070ScenarioName;
  readonly expectedStatus: M070StatusCode;
  readonly fallbackAfterDenied?: boolean;
};

function syntheticRow(overrides: Partial<M070S05ScenarioRow> & Pick<M070S05ScenarioRow, "scenario" | "verifierScenario" | "expectedStatus">): M070S05ScenarioRow {
  const { scenario, verifierScenario, expectedStatus, ...rowOverrides } = overrides;
  const m070 = evaluateM070VerifierScenario({
    scenario: verifierScenario,
    aggregateEvidence: {
      aggregateStatus: "mixed",
      counts: { attempted: 1, allowed: 1, denied: 0, published: 1, skipped: 0, failed: 0 },
      publicationDenialCounts: {},
      reasonCategories: ["full-support"],
      verificationStateCounts: { verified: 1, partially_verified: 0, unverified: 0, disproven: 0, unavailable: 0 },
      candidateVerificationCounts: { candidateCount: 1, evidenceCount: 1, verifiedCount: 1, partiallyVerifiedCount: 0, unverifiedCount: 0, disprovenCount: 0, publicationEligibleCount: 1, duplicateCount: 0, disagreementCount: 0, unclassifiableCount: 0, malformedRecordCount: 0, truncatedCandidateCount: 0, truncatedEvidenceCount: 0, policyCandidateCount: 1 },
      metadata: { hasDeliveryId: true, hasReviewOutputKey: true, hasCorrelationKey: true },
      redactionFlags: { privateOnly: true, candidateBodiesIncluded: false, specialistProseIncluded: false, rawPromptsIncluded: false, rawModelOutputIncluded: false, diffsIncluded: false, evidencePayloadsIncluded: false, rawFingerprintsIncluded: false, unsafeInputFieldCount: 0, discardedRawPayload: false, discardedPublicationFields: false, discardedEvidencePayloads: false, candidateAttemptIncluded: false, candidateKeyIncluded: false, publicationEvidenceIncluded: false },
    },
    publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
  }, { generatedAt: GENERATED_AT });
  return {
    scenario,
    verifierScenario,
    success: m070.success,
    expectedStatus,
    actualStatus: expectedStatus,
    statusMatchesExpected: true,
    m070,
    publicationMode: { candidateApprovedNonFallback: scenario === "verified" || scenario === "partial", directFallbackEvidence: scenario === "direct-fallback-only", fallbackBlocked: scenario === "direct-fallback-only" },
    correlationMetadata: { contextHasDeliveryId: true, contextHasReviewOutputKey: true, contextHasCorrelationKey: true, evidenceHasDeliveryId: true, evidenceHasReviewOutputKey: true, evidenceHasCorrelationKey: true },
    evidenceSurfaces: { reviewDetailsPresent: true, runtimeLogPresent: true, mcpEvidencePresent: true },
    visibleVolume: { issueCreateCount: 1, issueUpdateCount: 0, reviewCreateCount: 0, reviewUpdateCount: 0, reviewCommentCount: scenario === "verified" || scenario === "partial" ? 1 : 0, totalVisibleBodies: scenario === "verified" || scenario === "partial" ? 2 : 1 },
    denialReasonCategories: [],
    redaction: { candidateCanaryLeaked: false, specialistCanaryLeaked: false, rawCanaryLeaked: false, verifierJsonLeakPresent: false, aggregateOnly: true },
    issue_categories: [],
    ...rowOverrides,
  } as M070S05ScenarioRow;
}

function rowForSpec(spec: Spec): M070S05ScenarioRow {
  const positive = spec.kind === "verified" || spec.kind === "partial";
  const actualStatus = spec.expectedStatus;
  const m070 = evaluateM070VerifierScenario({
    scenario: spec.verifierScenario,
    aggregateEvidence: positive ? {
      aggregateStatus: "mixed",
      counts: { attempted: 1, allowed: 1, denied: 0, published: 1, skipped: 0, failed: 0 },
      publicationDenialCounts: {},
      reasonCategories: [spec.kind === "partial" ? "partial-support" : "full-support"],
      verificationStateCounts: { verified: spec.kind === "partial" ? 0 : 1, partially_verified: spec.kind === "partial" ? 1 : 0, unverified: 0, disproven: 0, unavailable: 0 },
      candidateVerificationCounts: { candidateCount: 1, evidenceCount: 1, verifiedCount: spec.kind === "partial" ? 0 : 1, partiallyVerifiedCount: spec.kind === "partial" ? 1 : 0, unverifiedCount: 0, disprovenCount: 0, publicationEligibleCount: 1, duplicateCount: 0, disagreementCount: 0, unclassifiableCount: 0, malformedRecordCount: 0, truncatedCandidateCount: 0, truncatedEvidenceCount: 0, policyCandidateCount: 1 },
      metadata: { hasDeliveryId: true, hasReviewOutputKey: true, hasCorrelationKey: true },
      redactionFlags: { privateOnly: true, candidateBodiesIncluded: false, specialistProseIncluded: false, rawPromptsIncluded: false, rawModelOutputIncluded: false, diffsIncluded: false, evidencePayloadsIncluded: false, rawFingerprintsIncluded: false, unsafeInputFieldCount: 0, discardedRawPayload: false, discardedPublicationFields: false, discardedEvidencePayloads: false, candidateAttemptIncluded: false, candidateKeyIncluded: false, publicationEvidenceIncluded: false },
    } : null,
    publicationMode: { candidateApprovedNonFallback: positive, directFallbackEvidence: false },
  }, { generatedAt: GENERATED_AT });
  return syntheticRow({ scenario: spec.kind, verifierScenario: spec.verifierScenario, expectedStatus: spec.expectedStatus, actualStatus, success: positive, m070 });
}

describe("verify:m070:s05 integration CLI contract", () => {
  test("parses only aggregate JSON/help args and rejects unsupported paths", () => {
    expect(parseM070S05Args([])).toEqual({ json: false, help: false });
    expect(parseM070S05Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM070S05Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM070S05Args(["--scenario", ".gsd/private.json"])).toThrow(/invalid_cli_args/);
  });

  test("reports full injected scenario matrix success, package wiring, S06 live proof distinction, and aggregate-only fields", async () => {
    const report = await evaluateM070S05Integration({
      generatedAt: GENERATED_AT,
      runScenario: async (spec) => rowForSpec(spec as unknown as Spec),
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s05": EXPECTED_PACKAGE_SCRIPT } }),
    });

    expect(report).toMatchObject({
      command: "verify:m070:s05",
      proofMode: "local-in-process-normal-review-integration",
      proofScope: "s05-normal-review-handler-mcp-review-details-verifier-semantics",
      liveExactKeyProofRequiredBy: "S06",
      success: true,
      status_code: "m070_s05_ok",
      failing_check_id: null,
      packageWiring: { present: true, matches: true },
      redaction: { aggregateOnly: true, canaryLeakPresent: false, verifierJsonLeakPresent: false },
    });
    expect(report.check_ids).toEqual(M070_S05_CHECK_IDS);
    expect(report.scenarioRows).toHaveLength(8);
    expect(report.publicationModes).toMatchObject({ candidateApprovedNonFallbackCount: 2, directFallbackEvidenceCount: 1, fallbackBlockedCount: 1 });
    expect(JSON.stringify(report)).not.toContain(CANARY);
  });

  test("fails closed on package wiring mismatch, scenario status drift, direct fallback acceptance, and redaction leak", async () => {
    const report = await evaluateM070S05Integration({
      generatedAt: GENERATED_AT,
      runScenario: async (spec) => {
        const row = rowForSpec(spec as unknown as Spec);
        if ((spec as unknown as Spec).kind === "verified") return { ...row, actualStatus: "m070_dispute_blocked", statusMatchesExpected: false, issue_categories: ["scenario-status-drift"] };
        if ((spec as unknown as Spec).kind === "direct-fallback-only") return { ...row, publicationMode: { ...row.publicationMode, fallbackBlocked: false }, issue_categories: ["direct-fallback-not-blocked"] };
        if ((spec as unknown as Spec).kind === "dispute") return { ...row, redaction: { ...row.redaction, candidateCanaryLeaked: true }, issue_categories: ["redaction-leak"] };
        return row;
      },
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070:s05": "bun wrong.ts" } }),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_s05_contract_failed");
    expect(report.issue_categories).toEqual(expect.arrayContaining(["scenario-status-drift", "direct-fallback-not-blocked", "redaction-leak", "package-wiring"]));
    expect(report.checks.some((check) => !check.passed)).toBe(true);
  });

  test("malformed package JSON and injected runner failure return bounded failure report", async () => {
    const report = await evaluateM070S05Integration({
      generatedAt: GENERATED_AT,
      runScenario: async () => { throw new Error(`${CANARY} should be bounded`); },
      readPackageJsonText: async () => "{not json",
    });

    expect(report.success).toBe(false);
    expect(report.issue_categories).toEqual(expect.arrayContaining(["scenario-runner-failed", "package-wiring"]));
    expect(JSON.stringify(report)).not.toContain(CANARY);
    expect(report.scenarioRows.every((row) => row.issue_categories.includes("scenario-runner-failed"))).toBe(true);
  });

  test("main returns nonzero invalid-arg reports and aggregate-only JSON", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await main(["--scenario", ".gsd/private.json"], {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain('"status_code": "m070_s05_invalid_arg"');
    expect(stderr).toContain("invalid_cli_args");
    expect(stdout).not.toContain("private.json\":{");
  });

  test("real verified scenario reaches handler, MCP publication gate, Review Details, logs, and M070 success semantics", async () => {
    const row = await runM070S05Scenario({ kind: "verified", verifierScenario: "candidate_approved_verified", expectedStatus: "m070_candidate_approved_verified_ok", candidateBody: "M070 S05 TEST SAFE VERIFIED INLINE BODY" }, GENERATED_AT);

    expect(row.success).toBe(true);
    expect(row.actualStatus).toBe("m070_candidate_approved_verified_ok");
    expect(row.publicationMode).toMatchObject({ candidateApprovedNonFallback: true, directFallbackEvidence: false });
    expect(row.evidenceSurfaces).toEqual({ reviewDetailsPresent: true, runtimeLogPresent: true, mcpEvidencePresent: true });
    expect(row.correlationMetadata).toMatchObject({ contextHasDeliveryId: true, contextHasReviewOutputKey: true, contextHasCorrelationKey: true, evidenceHasDeliveryId: true, evidenceHasReviewOutputKey: true, evidenceHasCorrelationKey: true });
    expect(row.redaction.aggregateOnly).toBe(true);
    expect(row.redaction.candidateCanaryLeaked).toBe(false);
  });
});
