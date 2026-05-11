import { describe, expect, test } from "bun:test";

import {
  M069_S01_CHECK_IDS,
  evaluateM069S01Contract,
  main,
  parseM069S01Args,
} from "./verify-m069-s01.ts";

const PASSING_PACKAGE_JSON = JSON.stringify({
  scripts: {
    "verify:m069:s01": "bun scripts/verify-m069-s01.ts",
  },
});

describe("verify-m069-s01", () => {
  test("exports stable check ids and parses only bounded CLI flags", () => {
    expect(M069_S01_CHECK_IDS).toEqual([
      "M069-S01-TRIGGER-CONTRACT",
      "M069-S01-SKIP-CONTRACT",
      "M069-S01-OUTPUT-METRICS-CONTRACT",
      "M069-S01-REDACTION-CONTRACT",
      "M069-S01-PACKAGE-WIRING",
    ]);
    expect(parseM069S01Args([])).toEqual({ json: false, help: false });
    expect(parseM069S01Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM069S01Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM069S01Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes representative trigger, skip, metrics, redaction, and package wiring checks", async () => {
    const report = await evaluateM069S01Contract({
      generatedAt: "2026-05-10T22:30:00.000Z",
      readPackageJsonText: async () => PASSING_PACKAGE_JSON,
    });

    expect(report).toMatchObject({
      command: "verify:m069:s01",
      generated_at: "2026-05-10T22:30:00.000Z",
      success: true,
      status_code: "m069_s01_ok",
      failing_check_id: null,
      issues: [],
      summary: {
        triggeredLaneCount: 1,
        skippedLaneCount: 0,
        normalizedCandidateCount: 3,
        duplicateCount: 1,
        disagreementCount: 1,
        unsafeFieldCount: 5,
        truncatedCandidateCount: 0,
        tokenCountAvailable: true,
        costAvailable: true,
        latencyMsAvailable: true,
      },
    });
    expect(report.check_ids).toEqual(M069_S01_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.trigger).toMatchObject({
      status: "triggered",
      laneId: "docs-config-truth",
      selectedLaneCount: 1,
      candidateCount: 2,
      shadowOnly: true,
      publishesFindings: false,
      correlationKeyPresent: true,
    });
    expect(report.skip).toMatchObject({
      status: "skipped",
      laneId: null,
      skipReason: "no-operator-truth-paths",
      selectedLaneCount: 0,
      candidateCount: 0,
      shadowOnly: true,
      publishesFindings: false,
    });
    expect(report.normalizedOutput).toMatchObject({
      status: "degraded",
      laneId: "docs-config-truth",
      candidateCount: 3,
      duplicateCount: 1,
      disagreementCount: 1,
      deliveryIdPresent: true,
      reviewOutputKeyPresent: true,
      correlationKeyPresent: true,
      shadowOnly: true,
      publishesFindings: false,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("tool output");
    expect(serialized).not.toContain("GitHub-visible body");
    expect(serialized).not.toContain("publication shaped text");
    expect(serialized).not.toContain("approved");
  });

  test("fails with bounded issue when the trigger contract drifts", async () => {
    const report = await evaluateM069S01Contract({
      generatedAt: "2026-05-10T22:30:00.000Z",
      readPackageJsonText: async () => PASSING_PACKAGE_JSON,
      classifyTrigger: () => ({
        status: "triggered",
        laneId: "docs-config-truth",
        skipReason: null,
        degradedReason: null,
        errorKind: null,
        matchedPaths: ["docs/operators/review-details.md"],
        candidateCount: 1,
        selectedLaneCount: 2 as 1,
        shadowOnly: true,
        publishesFindings: false,
        correlationKey: "corr-1",
        metrics: {
          decisionCount: 0,
          duplicateCount: 0,
          disagreementCount: 0,
          tokenCountAvailable: false,
          costAvailable: false,
          latencyMsAvailable: false,
        },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_s01_contract_failed");
    expect(report.failing_check_id).toBe("M069-S01-TRIGGER-CONTRACT");
    expect(report.issues.join("\n")).toContain("Expected trigger to select exactly one shadow lane.");
  });

  test("fails with bounded issue when package script wiring is missing", async () => {
    const report = await evaluateM069S01Contract({
      generatedAt: "2026-05-10T22:30:00.000Z",
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S01-PACKAGE-WIRING");
    expect(report.issues.join("\n")).toContain("package.json scripts.verify:m069:s01 must equal bun scripts/verify-m069-s01.ts.");
  });

  test("main emits parseable JSON on pass and fail", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM069S01Contract({
        generatedAt: "2026-05-10T22:30:00.000Z",
        readPackageJsonText: async () => PASSING_PACKAGE_JSON,
      }),
    });

    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({
      command: "verify:m069:s01",
      success: true,
      status_code: "m069_s01_ok",
    });

    const failingStdout: string[] = [];
    const failExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void failingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM069S01Contract({
        generatedAt: "2026-05-10T22:30:00.000Z",
        readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
      }),
    });

    expect(failExitCode).toBe(1);
    expect(JSON.parse(failingStdout.join(""))).toMatchObject({
      command: "verify:m069:s01",
      success: false,
      status_code: "m069_s01_contract_failed",
      failing_check_id: "M069-S01-PACKAGE-WIRING",
    });
  });
});
