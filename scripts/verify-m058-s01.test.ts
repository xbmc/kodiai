import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m058-s01.ts";
import {
  M058_S01_CHECK_IDS,
  buildM058S01ProofHarness,
  evaluateM058S01Proof,
  parseM058S01Args,
  renderM058S01Report,
} from "./verify-m058-s01.ts";

const EXPECTED_CHECK_IDS = [
  "M058-S01-CI-COVERAGE-BREADTH",
  "M058-S01-CI-SPLIT-PRESERVED",
  "M058-S01-PACKAGE-WIRING",
  "M058-S01-CI-ORDERING-RATIONALE",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m058:s01": "bun scripts/verify-m058-s01.ts",
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
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests on a low concurrency cap and split the suite into
      # two shorter invocations to avoid cross-file schema interference and runner crashes.
      - run: bun test --max-concurrency=2 scripts src
      - run: bun test --max-concurrency=2 src/knowledge
      - run: bunx tsc --noEmit
`;

describe("verify m058 s01 proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M058_S01_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM058S01Args([])).toEqual({ json: false });
    expect(parseM058S01Args(["--json"])).toEqual({ json: true });
    expect(() => parseM058S01Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the broadened CI coverage contract", async () => {
    const report = await evaluateM058S01Proof({
      generatedAt: "2026-04-21T12:00:00.000Z",
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) return PASSING_CI;
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.command).toBe("verify:m058:s01");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M058-S01-CI-COVERAGE-BREADTH",
        passed: true,
        status_code: "ci_coverage_breadth_ok",
      }),
      expect.objectContaining({
        id: "M058-S01-CI-SPLIT-PRESERVED",
        passed: true,
        status_code: "ci_split_preserved_ok",
      }),
      expect.objectContaining({
        id: "M058-S01-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
      expect.objectContaining({
        id: "M058-S01-CI-ORDERING-RATIONALE",
        passed: true,
        status_code: "ci_ordering_rationale_ok",
      }),
    ]);

    const rendered = renderM058S01Report(report);
    expect(rendered).toContain("M058 S01 CI coverage verifier");
    expect(rendered).toContain("CI coverage proof surface: PASS");
    expect(rendered).toContain("M058-S01-CI-COVERAGE-BREADTH PASS");
    expect(rendered).toContain("M058-S01-CI-SPLIT-PRESERVED PASS");
    expect(rendered).toContain("M058-S01-PACKAGE-WIRING PASS");
    expect(rendered).toContain("M058-S01-CI-ORDERING-RATIONALE PASS");
  });

  test("fails with stable status codes for missing coverage, stale split step, and missing wiring", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM058S01ProofHarness({
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
    steps:
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests on a low concurrency cap and split the suite into
      # two shorter invocations to avoid cross-file schema interference and runner crashes.
      - run: bun test --max-concurrency=2 scripts src/contributor src/handlers src/webhook
      - run: bun run verify:m056:s03
      - run: bun test --max-concurrency=2 src/webhook
      - run: bunx tsc --noEmit
`;
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M058-S01-CI-COVERAGE-BREADTH",
        passed: false,
        status_code: "ci_coverage_step_missing",
      }),
      expect.objectContaining({
        id: "M058-S01-CI-SPLIT-PRESERVED",
        passed: false,
        status_code: "ci_split_step_missing",
      }),
      expect.objectContaining({
        id: "M058-S01-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
      expect.objectContaining({
        id: "M058-S01-CI-ORDERING-RATIONALE",
        passed: true,
        status_code: "ci_ordering_rationale_ok",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("bun test --max-concurrency=2 scripts src");
    expect(report.checks[1]?.detail).toContain("bun test --max-concurrency=2 src/knowledge");
    expect(report.checks[2]?.detail).toContain("verify:m058:s01");
    expect(stderr.join(" ")).toContain("ci_coverage_step_missing");
    expect(stderr.join(" ")).toContain("ci_split_step_missing");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("fails with a stable status code when the verifier step is ordered after the broadened test step", async () => {
    const report = await evaluateM058S01Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return PASSING_PACKAGE_JSON;
        if (filePath.endsWith("ci.yml")) {
          return `name: ci
jobs:
  test:
    steps:
      # Bun has been unstable on GitHub runners with one monolithic test process.
      # Keep DB-backed tests on a low concurrency cap and split the suite into
      # two shorter invocations to avoid cross-file schema interference and runner crashes.
      - run: bun test --max-concurrency=2 scripts src
      - run: bun run verify:m056:s03
      - run: bun test --max-concurrency=2 src/knowledge
      - run: bunx tsc --noEmit
`;
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(report.checks[3]).toEqual(
      expect.objectContaining({
        id: "M058-S01-CI-ORDERING-RATIONALE",
        passed: false,
        status_code: "ci_verify_step_misordered",
      }),
    );
    expect(report.checks[3]?.detail).toContain("bun run verify:m056:s03");
    expect(report.checks[3]?.detail).toContain("bun test --max-concurrency=2 scripts src");
  });

  test("flags stale rationale comments, invalid package json, unreadable files, and malformed cli usage", async () => {
    const staleCommentReport = await evaluateM058S01Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) return "{ not valid json";
        if (filePath.endsWith("ci.yml")) {
          return `name: ci
jobs:
  test:
    steps:
      - run: bun run verify:m056:s03
      # Bun used to be flaky, but the old src list is still here.
      - run: bun test --max-concurrency=2 scripts src
      - run: bun test --max-concurrency=2 src/knowledge
`;
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(staleCommentReport.checks[0]).toEqual(
      expect.objectContaining({
        id: "M058-S01-CI-COVERAGE-BREADTH",
        passed: true,
        status_code: "ci_coverage_breadth_ok",
      }),
    );
    expect(staleCommentReport.checks[1]).toEqual(
      expect.objectContaining({
        id: "M058-S01-CI-SPLIT-PRESERVED",
        passed: true,
        status_code: "ci_split_preserved_ok",
      }),
    );
    expect(staleCommentReport.checks[2]).toEqual(
      expect.objectContaining({
        id: "M058-S01-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );
    expect(staleCommentReport.checks[3]).toEqual(
      expect.objectContaining({
        id: "M058-S01-CI-ORDERING-RATIONALE",
        passed: false,
        status_code: "ci_split_rationale_comment_missing",
      }),
    );

    const unreadableFiles = await evaluateM058S01Proof({
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith("package.json")) throw new Error("EACCES: package.json");
        if (filePath.endsWith("ci.yml")) throw new Error("EACCES: ci.yml");
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(unreadableFiles.checks).toEqual([
      expect.objectContaining({ id: "M058-S01-CI-COVERAGE-BREADTH", status_code: "ci_file_unreadable" }),
      expect.objectContaining({ id: "M058-S01-CI-SPLIT-PRESERVED", status_code: "ci_file_unreadable" }),
      expect.objectContaining({ id: "M058-S01-PACKAGE-WIRING", status_code: "package_file_unreadable" }),
      expect.objectContaining({ id: "M058-S01-CI-ORDERING-RATIONALE", status_code: "ci_file_unreadable" }),
    ]);
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m058:s01"]).toBe(
      "bun scripts/verify-m058-s01.ts",
    );
  });
});
