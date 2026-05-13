import { describe, expect, test } from "bun:test";

import { classifyCandidateVerification, type CandidateVerificationClassifierInput } from "../src/specialists/candidate-verification.ts";
import {
  M070_S01_CHECK_IDS,
  evaluateM070S01Contract,
  main,
  parseM070S01Args,
} from "./verify-m070-s01.ts";

const PASSING_PACKAGE_JSON = JSON.stringify({
  scripts: {
    "verify:m070:s01": "bun scripts/verify-m070-s01.ts",
  },
});

const RAW_SENTINELS = [
  "RAW_CANDIDATE_BODY_SHOULD_NOT_LEAK",
  "SPECIALIST_PROSE_SHOULD_NOT_LEAK",
  "RAW_PROMPT_SHOULD_NOT_LEAK",
  "TOOL_PAYLOAD_SHOULD_NOT_LEAK",
  "RAW_FINGERPRINT_SHOULD_NOT_LEAK",
  "COMMENT_BODY_SHOULD_NOT_LEAK",
  "RAW_EVIDENCE_FINGERPRINT_SHOULD_NOT_LEAK",
  "DIFF_SHOULD_NOT_LEAK",
  "EVIDENCE_PAYLOAD_SHOULD_NOT_LEAK",
];

describe("verify-m070-s01", () => {
  test("exports stable check ids and parses only bounded CLI flags", () => {
    expect(M070_S01_CHECK_IDS).toEqual([
      "M070-S01-TAXONOMY-CONTRACT",
      "M070-S01-CONFLICT-CONTRACT",
      "M070-S01-FAIL-CLOSED-CONTRACT",
      "M070-S01-PRIVACY-CONTRACT",
      "M070-S01-PACKAGE-WIRING",
    ]);
    expect(parseM070S01Args([])).toEqual({ json: false, help: false });
    expect(parseM070S01Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM070S01Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM070S01Args(["--fixture", ".gsd/private.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes taxonomy, conflict, fail-closed, privacy, and package wiring checks", async () => {
    const report = await evaluateM070S01Contract({
      generatedAt: "2026-05-10T23:00:00.000Z",
      readPackageJsonText: async () => PASSING_PACKAGE_JSON,
    });

    expect(report).toMatchObject({
      command: "verify:m070:s01",
      generated_at: "2026-05-10T23:00:00.000Z",
      success: true,
      status_code: "m070_s01_ok",
      failing_check_id: null,
      issues: [],
      summary: {
        fixtureCount: 9,
        statusCounts: { pass: 2, fail_closed: 7 },
        stateCounts: {
          verified: 2,
          partially_verified: 1,
          unverified: 4,
          disproven: 2,
        },
        duplicateCount: 1,
        disagreementCount: 3,
        unclassifiableCount: 1,
        deniedPublicationCount: 6,
        allDeliveryIdsPresent: true,
        allReviewOutputKeysPresent: true,
        allCorrelationKeysPresent: true,
        privateOnly: true,
        publishesFindings: false,
      },
      redaction: {
        discardedRawPayload: true,
        discardedPublicationFields: true,
        discardedEvidencePayloads: true,
        candidateBodiesIncluded: false,
        specialistProseIncluded: false,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        diffsIncluded: false,
        evidencePayloadsIncluded: false,
        rawFingerprintsIncluded: false,
      },
    });
    expect(report.redaction.unsafeInputFieldCount).toBeGreaterThanOrEqual(5);
    expect(report.check_ids).toEqual(M070_S01_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    for (const reason of [
      "candidate-duplicate-key",
      "evidence-conflict",
      "evidence-contradiction",
      "evidence-unrecognized",
      "malformed-input",
      "partial-support",
      "full-support",
    ]) {
      expect(report.summary.reasonCategories).toContain(reason);
    }

    const summariesByName = Object.fromEntries(report.fixtureSummaries.map((summary) => [summary.fixture, summary]));
    expect(summariesByName.verified).toMatchObject({ status: "pass", stateCounts: { verified: 1 }, deniedPublicationCount: 0 });
    expect(summariesByName.partially_verified).toMatchObject({ status: "pass", stateCounts: { partially_verified: 1 }, deniedPublicationCount: 0 });
    expect(summariesByName.unverified).toMatchObject({ status: "fail_closed", stateCounts: { unverified: 1 }, deniedPublicationCount: 1 });
    expect(summariesByName.disproven).toMatchObject({ status: "fail_closed", stateCounts: { disproven: 1 }, deniedPublicationCount: 1 });
    expect(summariesByName.duplicate).toMatchObject({ status: "fail_closed", duplicateCount: 1 });
    expect(summariesByName.disagreement).toMatchObject({ status: "fail_closed", disagreementCount: 2 });
    expect(summariesByName.unclassifiable).toMatchObject({ status: "fail_closed", unclassifiableCount: 1 });
    expect(summariesByName.malformed).toMatchObject({ status: "fail_closed", malformedRecordCount: 3 });
  });

  test("main emits passing aggregate-only JSON", async () => {
    const stdout: string[] = [];
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM070S01Contract({
        generatedAt: "2026-05-10T23:00:00.000Z",
        readPackageJsonText: async () => PASSING_PACKAGE_JSON,
      }),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join(""));
    expect(parsed).toMatchObject({
      command: "verify:m070:s01",
      success: true,
      status_code: "m070_s01_ok",
      failing_check_id: null,
    });
    expect(JSON.stringify(parsed)).not.toContain("candidateKey");
    for (const sentinel of RAW_SENTINELS) {
      expect(JSON.stringify(parsed)).not.toContain(sentinel);
    }
  });

  test("fails with bounded output when the classifier taxonomy contract drifts", async () => {
    const report = await evaluateM070S01Contract({
      generatedAt: "2026-05-10T23:00:00.000Z",
      readPackageJsonText: async () => PASSING_PACKAGE_JSON,
      classify: (input: CandidateVerificationClassifierInput | null | undefined) => {
        const result = classifyCandidateVerification(input);
        if (input?.normalReview?.deliveryId === "delivery-verified") {
          return {
            ...result,
            status: "fail_closed",
            counts: {
              ...result.counts,
              verifiedCount: 0,
              unverifiedCount: 1,
              publicationEligibleCount: 0,
            },
          };
        }
        return result;
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m070_s01_contract_failed");
    expect(report.failing_check_id).toBe("M070-S01-TAXONOMY-CONTRACT");
    expect(report.issues.join("\n")).toContain("Expected verified fixture to produce exactly one verified candidate.");
    const serialized = JSON.stringify(report);
    for (const sentinel of RAW_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  test("rejects invalid CLI args with bounded JSON and exit code 2", async () => {
    const stdout: string[] = [];
    const exitCode = await main(["--fixture", "raw.json"], {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stdout.join(""));
    expect(parsed).toMatchObject({
      command: "verify:m070:s01",
      success: false,
      status_code: "m070_s01_invalid_arg",
      checks: [],
      failing_check_id: null,
    });
    expect(parsed.issues.join("\n")).toContain("invalid_cli_args");
  });

  test("fails with bounded issue when package script wiring is missing", async () => {
    const report = await evaluateM070S01Contract({
      generatedAt: "2026-05-10T23:00:00.000Z",
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M070-S01-PACKAGE-WIRING");
    expect(report.issues.join("\n")).toContain("package.json scripts.verify:m070:s01 must equal bun scripts/verify-m070-s01.ts.");
  });

  test("serialized reports do not expose raw candidate, specialist, prompt, diff, fingerprint, or evidence payload content", async () => {
    const report = await evaluateM070S01Contract({
      generatedAt: "2026-05-10T23:00:00.000Z",
      readPackageJsonText: async () => PASSING_PACKAGE_JSON,
    });

    const serialized = JSON.stringify(report);
    for (const sentinel of RAW_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("tool payload");
    expect(serialized).not.toContain("specialist prose");
    expect(serialized).not.toContain("candidate body");
    expect(serialized).not.toContain("evidence payload");
  });

  test("package.json exposes verify:m070:s01", async () => {
    const report = await evaluateM070S01Contract({ generatedAt: "2026-05-10T23:00:00.000Z" });
    const packageCheck = report.checks.find((check) => check.id === "M070-S01-PACKAGE-WIRING");
    expect(packageCheck).toMatchObject({ passed: true, status_code: "package_wiring_ok" });
  });
});
