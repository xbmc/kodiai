import { describe, expect, test } from "bun:test";

import {
  M070_S03_CHECK_IDS,
  evaluateM070S03Contract,
  main,
  parseM070S03Args,
} from "./verify-m070-s03.ts";

const PASSING_PACKAGE_JSON = JSON.stringify({
  scripts: {
    "verify:m070:s03": "bun scripts/verify-m070-s03.ts",
  },
});

async function evaluateWithFixtures(overrides: Parameters<typeof evaluateM070S03Contract>[0] = {}) {
  return await evaluateM070S03Contract({
    generatedAt: "2026-05-10T00:00:00.000Z",
    readPackageJsonText: async () => PASSING_PACKAGE_JSON,
    ...overrides,
  });
}

describe("verify-m070-s03", () => {
  test("exports stable check ids and parses only bounded CLI flags", () => {
    expect(M070_S03_CHECK_IDS).toEqual([
      "M070-S03-FIXTURE-COVERAGE",
      "M070-S03-AGGREGATE-PROJECTION",
      "M070-S03-REVIEW-DETAILS-SURFACE",
      "M070-S03-RUNTIME-LOG-SURFACE",
      "M070-S03-REDACTION-BOUNDARY",
      "M070-S03-PACKAGE-WIRING",
    ]);
    expect(parseM070S03Args([])).toEqual({ json: false, help: false });
    expect(parseM070S03Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM070S03Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM070S03Args(["--fixture", ".gsd/private.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes local aggregate projection, Review Details, runtime log, and privacy checks", async () => {
    const report = await evaluateWithFixtures();

    expect(report).toMatchObject({
      command: "verify:m070:s03",
      generated_at: "2026-05-10T00:00:00.000Z",
      proofMode: "local-fixture-in-process",
      proofScope: "s03-aggregate-review-details-and-runtime-log-boundary",
      success: true,
      status_code: "m070_s03_ok",
      failing_check_id: null,
      issues: [],
      aggregateEvidence: {
        fixtureCount: 7,
        aggregateStatus: "mixed",
        counts: {
          attempted: 6,
          allowed: 2,
          denied: 4,
          published: 2,
          skipped: 1,
          failed: 1,
        },
        verificationStateCounts: {
          verified: 1,
          partially_verified: 1,
          unverified: 1,
          disproven: 1,
          unavailable: 2,
        },
      },
      correlationMetadata: {
        hasDeliveryId: true,
        hasReviewOutputKey: true,
        hasCorrelationKey: true,
        deliveryIdAvailable: true,
        reviewOutputKeyAvailable: true,
        correlationKeyAvailable: true,
      },
      surfaces: {
        reviewDetailsLineAvailable: true,
        reviewDetailsAggregateCountsAvailable: true,
        reviewDetailsReasonsAvailable: true,
        reviewDetailsMetadataAvailable: true,
        reviewDetailsRedactionAvailable: true,
        runtimeLogFieldsAvailable: true,
        runtimeLogAggregateCountsAvailable: true,
        runtimeLogReasonCountsAvailable: true,
        runtimeLogMetadataAvailable: true,
        runtimeLogRedactionAvailable: true,
      },
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
        reviewDetailsLeakPresent: false,
        runtimeLogLeakPresent: false,
        verifierJsonLeakPresent: false,
      },
      malformedFailClosed: {
        deniedCount: 1,
        malformedRecordCount: 1,
        unavailableVerificationCount: 1,
        hasFailClosedReason: true,
      },
    });
    expect(report.check_ids).toEqual(M070_S03_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.aggregateEvidence.reasonCategories).toEqual(expect.arrayContaining([
      "full-support",
      "partial-support",
      "publication-ineligible",
      "classifier-fail-closed",
      "no-evidence",
      "evidence-conflict",
    ]));
    expect(report.aggregateEvidence.publicationDenialCounts["publication-ineligible"]).toBeGreaterThanOrEqual(4);
    expect(report.targetedTests).toEqual([
      "bun test ./scripts/verify-m070-s03.test.ts && bun run verify:m070:s03 --json",
      "bun test ./src/specialists/candidate-verification-publication-evidence.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review-candidate-verification-evidence.test.ts",
      "bun test ./src/specialists/candidate-publication-policy.test.ts ./src/handlers/review-candidate-verification-publication.test.ts",
    ]);
  });

  test("JSON report never includes raw private canaries", async () => {
    const report = await evaluateWithFixtures();
    const serialized = JSON.stringify(report);

    for (const forbidden of [
      "M070_RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
      "M070_SPECIALIST_PROSE_SHOULD_NOT_LEAK",
      "M070_PROMPT_SHOULD_NOT_LEAK",
      "M070_RAW_MODEL_OUTPUT_SHOULD_NOT_LEAK",
      "M070_TOOL_PAYLOAD_SHOULD_NOT_LEAK",
      "M070_DIFF_SHOULD_NOT_LEAK",
      "M070_FINGERPRINT_SHOULD_NOT_LEAK",
      "M070_EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("fails with bounded issue when package script wiring drifts", async () => {
    const report = await evaluateWithFixtures({ readPackageJsonText: async () => JSON.stringify({ scripts: {} }) });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_s03_contract_failed");
    expect(report.failing_check_id).toBe("M070-S03-PACKAGE-WIRING");
    expect(report.issues.join("\n")).toContain("package.json scripts.verify:m070:s03 must equal bun scripts/verify-m070-s03.ts.");
  });

  test("fails if Review Details surface contains a forbidden canary", async () => {
    const report = await evaluateWithFixtures({
      formatReviewDetails: () => "- M070 candidate verification publication: M070_RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M070-S03-REVIEW-DETAILS-SURFACE");
    expect(report.redaction.reviewDetailsLeakPresent).toBe(true);
    expect(report.issues.join("\n")).toContain("Expected reviewDetailsAggregateCountsAvailable to be true.");
  });

  test("fails if runtime log fields contain a forbidden canary", async () => {
    const report = await evaluateWithFixtures({
      buildRuntimeLogFields: () => ({
        gate: "m070-candidate-verification-evidence",
        boundedness: "aggregate-only",
        attemptedCount: 1,
        allowedCount: 1,
        deniedCount: 0,
        publishedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        publicationDenialCounts: {},
        reasonCategories: [],
        hasDeliveryId: true,
        hasReviewOutputKey: true,
        hasCorrelationKey: true,
        privateOnly: true,
        publicationEvidenceIncluded: false,
        candidateBodiesIncluded: false,
        leaked: "M070_TOOL_PAYLOAD_SHOULD_NOT_LEAK",
      }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M070-S03-REDACTION-BOUNDARY");
    expect(report.redaction.runtimeLogLeakPresent).toBe(true);
    expect(report.issues.join("\n")).toContain("Runtime log fields contain forbidden private canary content.");
  });

  test("main emits parseable JSON on pass, contract failure, invalid args, and help", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures(),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({
      command: "verify:m070:s03",
      success: true,
      status_code: "m070_s03_ok",
    });

    const failingStdout: string[] = [];
    const failExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void failingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures({ readPackageJsonText: async () => JSON.stringify({ scripts: {} }) }),
    });
    expect(failExitCode).toBe(1);
    expect(JSON.parse(failingStdout.join(""))).toMatchObject({
      command: "verify:m070:s03",
      success: false,
      status_code: "m070_s03_contract_failed",
      failing_check_id: "M070-S03-PACKAGE-WIRING",
    });

    const invalidStdout: string[] = [];
    const invalidExitCode = await main(["--fixture", ".gsd/private.json"], {
      stdout: { write: (chunk: string) => void invalidStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures(),
    });
    expect(invalidExitCode).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({
      command: "verify:m070:s03",
      success: false,
      status_code: "m070_s03_invalid_arg",
      issues: [expect.stringContaining("invalid_cli_args")],
    });

    const helpStdout: string[] = [];
    const helpExitCode = await main(["--help"], {
      stdout: { write: (chunk: string) => void helpStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures(),
    });
    expect(helpExitCode).toBe(0);
    expect(helpStdout.join("")).toContain("Usage:");
    expect(helpStdout.join("")).toContain("bun run verify:m070:s03 [--json]");
  });
});
