import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m058-s03.ts";
import {
  M058_S03_CHECK_IDS,
  buildM058S03ProofHarness,
  evaluateM058S03Proof,
  parseM058S03Args,
  renderM058S03Report,
} from "./verify-m058-s03.ts";

const EXPECTED_CHECK_IDS = [
  "M058-S03-PACKAGE-WIRING",
  "M058-S03-CI-WIRING",
  "M058-S03-CI-RATIONALE",
  "M058-S03-DECISION-RECORD",
] as const;

const EXPECTED_VERIFY_SCRIPT = "bun scripts/verify-m058-s03.ts";
const EXPECTED_LINT_SCRIPT = "eslint src scripts";

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      lint: EXPECTED_LINT_SCRIPT,
      "verify:m058:s03": EXPECTED_VERIFY_SCRIPT,
    },
  },
  null,
  2,
);

const PASSING_CI = `name: ci
jobs:
  test:
    env:
      TEST_DATABASE_URL: postgresql://kodiai:kodiai@localhost:5432/kodiai
    steps:
      - run: bun install
      - run: bun run lint
      - run: bun run verify:m056:s03
      - run: bun run check:orphaned-tests
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests serialized and split the suite into explicit lanes
      # so shared TEST_DATABASE_URL cleanup cannot race unit tests or other DB files.
      - run: bun run test:unit
      - run: bun run test:db
      - run: bunx tsc --noEmit
`;

const PASSING_DECISIONS = `# Decisions Register
| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D999 | M058/S03/T02 | tooling | Lint tool contract for M058/S03 CI hardening | Adopt ESLint as the repo-owned linter for src/ and scripts/, with an explicit carve-out for operator-facing migration CLI console output. <!-- M058-S03-LINT-TOOL-CONTRACT --> | The roadmap and enforcement tooling already model ESLint config names, the repo has no existing lint surface to preserve, and ESLint gives the lowest-friction path to a PR-blocking lint gate while allowing a narrow exception for src/db/migrate.ts instead of weakening the broader no-console policy. | Yes | agent |
`;

describe("verify m058 s03 proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M058_S03_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM058S03Args([])).toEqual({ json: false });
    expect(parseM058S03Args(["--json"])).toEqual({ json: true });
    expect(() => parseM058S03Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the S03 CI gate contract", async () => {
    const report = await evaluateM058S03Proof({
      generatedAt: "2026-04-21T12:00:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        if (filePath.endsWith("DECISIONS.md")) return PASSING_DECISIONS;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m058:s03");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M058-S03-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
      expect.objectContaining({
        id: "M058-S03-CI-WIRING",
        passed: true,
        status_code: "ci_wiring_ok",
      }),
      expect.objectContaining({
        id: "M058-S03-CI-RATIONALE",
        passed: true,
        status_code: "ci_rationale_ok",
      }),
      expect.objectContaining({
        id: "M058-S03-DECISION-RECORD",
        passed: true,
        status_code: "decision_record_ok",
      }),
    ]);

    const rendered = renderM058S03Report(report);
    expect(rendered).toContain("M058 S03 CI gate contract verifier");
    expect(rendered).toContain("CI gate proof surface: PASS");
    expect(rendered).toContain("M058-S03-PACKAGE-WIRING PASS");
    expect(rendered).toContain("M058-S03-CI-WIRING PASS");
    expect(rendered).toContain("M058-S03-CI-RATIONALE PASS");
    expect(rendered).toContain("M058-S03-DECISION-RECORD PASS");
  });

  test("fails with stable status codes for missing package wiring, missing CI steps, and missing decision marker", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM058S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) {
          return JSON.stringify({ name: "kodiai", scripts: {} });
        }
        if (filePath.endsWith("ci.yml")) {
          return `name: ci
jobs:
  test:
    env:
      TEST_DATABASE_URL: postgresql://kodiai:kodiai@localhost:5432/kodiai
    steps:
      - run: bun run verify:m056:s03
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests serialized and split the suite into explicit lanes
      # so shared TEST_DATABASE_URL cleanup cannot race unit tests or other DB files.
      - run: bun run test:unit
      - run: bun run test:db
`;
        }
        if (filePath.endsWith("DECISIONS.md")) {
          return PASSING_DECISIONS.replace("<!-- M058-S03-LINT-TOOL-CONTRACT -->", "");
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M058-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
      expect.objectContaining({
        id: "M058-S03-CI-WIRING",
        passed: false,
        status_code: "ci_lint_step_missing",
      }),
      expect.objectContaining({
        id: "M058-S03-CI-RATIONALE",
        passed: true,
        status_code: "ci_rationale_ok",
      }),
      expect.objectContaining({
        id: "M058-S03-DECISION-RECORD",
        passed: false,
        status_code: "decision_marker_missing",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("scripts.lint");
    expect(report.checks[1]?.detail).toContain("bun run lint");
    expect(report.checks[3]?.detail).toContain("M058-S03-LINT-TOOL-CONTRACT");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
    expect(stderr.join(" ")).toContain("ci_lint_step_missing");
    expect(stderr.join(" ")).toContain("decision_marker_missing");
  });

  test("fails when CI gate steps are misordered or the orphaned-test step is missing", async () => {
    const misorderedReport = await evaluateM058S03Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) {
          return `name: ci
jobs:
  test:
    env:
      TEST_DATABASE_URL: postgresql://kodiai:kodiai@localhost:5432/kodiai
    steps:
      - run: bun run lint
      - run: bun run check:orphaned-tests
      - run: bun run verify:m056:s03
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests serialized and split the suite into explicit lanes
      # so shared TEST_DATABASE_URL cleanup cannot race unit tests or other DB files.
      - run: bun run test:unit
      - run: bun run test:db
`;
        }
        if (filePath.endsWith("DECISIONS.md")) return PASSING_DECISIONS;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(misorderedReport.checks[1]).toEqual(
      expect.objectContaining({
        id: "M058-S03-CI-WIRING",
        passed: false,
        status_code: "ci_gate_steps_misordered",
      }),
    );
    expect(misorderedReport.checks[1]?.detail).toContain("bun run verify:m056:s03");
    expect(misorderedReport.checks[1]?.detail).toContain("bun run check:orphaned-tests");

    const missingOrphanedReport = await evaluateM058S03Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) {
          return `name: ci
jobs:
  test:
    env:
      TEST_DATABASE_URL: postgresql://kodiai:kodiai@localhost:5432/kodiai
    steps:
      - run: bun run lint
      - run: bun run verify:m056:s03
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests serialized and split the suite into explicit lanes
      # so shared TEST_DATABASE_URL cleanup cannot race unit tests or other DB files.
      - run: bun run test:unit
      - run: bun run test:db
`;
        }
        if (filePath.endsWith("DECISIONS.md")) return PASSING_DECISIONS;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(missingOrphanedReport.checks[1]).toEqual(
      expect.objectContaining({
        id: "M058-S03-CI-WIRING",
        passed: false,
        status_code: "ci_orphaned_test_step_missing",
      }),
    );
  });

  test("flags stale split rationale, malformed package json, and unreadable files with stable status codes", async () => {
    const staleRationaleReport = await evaluateM058S03Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return "{ not valid json";
        if (filePath.endsWith("ci.yml")) {
          return `name: ci
jobs:
  test:
    env:
      TEST_DATABASE_URL: postgresql://kodiai:kodiai@localhost:5432/kodiai
    steps:
      - run: bun run lint
      - run: bun run verify:m056:s03
      - run: bun run check:orphaned-tests
      - run: bun run test:unit
      - run: bun run test:db
`;
        }
        if (filePath.endsWith("DECISIONS.md")) return "# Decisions Register\n";
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(staleRationaleReport.checks[0]).toEqual(
      expect.objectContaining({
        id: "M058-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
    expect(staleRationaleReport.checks[2]).toEqual(
      expect.objectContaining({
        id: "M058-S03-CI-RATIONALE",
        passed: false,
        status_code: "ci_split_rationale_comment_missing",
      }),
    );
    expect(staleRationaleReport.checks[3]).toEqual(
      expect.objectContaining({
        id: "M058-S03-DECISION-RECORD",
        passed: false,
        status_code: "decision_marker_missing",
      }),
    );

    const unreadableReport = await evaluateM058S03Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) throw new Error("EACCES: package.json");
        if (filePath.endsWith("ci.yml")) throw new Error("EACCES: ci.yml");
        if (filePath.endsWith("DECISIONS.md")) throw new Error("EACCES: DECISIONS.md");
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadableReport.checks).toEqual([
      expect.objectContaining({ id: "M058-S03-PACKAGE-WIRING", status_code: "package_file_unreadable" }),
      expect.objectContaining({ id: "M058-S03-CI-WIRING", status_code: "ci_file_unreadable" }),
      expect.objectContaining({ id: "M058-S03-CI-RATIONALE", status_code: "ci_file_unreadable" }),
      expect.objectContaining({ id: "M058-S03-DECISION-RECORD", status_code: "decision_file_unreadable" }),
    ]);
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m058:s03"]).toBe(EXPECTED_VERIFY_SCRIPT);
  });
});
