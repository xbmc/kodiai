import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CheckerReport } from "./check-migrations-have-downs.ts";
import type { EvaluationReport } from "./verify-m056-s03.ts";
import {
  M056_S03_CHECK_IDS,
  buildM056S03ProofHarness,
  evaluateM056S03Proof,
  parseM056S03Args,
  renderM056S03Report,
} from "./verify-m056-s03.ts";

const EXPECTED_CHECK_IDS = [
  "M056-S03-CHECKER-STATE",
  "M056-S03-PACKAGE-WIRING",
  "M056-S03-CI-WIRING",
  "M056-S03-DECISION-RECORD",
  "M056-S03-CONTRIBUTING-TRUTH",
] as const;

const PASSING_CHECKER_REPORT: CheckerReport = {
  command: "check:migrations-have-downs",
  generatedAt: "2026-04-21T10:00:00.000Z",
  check_ids: [
    "MIGRATIONS-DIR-STATE",
    "MIGRATION-ALLOWLIST-STATE",
    "MIGRATION-PAIRS",
    "PACKAGE-WIRING",
  ],
  overallPassed: true,
  checks: [
    {
      id: "MIGRATIONS-DIR-STATE",
      passed: true,
      skipped: false,
      status_code: "migrations_dir_ok",
      detail: "Scanned migrations.",
    },
    {
      id: "MIGRATION-ALLOWLIST-STATE",
      passed: true,
      skipped: false,
      status_code: "allowlist_empty",
      detail: "No allowlist entries.",
    },
    {
      id: "MIGRATION-PAIRS",
      passed: true,
      skipped: false,
      status_code: "all_rollbacks_present",
      detail: "All migrations paired.",
    },
    {
      id: "PACKAGE-WIRING",
      passed: true,
      skipped: false,
      status_code: "package_wiring_ok",
      detail: "Package script present.",
    },
  ],
};

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "check:migrations-have-downs": "bun scripts/check-migrations-have-downs.ts",
      "verify:m056:s03": "bun scripts/verify-m056-s03.ts",
    },
  },
  null,
  2,
);

const PASSING_CI = `name: ci
jobs:
  test:
    steps:
      - run: bun install
      - run: bun run verify:m056:s03
      - run: bun test --max-concurrency=2 scripts src
      - run: bunx tsc --noEmit
`;

const PASSING_DECISIONS = `# Decisions Register
| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D999 | M056/S03/T02 | migrations | Paired migration contract | Every forward migration requires a rollback sibling or an explicit allowlisted rationale. <!-- M056-S03-PAIRED-MIGRATION-CONTRACT --> | The repo and CI should fail closed on unpaired forward migrations unless a recorded exception exists. | Yes | agent |
`;

const PASSING_CONTRIBUTING = `# Contributing to KodiAI

## Database Migration Expectations

For new migrations, add:
- a forward migration: NNN-name.sql
- a rollback migration: NNN-name.down.sql

If a new migration intentionally does not have a rollback file, record an explicit allowlisted rationale in the migration gate decision/log rather than treating unpaired forward migrations as normal history.

Run bun run check:migrations-have-downs and bun run verify:m056:s03 when touching migration policy or migration files.
`;

describe("verify m056 s03 proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M056_S03_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM056S03Args([])).toEqual({ json: false });
    expect(parseM056S03Args(["--json"])).toEqual({ json: true });
    expect(() => parseM056S03Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the paired-migration proof surface", async () => {
    const report = await evaluateM056S03Proof({
      generatedAt: "2026-04-21T10:05:00.000Z",
      runChecker: async () => PASSING_CHECKER_REPORT,
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("DECISIONS.md")) return PASSING_DECISIONS;
        if (filePath.endsWith("CONTRIBUTING.md")) return PASSING_CONTRIBUTING;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m056:s03");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M056-S03-CHECKER-STATE",
        passed: true,
        status_code: "checker_passed",
      }),
      expect.objectContaining({
        id: "M056-S03-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
      expect.objectContaining({
        id: "M056-S03-CI-WIRING",
        passed: true,
        status_code: "ci_wiring_ok",
      }),
      expect.objectContaining({
        id: "M056-S03-DECISION-RECORD",
        passed: true,
        status_code: "decision_record_ok",
      }),
      expect.objectContaining({
        id: "M056-S03-CONTRIBUTING-TRUTH",
        passed: true,
        status_code: "contributing_truth_ok",
      }),
    ]);

    const rendered = renderM056S03Report(report);
    expect(rendered).toContain("M056 S03 paired migration proof verifier");
    expect(rendered).toContain("Paired migration proof surface: PASS");
    expect(rendered).toContain("M056-S03-CHECKER-STATE PASS");
    expect(rendered).toContain("M056-S03-PACKAGE-WIRING PASS");
    expect(rendered).toContain("M056-S03-CI-WIRING PASS");
    expect(rendered).toContain("M056-S03-DECISION-RECORD PASS");
    expect(rendered).toContain("M056-S03-CONTRIBUTING-TRUTH PASS");
  });

  test("fails with stable status codes for checker failure, missing wiring, missing decision marker, and stale docs", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM056S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      runChecker: async () => ({
        ...PASSING_CHECKER_REPORT,
        overallPassed: false,
        checks: PASSING_CHECKER_REPORT.checks.map((check) =>
          check.id === "MIGRATION-PAIRS"
            ? { ...check, passed: false, status_code: "rollback_missing", detail: "Missing rollback sibling for 999-test.sql" }
            : check,
        ),
      }),
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({ name: "kodiai", scripts: {} });
        }
        if (filePath.endsWith("ci.yml")) {
          return `name: ci\njobs:\n  test:\n    steps:\n      - run: bun test --max-concurrency=2 scripts src\n      - run: bun run verify:m056:s03\n`;
        }
        if (filePath.endsWith("DECISIONS.md")) {
          return PASSING_DECISIONS.replace("<!-- M056-S03-PAIRED-MIGRATION-CONTRACT -->", "");
        }
        if (filePath.endsWith("CONTRIBUTING.md")) {
          return `${PASSING_CONTRIBUTING}\nHistorical drift still exists for 012-wiki-staleness-run-state.sql and 013-review-clusters.sql.\n`;
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M056-S03-CHECKER-STATE",
        passed: false,
        status_code: "checker_failed",
      }),
      expect.objectContaining({
        id: "M056-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
      expect.objectContaining({
        id: "M056-S03-CI-WIRING",
        passed: false,
        status_code: "ci_verify_step_misordered",
      }),
      expect.objectContaining({
        id: "M056-S03-DECISION-RECORD",
        passed: false,
        status_code: "decision_marker_missing",
      }),
      expect.objectContaining({
        id: "M056-S03-CONTRIBUTING-TRUTH",
        passed: false,
        status_code: "contributing_truth_stale",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("rollback_missing");
    expect(report.checks[1]?.detail).toContain("verify:m056:s03");
    expect(report.checks[2]?.detail).toContain("bun run verify:m056:s03");
    expect(report.checks[3]?.detail).toContain("M056-S03-PAIRED-MIGRATION-CONTRACT");
    expect(report.checks[4]?.detail).toContain("012-wiki-staleness-run-state.sql");
    expect(stderr.join(" ")).toContain("checker_failed");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
    expect(stderr.join(" ")).toContain("ci_verify_step_misordered");
    expect(stderr.join(" ")).toContain("decision_marker_missing");
    expect(stderr.join(" ")).toContain("contributing_truth_stale");
  });

  test("surfaces malformed checker responses, unreadable files, invalid package json, and missing ci step in a clean json envelope", async () => {
    const malformedChecker = await evaluateM056S03Proof({
      runChecker: async () => ({
        command: "check:migrations-have-downs",
        generatedAt: "2026-04-21T10:00:00.000Z",
        check_ids: PASSING_CHECKER_REPORT.check_ids,
        overallPassed: true,
        checks: "nope",
      } as unknown as CheckerReport),
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return "{ not valid json";
        if (filePath.endsWith("ci.yml")) return "name: ci\n";
        if (filePath.endsWith("DECISIONS.md")) return "# Decisions Register\n";
        if (filePath.endsWith("CONTRIBUTING.md")) return "# Contributing\n";
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(malformedChecker.checks[0]).toEqual(
      expect.objectContaining({
        id: "M056-S03-CHECKER-STATE",
        passed: false,
        status_code: "checker_report_invalid",
      }),
    );
    expect(malformedChecker.checks[1]).toEqual(
      expect.objectContaining({
        id: "M056-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
    expect(malformedChecker.checks[2]).toEqual(
      expect.objectContaining({
        id: "M056-S03-CI-WIRING",
        passed: false,
        status_code: "ci_verify_step_missing",
      }),
    );
    expect(malformedChecker.checks[3]).toEqual(
      expect.objectContaining({
        id: "M056-S03-DECISION-RECORD",
        passed: false,
        status_code: "decision_marker_missing",
      }),
    );
    expect(malformedChecker.checks[4]).toEqual(
      expect.objectContaining({
        id: "M056-S03-CONTRIBUTING-TRUTH",
        passed: false,
        status_code: "contributing_truth_missing",
      }),
    );

    const unreadableFiles = await evaluateM056S03Proof({
      runChecker: async () => {
        throw new Error("checker invocation failed");
      },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) throw new Error("EACCES: package.json");
        if (filePath.endsWith("ci.yml")) throw new Error("EACCES: ci.yml");
        if (filePath.endsWith("DECISIONS.md")) throw new Error("EACCES: DECISIONS.md");
        if (filePath.endsWith("CONTRIBUTING.md")) throw new Error("EACCES: CONTRIBUTING.md");
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadableFiles.checks).toEqual([
      expect.objectContaining({ id: "M056-S03-CHECKER-STATE", status_code: "checker_invocation_failed" }),
      expect.objectContaining({ id: "M056-S03-PACKAGE-WIRING", status_code: "package_file_unreadable" }),
      expect.objectContaining({ id: "M056-S03-CI-WIRING", status_code: "ci_file_unreadable" }),
      expect.objectContaining({ id: "M056-S03-DECISION-RECORD", status_code: "decision_file_unreadable" }),
      expect.objectContaining({ id: "M056-S03-CONTRIBUTING-TRUTH", status_code: "contributing_file_unreadable" }),
    ]);
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m056:s03"]).toBe(
      "bun scripts/verify-m056-s03.ts",
    );
  });
});
