import { describe, expect, test } from "bun:test";

import {
  M070_CHECK_IDS,
  M070_SCENARIO_NAMES,
  buildM070FixtureScenario,
  evaluateM070VerifierContract,
  evaluateM070VerifierScenario,
  main,
  parseM070Args,
  type M070VerifierScenarioInput,
} from "./verify-m070.ts";

const GENERATED_AT = "2026-05-10T00:00:00.000Z";

function evaluate(input: M070VerifierScenarioInput) {
  return evaluateM070VerifierScenario(input, { generatedAt: GENERATED_AT });
}

function scenario(name: Parameters<typeof buildM070FixtureScenario>[0]) {
  return buildM070FixtureScenario(name);
}

describe("verify-m070 pure evaluator", () => {
  test("exports stable check ids, scenario names, and bounded CLI parse helpers", () => {
    expect(M070_CHECK_IDS).toEqual([
      "M070-FIXTURE-CONTRACT",
      "M070-CANDIDATE-APPROVED-PUBLICATION",
      "M070-CORRELATION-METADATA",
      "M070-SAFETY-BLOCKERS",
      "M070-REDACTION-BOUNDARY",
      "M070-PACKAGE-WIRING",
    ]);
    expect(M070_SCENARIO_NAMES).toEqual([
      "candidate_approved_verified",
      "candidate_approved_partial_undisputed",
      "dispute_blocked",
      "unclassifiable_blocked",
      "missing_correlation",
      "malformed_evidence",
      "direct_fallback_only",
    ]);
    expect(parseM070Args([])).toEqual({ json: false, help: false, scenario: null, expectStatus: null });
    expect(parseM070Args(["--json", "--scenario", "direct_fallback_only"])).toEqual({ json: true, help: false, scenario: "direct_fallback_only", expectStatus: null });
    expect(parseM070Args(["--json", "--fixture", "direct_fallback_only", "--expect-status", "m070_direct_fallback_rejected"])).toEqual({ json: true, help: false, scenario: "direct_fallback_only", expectStatus: "m070_direct_fallback_rejected" });
    expect(parseM070Args(["--help"])).toEqual({ json: false, help: true, scenario: null, expectStatus: null });
    expect(() => parseM070Args(["--fixture", ".gsd/private.json"])).toThrow(/invalid_cli_args/);
    expect(() => parseM070Args(["--scenario", "unknown"])).toThrow(/invalid_cli_args/);
    expect(() => parseM070Args(["--expect-status", "unknown"])).toThrow(/invalid_cli_args/);
  });

  test("accepts verified candidate-approved non-fallback publication evidence with required correlation", () => {
    const report = evaluate(scenario("candidate_approved_verified"));

    expect(report).toMatchObject({
      command: "verify:m070",
      generated_at: GENERATED_AT,
      proofMode: "local-fixture-pure-evaluator",
      proofScope: "s04-verifier-success-semantics",
      scenario: "candidate_approved_verified",
      success: true,
      status_code: "m070_candidate_approved_verified_ok",
      failing_check_id: null,
      publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
      correlationMetadata: { hasDeliveryId: true, hasReviewOutputKey: true, hasCorrelationKey: true },
      safety: { disputed: false, unclassifiableOrBlocked: false, malformed: false, missingCorrelation: false, directFallbackOnly: false },
      redaction: {
        privateOnly: true,
        candidateBodiesIncluded: false,
        specialistProseIncluded: false,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        diffsIncluded: false,
        evidencePayloadsIncluded: false,
        rawFingerprintsIncluded: false,
        publicationEvidenceIncluded: false,
        candidateAttemptIncluded: false,
        candidateKeyIncluded: false,
      },
      issues: [],
    });
    expect(report.check_ids).toEqual([
      "M070-CANDIDATE-APPROVED-PUBLICATION",
      "M070-CORRELATION-METADATA",
      "M070-SAFETY-BLOCKERS",
      "M070-REDACTION-BOUNDARY",
    ]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.aggregateEvidence.counts).toMatchObject({ allowed: 1, published: 1 });
    expect(report.aggregateEvidence.candidateVerificationCounts).toMatchObject({ verifiedCount: 1, publicationEligibleCount: 1 });
  });

  test("accepts safe undisputed partial candidate-approved non-fallback publication evidence", () => {
    const report = evaluate(scenario("candidate_approved_partial_undisputed"));

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m070_candidate_approved_partial_ok");
    expect(report.safety.undisputedPartial).toBe(true);
    expect(report.aggregateEvidence.verificationStateCounts).toMatchObject({ partially_verified: 1 });
    expect(report.aggregateEvidence.candidateVerificationCounts).toMatchObject({ partiallyVerifiedCount: 1 });
  });

  test("reports dispute-blocked safety as success false", () => {
    const report = evaluate(scenario("dispute_blocked"));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_dispute_blocked");
    expect(report.failing_check_id).toBe("M070-SAFETY-BLOCKERS");
    expect(report.safety.disputed).toBe(true);
    expect(report.issue_categories).toContain("dispute-blocked");
  });

  test("reports unclassifiable/blocked safety as success false", () => {
    const report = evaluate(scenario("unclassifiable_blocked"));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_unclassifiable_blocked");
    expect(report.failing_check_id).toBe("M070-SAFETY-BLOCKERS");
    expect(report.safety.unclassifiableOrBlocked).toBe(true);
    expect(report.issue_categories).toContain("unclassifiable-blocked");
  });

  test("reports missing correlation metadata as success false", () => {
    const report = evaluate(scenario("missing_correlation"));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_missing_correlation_blocked");
    expect(report.failing_check_id).toBe("M070-CORRELATION-METADATA");
    expect(report.safety.missingCorrelation).toBe(true);
    expect(report.correlationMetadata).toMatchObject({ hasDeliveryId: true, hasReviewOutputKey: false, hasCorrelationKey: true });
  });

  test("reports malformed or missing aggregate evidence as success false without throwing", () => {
    for (const aggregateEvidence of [null, {}, { aggregateStatus: "wrong-status" }, { counts: {} }]) {
      const report = evaluate({
        scenario: "malformed_evidence",
        aggregateEvidence,
        publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
      });

      expect(report.success).toBe(false);
      expect(report.status_code).toBe("m070_malformed_evidence_blocked");
      expect(report.safety.malformed).toBe(true);
      expect(report.issue_categories).toContain("malformed-evidence");
    }
  });

  test("rejects direct-fallback-only evidence even when aggregate counts look otherwise successful", () => {
    const report = evaluate(scenario("direct_fallback_only"));

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_direct_fallback_rejected");
    expect(report.failing_check_id).toBe("M070-CANDIDATE-APPROVED-PUBLICATION");
    expect(report.safety.directFallbackOnly).toBe(true);
  });

  test("boundary cases fail closed: mixed denied disputes, published without allowed, allowed without published, and missing individual correlation keys", () => {
    const mixedAllowedDenied = scenario("candidate_approved_verified");
    const mixedReport = evaluate({
      ...mixedAllowedDenied,
      aggregateEvidence: {
        ...mixedAllowedDenied.aggregateEvidence as object,
        counts: { attempted: 2, allowed: 1, denied: 1, published: 1, skipped: 0, failed: 0 },
        publicationDenialCounts: { "evidence-conflict": 1 },
        reasonCategories: ["full-support", "evidence-conflict"],
        candidateVerificationCounts: {
          candidateCount: 2,
          evidenceCount: 2,
          verifiedCount: 1,
          partiallyVerifiedCount: 0,
          unverifiedCount: 0,
          disprovenCount: 1,
          publicationEligibleCount: 1,
          duplicateCount: 0,
          disagreementCount: 1,
          unclassifiableCount: 0,
          malformedRecordCount: 0,
          truncatedCandidateCount: 0,
          truncatedEvidenceCount: 0,
          policyCandidateCount: 2,
        },
      },
    });
    expect(mixedReport.status_code).toBe("m070_dispute_blocked");

    for (const counts of [
      { attempted: 1, allowed: 0, denied: 0, published: 1, skipped: 0, failed: 0 },
      { attempted: 1, allowed: 1, denied: 0, published: 0, skipped: 0, failed: 0 },
    ]) {
      const input = scenario("candidate_approved_verified");
      const report = evaluate({ ...input, aggregateEvidence: { ...input.aggregateEvidence as object, counts } });
      expect(report.success).toBe(false);
      expect(report.status_code).toBe("m070_malformed_evidence_blocked");
    }

    for (const metadata of [
      { hasDeliveryId: false, hasReviewOutputKey: true, hasCorrelationKey: true },
      { hasDeliveryId: true, hasReviewOutputKey: false, hasCorrelationKey: true },
      { hasDeliveryId: true, hasReviewOutputKey: true, hasCorrelationKey: false },
    ]) {
      const input = scenario("candidate_approved_verified");
      const report = evaluate({ ...input, aggregateEvidence: { ...input.aggregateEvidence as object, metadata } });
      expect(report.success).toBe(false);
      expect(report.status_code).toBe("m070_missing_correlation_blocked");
    }
  });

  test("serialized reports omit raw candidate, specialist, prompt, model/tool, diff, fingerprint, candidate-key, and payload canaries", () => {
    const report = evaluate({
      scenario: "candidate_approved_verified",
      aggregateEvidence: {
        ...scenario("candidate_approved_verified").aggregateEvidence as object,
        rawCandidateBody: "M070_RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
        specialistProse: "M070_SPECIALIST_PROSE_SHOULD_NOT_LEAK",
        prompt: "M070_PROMPT_SHOULD_NOT_LEAK",
        rawModelOutput: "M070_RAW_MODEL_OUTPUT_SHOULD_NOT_LEAK",
        toolPayload: "M070_TOOL_PAYLOAD_SHOULD_NOT_LEAK",
        diff: "M070_DIFF_SHOULD_NOT_LEAK",
        fingerprint: "M070_FINGERPRINT_SHOULD_NOT_LEAK",
        candidateKey: "M070_CANDIDATE_KEY_SHOULD_NOT_LEAK",
        evidencePayload: "M070_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK",
      },
      publicationMode: { candidateApprovedNonFallback: true, directFallbackEvidence: false },
    });
    const serialized = JSON.stringify(report);

    expect(report.redaction.forbiddenInputFieldPresent).toBe(true);
    for (const forbidden of [
      "M070_RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
      "M070_SPECIALIST_PROSE_SHOULD_NOT_LEAK",
      "M070_PROMPT_SHOULD_NOT_LEAK",
      "M070_RAW_MODEL_OUTPUT_SHOULD_NOT_LEAK",
      "M070_TOOL_PAYLOAD_SHOULD_NOT_LEAK",
      "M070_DIFF_SHOULD_NOT_LEAK",
      "M070_FINGERPRINT_SHOULD_NOT_LEAK",
      "M070_CANDIDATE_KEY_SHOULD_NOT_LEAK",
      "M070_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("default fixture contract accepts only expected positive scenarios and rejects required negatives", async () => {
    const report = await evaluateM070VerifierContract({
      generatedAt: GENERATED_AT,
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070": "bun scripts/verify-m070.ts" } }),
    });

    expect(report).toMatchObject({
      command: "verify:m070",
      generated_at: GENERATED_AT,
      proofMode: "local-fixture-contract",
      success: true,
      status_code: "m070_fixture_contract_ok",
      packageWiring: { present: true, matches: true },
    });
    expect(report.check_ids).toEqual(M070_CHECK_IDS);
    expect(report.targetedTests).toContain("bun test ./scripts/verify-m070.test.ts && bun run verify:m070 --json");
    expect(report.scenarioReports.map((entry) => [entry.scenario, entry.success, entry.status_code])).toEqual([
      ["candidate_approved_verified", true, "m070_candidate_approved_verified_ok"],
      ["candidate_approved_partial_undisputed", true, "m070_candidate_approved_partial_ok"],
      ["dispute_blocked", false, "m070_dispute_blocked"],
      ["unclassifiable_blocked", false, "m070_unclassifiable_blocked"],
      ["missing_correlation", false, "m070_missing_correlation_blocked"],
      ["malformed_evidence", false, "m070_malformed_evidence_blocked"],
      ["direct_fallback_only", false, "m070_direct_fallback_rejected"],
    ]);
  });

  test("fixture contract fails boundedly on package wiring drift and malformed package JSON", async () => {
    const drift = await evaluateM070VerifierContract({
      generatedAt: GENERATED_AT,
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070": "bun wrong.ts" } }),
    });
    expect(drift.success).toBe(false);
    expect(drift.status_code).toBe("m070_contract_failed");
    expect(drift.failing_check_id).toBe("M070-PACKAGE-WIRING");
    expect(drift.issues.join("\n")).toContain("package.json scripts.verify:m070 must equal bun scripts/verify-m070.ts");

    const malformed = await evaluateM070VerifierContract({
      generatedAt: GENERATED_AT,
      readPackageJsonText: async () => "{not-json",
    });
    expect(malformed.success).toBe(false);
    expect(malformed.packageWiring).toMatchObject({ present: false, matches: false });
    expect(JSON.stringify(malformed)).not.toContain("{not-json");
  });

  test("main emits parseable JSON for default contract, single-scenario passing/failing, invalid args, and help paths", async () => {
    const contractStdout: string[] = [];
    const contractExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void contractStdout.push(chunk) },
      stderr: { write: () => undefined },
      readPackageJsonText: async () => JSON.stringify({ scripts: { "verify:m070": "bun scripts/verify-m070.ts" } }),
    });
    expect(contractExitCode).toBe(0);
    const contractReport = JSON.parse(contractStdout.join(""));
    expect(contractReport).toMatchObject({ success: true, status_code: "m070_fixture_contract_ok" });
    expect(contractReport.scenarioReports).toHaveLength(M070_SCENARIO_NAMES.length);

    const passingStdout: string[] = [];
    const passExitCode = await main(["--json", "--scenario", "candidate_approved_verified"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({ success: true, status_code: "m070_candidate_approved_verified_ok" });

    const failingStdout: string[] = [];
    const failExitCode = await main(["--json", "--scenario", "direct_fallback_only"], {
      stdout: { write: (chunk: string) => void failingStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(failExitCode).toBe(1);
    expect(JSON.parse(failingStdout.join(""))).toMatchObject({ success: false, status_code: "m070_direct_fallback_rejected" });

    const fixtureStdout: string[] = [];
    const fixtureExitCode = await main(["--json", "--fixture", "direct_fallback_only", "--expect-status", "m070_direct_fallback_rejected"], {
      stdout: { write: (chunk: string) => void fixtureStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(fixtureExitCode).toBe(0);
    expect(JSON.parse(fixtureStdout.join(""))).toMatchObject({ success: false, status_code: "m070_direct_fallback_rejected" });

    const mismatchedExpectedStatusStdout: string[] = [];
    const mismatchedExpectedStatusExitCode = await main(["--json", "--fixture", "direct_fallback_only", "--expect-status", "m070_candidate_approved_verified_ok"], {
      stdout: { write: (chunk: string) => void mismatchedExpectedStatusStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(mismatchedExpectedStatusExitCode).toBe(1);
    expect(JSON.parse(mismatchedExpectedStatusStdout.join(""))).toMatchObject({ success: false, status_code: "m070_direct_fallback_rejected" });

    const invalidStdout: string[] = [];
    const invalidExitCode = await main(["--fixture", ".gsd/private.json"], {
      stdout: { write: (chunk: string) => void invalidStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidExitCode).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({ success: false, status_code: "m070_invalid_arg", issue_categories: ["invalid-arg"] });
    expect(invalidStdout.join("")).not.toContain("private.json content");

    const helpStdout: string[] = [];
    const helpExitCode = await main(["--help"], {
      stdout: { write: (chunk: string) => void helpStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(helpExitCode).toBe(0);
    expect(helpStdout.join("")).toContain("Usage:");
    expect(helpStdout.join("")).toContain("bun run verify:m070");
  });
});
