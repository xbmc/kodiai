import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m054-s04.ts";
import {
  M054_S04_CHECK_IDS,
  buildM054S04ProofHarness,
  evaluateM054S04VerifierCoverage,
  parseM054S04Args,
  renderM054S04Report,
} from "./verify-m054-s04.ts";

const EXPECTED_CHECK_IDS = [
  "M054-S04-COMPLETED-MILESTONE-COVERAGE",
  "M054-S04-PACKAGE-SCRIPT-WIRING",
] as const;

const COVERED_MILESTONES = [
  "M035",
  "M036",
  "M037",
  "M038",
  "M039",
  "M040",
  "M041",
  "M042",
  "M043",
  "M044",
  "M045",
  "M046",
  "M047",
  "M048",
  "M049",
  "M050",
  "M051",
  "M052",
] as const;

function buildPackageJson(overrides: Record<string, string> = {}): string {
  return JSON.stringify(
    {
      scripts: {
        "verify:m036:s01": "bun scripts/verify-m036-s01.ts",
        "verify:m036:s02": "bun scripts/verify-m036-s02.ts",
        "verify:m036:s03": "bun scripts/verify-m036-s03.ts",
        "verify:m037:s01": "bun scripts/verify-m037-s01.ts",
        "verify:m037:s02": "bun scripts/verify-m037-s02.ts",
        "verify:m037:s03": "bun scripts/verify-m037-s03.ts",
        "verify:m038:s02": "bun scripts/verify-m038-s02.ts",
        "verify:m038:s03": "bun scripts/verify-m038-s03.ts",
        "verify:m040:s02": "bun scripts/verify-m040-s02.ts",
        "verify:m040:s03": "bun scripts/verify-m040-s03.ts",
        "verify:m041:s02": "bun scripts/verify-m041-s02.ts",
        "verify:m041:s03": "bun scripts/verify-m041-s03.ts",
        "verify:m042:s01": "bun scripts/verify-m042-s01.ts",
        "verify:m042:s02": "bun scripts/verify-m042-s02.ts",
        "verify:m042:s03": "bun scripts/verify-m042-s03.ts",
        "verify:m044": "bun scripts/verify-m044-s01.ts",
        "verify:m044:s01": "bun scripts/verify-m044-s01.ts",
        "verify:m045:s01": "bun scripts/verify-m045-s01.ts",
        "verify:m045:s03": "bun scripts/verify-m045-s03.ts",
        "verify:m046": "bun scripts/verify-m046.ts",
        "verify:m046:s01": "bun scripts/verify-m046-s01.ts",
        "verify:m046:s02": "bun scripts/verify-m046-s02.ts",
        "verify:m047": "bun scripts/verify-m047.ts",
        "verify:m047:s01": "bun scripts/verify-m047-s01.ts",
        "verify:m047:s02": "bun scripts/verify-m047-s02.ts",
        "verify:m048:s01": "bun scripts/verify-m048-s01.ts",
        "verify:m048:s02": "bun scripts/verify-m048-s02.ts",
        "verify:m048:s03": "bun scripts/verify-m048-s03.ts",
        "verify:m049:s02": "bun scripts/verify-m049-s02.ts",
        "verify:m053": "bun scripts/verify-m053.ts",
        "verify:m054:s02": "bun scripts/verify-m054-s02.ts",
        "verify:m054:s03": "bun scripts/verify-m054-s03.ts",
        "verify:m054:s04": "bun scripts/verify-m054-s04.ts",
        ...overrides,
      },
    },
    null,
    2,
  );
}

function makeArtifactReader(records: Record<string, string | Error>) {
  return async (filePath: string): Promise<string> => {
    const normalized = filePath.replaceAll("\\", "/");
    const record = Object.entries(records).find(([suffix]) => normalized.endsWith(suffix))?.[1];
    if (record == null) {
      throw new Error(`ENOENT: ${normalized}`);
    }
    if (record instanceof Error) {
      throw record;
    }
    return record;
  };
}

describe("verify m054 s04 verifier/rationale audit", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M054_S04_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM054S04Args([])).toEqual({ json: false });
    expect(parseM054S04Args(["--json"])).toEqual({ json: true });
    expect(() => parseM054S04Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes with real verifier coverage, explicit rationale coverage, and package wiring", async () => {
    const report = await evaluateM054S04VerifierCoverage({
      generatedAt: "2026-04-21T05:20:00.000Z",
      readTextFile: makeArtifactReader({
        "package.json": buildPackageJson(),
        ".gsd/milestones/M039/M039-SUMMARY.md": "No committed `verify-m039-*` harness survives in the current tree.",
        ".gsd/milestones/M043/M043-CONTEXT.md": "No `verify:m043:*` package scripts survive in the current repo.",
        ".gsd/milestones/M050/M050-CONTEXT.md": "M050 intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03` instead of introducing `verify:m050:*`.",
        ".gsd/milestones/M050/M050-SUMMARY.md": "The milestone intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M051/M051-SUMMARY.md": "M051 summary still exists.",
        ".gsd/milestones/M052/M052-SUMMARY.md": "Milestone prose with no verifier claims for this fixture.",
        ".gsd/milestones/M052/M052-VALIDATION.md": "Validation prose with no verifier claims for this fixture.",
      }),
      fileExists: (filePath: string) => {
        const normalized = filePath.replaceAll("\\", "/");
        return (
          normalized.endsWith("scripts/verify-m036-s01.ts") ||
          normalized.endsWith("scripts/verify-m036-s02.ts") ||
          normalized.endsWith("scripts/verify-m036-s03.ts") ||
          normalized.endsWith("scripts/verify-m037-s01.ts") ||
          normalized.endsWith("scripts/verify-m037-s02.ts") ||
          normalized.endsWith("scripts/verify-m037-s03.ts") ||
          normalized.endsWith("scripts/verify-m038-s02.ts") ||
          normalized.endsWith("scripts/verify-m038-s03.ts") ||
          normalized.endsWith("scripts/verify-m040-s02.ts") ||
          normalized.endsWith("scripts/verify-m040-s03.ts") ||
          normalized.endsWith("scripts/verify-m041-s02.ts") ||
          normalized.endsWith("scripts/verify-m041-s03.ts") ||
          normalized.endsWith("scripts/verify-m042-s01.ts") ||
          normalized.endsWith("scripts/verify-m042-s02.ts") ||
          normalized.endsWith("scripts/verify-m042-s03.ts") ||
          normalized.endsWith("scripts/verify-m044-s01.ts") ||
          normalized.endsWith("scripts/verify-m045-s01.ts") ||
          normalized.endsWith("scripts/verify-m045-s03.ts") ||
          normalized.endsWith("scripts/verify-m046.ts") ||
          normalized.endsWith("scripts/verify-m046-s01.ts") ||
          normalized.endsWith("scripts/verify-m046-s02.ts") ||
          normalized.endsWith("scripts/verify-m047.ts") ||
          normalized.endsWith("scripts/verify-m047-s01.ts") ||
          normalized.endsWith("scripts/verify-m047-s02.ts") ||
          normalized.endsWith("scripts/verify-m048-s01.ts") ||
          normalized.endsWith("scripts/verify-m048-s02.ts") ||
          normalized.endsWith("scripts/verify-m048-s03.ts") ||
          normalized.endsWith("scripts/verify-m049-s02.ts") ||
          normalized.endsWith("scripts/verify-m053.ts") ||
          normalized.endsWith("scripts/verify-m054-s02.ts") ||
          normalized.endsWith("scripts/verify-m054-s03.ts") ||
          normalized.endsWith("scripts/verify-m054-s04.ts")
        );
      },
    });

    expect(report.command).toBe("verify:m054:s04");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M054-S04-COMPLETED-MILESTONE-COVERAGE",
        passed: true,
        status_code: "completed_milestone_coverage_ok",
      }),
      expect.objectContaining({
        id: "M054-S04-PACKAGE-SCRIPT-WIRING",
        passed: true,
        status_code: "package_script_wiring_ok",
      }),
    ]);

    const milestoneResults = report.checks[0]?.milestones ?? [];
    expect(milestoneResults).toHaveLength(COVERED_MILESTONES.length);
    expect(milestoneResults.find((entry) => entry.milestoneId === "M039")).toEqual(
      expect.objectContaining({
        coverageType: "rationale",
        passed: true,
        status_code: "explicit_rationale_present",
      }),
    );
    expect(milestoneResults.find((entry) => entry.milestoneId === "M043")).toEqual(
      expect.objectContaining({
        coverageType: "rationale",
        passed: true,
        status_code: "explicit_rationale_present",
      }),
    );
    expect(milestoneResults.find((entry) => entry.milestoneId === "M050")).toEqual(
      expect.objectContaining({
        coverageType: "rationale",
        passed: true,
        status_code: "explicit_rationale_present",
      }),
    );
    expect(milestoneResults.find((entry) => entry.milestoneId === "M044")).toEqual(
      expect.objectContaining({
        coverageType: "verifier",
        passed: true,
        status_code: "repo_verifier_coverage_present",
      }),
    );

    const rendered = renderM054S04Report(report);
    expect(rendered).toContain("Verifier/rationale audit: PASS");
    expect(rendered).toContain("M052");
    expect(rendered).toContain("coverage=verifier");
  });

  test("fails stale overclaims modeled on m052 while nearby milestones still pass", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM054S04ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: makeArtifactReader({
        "package.json": buildPackageJson(),
        ".gsd/milestones/M039/M039-SUMMARY.md": "No committed `verify-m039-*` harness survives in the current tree.",
        ".gsd/milestones/M043/M043-CONTEXT.md": "No `verify:m043:*` package scripts survive in the current repo.",
        ".gsd/milestones/M050/M050-CONTEXT.md": "M050 intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03` instead of introducing `verify:m050:*`.",
        ".gsd/milestones/M050/M050-SUMMARY.md": "The milestone intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M051/M051-SUMMARY.md": "M051 summary still exists.",
        ".gsd/milestones/M052/M052-SUMMARY.md": "Claims `scripts/verify-m052-s01.ts`, `scripts/verify-m052-s02.ts`, `scripts/verify-m052.ts`, and `bun run verify:m052` exist.",
        ".gsd/milestones/M052/M052-VALIDATION.md": "Also cites `verify:m052:s01`, `verify:m052:s02`, and the same missing script files.",
      }),
      fileExists: (filePath: string) => {
        const normalized = filePath.replaceAll("\\", "/");
        return (
          normalized.endsWith("scripts/verify-m036-s01.ts") ||
          normalized.endsWith("scripts/verify-m036-s02.ts") ||
          normalized.endsWith("scripts/verify-m036-s03.ts") ||
          normalized.endsWith("scripts/verify-m037-s01.ts") ||
          normalized.endsWith("scripts/verify-m037-s02.ts") ||
          normalized.endsWith("scripts/verify-m037-s03.ts") ||
          normalized.endsWith("scripts/verify-m038-s02.ts") ||
          normalized.endsWith("scripts/verify-m038-s03.ts") ||
          normalized.endsWith("scripts/verify-m040-s02.ts") ||
          normalized.endsWith("scripts/verify-m040-s03.ts") ||
          normalized.endsWith("scripts/verify-m041-s02.ts") ||
          normalized.endsWith("scripts/verify-m041-s03.ts") ||
          normalized.endsWith("scripts/verify-m042-s01.ts") ||
          normalized.endsWith("scripts/verify-m042-s02.ts") ||
          normalized.endsWith("scripts/verify-m042-s03.ts") ||
          normalized.endsWith("scripts/verify-m044-s01.ts") ||
          normalized.endsWith("scripts/verify-m045-s01.ts") ||
          normalized.endsWith("scripts/verify-m045-s03.ts") ||
          normalized.endsWith("scripts/verify-m046.ts") ||
          normalized.endsWith("scripts/verify-m046-s01.ts") ||
          normalized.endsWith("scripts/verify-m046-s02.ts") ||
          normalized.endsWith("scripts/verify-m047.ts") ||
          normalized.endsWith("scripts/verify-m047-s01.ts") ||
          normalized.endsWith("scripts/verify-m047-s02.ts") ||
          normalized.endsWith("scripts/verify-m048-s01.ts") ||
          normalized.endsWith("scripts/verify-m048-s02.ts") ||
          normalized.endsWith("scripts/verify-m048-s03.ts") ||
          normalized.endsWith("scripts/verify-m049-s02.ts") ||
          normalized.endsWith("scripts/verify-m053.ts") ||
          normalized.endsWith("scripts/verify-m054-s02.ts") ||
          normalized.endsWith("scripts/verify-m054-s03.ts") ||
          normalized.endsWith("scripts/verify-m054-s04.ts")
        );
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;
    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M054-S04-COMPLETED-MILESTONE-COVERAGE",
        passed: false,
        status_code: "completed_milestone_coverage_drift",
      }),
    );
    const m052 = report.checks[0]?.milestones?.find((entry) => entry.milestoneId === "M052");
    expect(m052).toEqual(
      expect.objectContaining({
        coverageType: "overclaim",
        passed: false,
        status_code: "claimed_verifier_missing",
      }),
    );
    expect(m052?.detail).toContain("verify:m052");
    expect(stderr.join(" ")).toContain("claimed_verifier_missing");
  });

  test("fails with stable unreadable-artifact codes instead of aborting the whole audit", async () => {
    const report = await evaluateM054S04VerifierCoverage({
      readTextFile: makeArtifactReader({
        "package.json": buildPackageJson(),
        ".gsd/milestones/M039/M039-SUMMARY.md": new Error("EACCES: M039-SUMMARY.md"),
        ".gsd/milestones/M043/M043-CONTEXT.md": "No `verify:m043:*` package scripts survive in the current repo.",
        ".gsd/milestones/M050/M050-CONTEXT.md": "M050 intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M050/M050-SUMMARY.md": "The milestone intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M051/M051-SUMMARY.md": "M051 summary still exists.",
        ".gsd/milestones/M052/M052-SUMMARY.md": "No verifier claims in this fixture.",
        ".gsd/milestones/M052/M052-VALIDATION.md": "No verifier claims in this fixture.",
      }),
      fileExists: () => true,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks[0]).toEqual(
      expect.objectContaining({
        id: "M054-S04-COMPLETED-MILESTONE-COVERAGE",
        passed: false,
        status_code: "completed_milestone_coverage_drift",
      }),
    );
    const m039 = report.checks[0]?.milestones?.find((entry) => entry.milestoneId === "M039");
    expect(m039).toEqual(
      expect.objectContaining({
        coverageType: "error",
        passed: false,
        status_code: "artifact_unreadable",
      }),
    );
  });

  test("fails package wiring when the canonical script alias is missing or wrong", async () => {
    const missing = await evaluateM054S04VerifierCoverage({
      readTextFile: makeArtifactReader({
        "package.json": JSON.stringify({ scripts: {} }),
        ".gsd/milestones/M039/M039-SUMMARY.md": "No committed `verify-m039-*` harness survives in the current tree.",
        ".gsd/milestones/M043/M043-CONTEXT.md": "No `verify:m043:*` package scripts survive in the current repo.",
        ".gsd/milestones/M050/M050-CONTEXT.md": "M050 intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M050/M050-SUMMARY.md": "The milestone intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M051/M051-SUMMARY.md": "M051 summary still exists.",
        ".gsd/milestones/M052/M052-SUMMARY.md": "No verifier claims in this fixture.",
        ".gsd/milestones/M052/M052-VALIDATION.md": "No verifier claims in this fixture.",
      }),
      fileExists: () => true,
    });
    expect(missing.checks[1]).toEqual(
      expect.objectContaining({
        id: "M054-S04-PACKAGE-SCRIPT-WIRING",
        passed: false,
        status_code: "package_script_wiring_missing",
      }),
    );

    const mismatched = await evaluateM054S04VerifierCoverage({
      readTextFile: makeArtifactReader({
        "package.json": buildPackageJson({ "verify:m054:s04": "bun ./scripts/verify-m054-s04.ts" }),
        ".gsd/milestones/M039/M039-SUMMARY.md": "No committed `verify-m039-*` harness survives in the current tree.",
        ".gsd/milestones/M043/M043-CONTEXT.md": "No `verify:m043:*` package scripts survive in the current repo.",
        ".gsd/milestones/M050/M050-CONTEXT.md": "M050 intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M050/M050-SUMMARY.md": "The milestone intentionally reused `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.",
        ".gsd/milestones/M051/M051-SUMMARY.md": "M051 summary still exists.",
        ".gsd/milestones/M052/M052-SUMMARY.md": "No verifier claims in this fixture.",
        ".gsd/milestones/M052/M052-VALIDATION.md": "No verifier claims in this fixture.",
      }),
      fileExists: () => true,
    });
    expect(mismatched.checks[1]).toEqual(
      expect.objectContaining({
        id: "M054-S04-PACKAGE-SCRIPT-WIRING",
        passed: false,
        status_code: "package_script_wiring_mismatch",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m054:s04"]).toBe(
      "bun scripts/verify-m054-s04.ts",
    );
  });
});
