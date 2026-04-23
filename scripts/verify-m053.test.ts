import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m053.ts";
import {
  M053_CHECK_IDS,
  buildM053ProofHarness,
  evaluateM053,
  parseM053Args,
  renderM053Report,
} from "./verify-m053.ts";

const EXPECTED_CHECK_IDS = [
  "M053-HELPER-REMOVED",
  "M053-SRC-NEW-FUNCTION-CLEAN",
  "M053-DECISION-RECORDED",
] as const;

describe("verify m053 invariant proof harness", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M053_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM053Args([])).toEqual({ json: false });
    expect(parseM053Args(["--json"])).toEqual({ json: true });
    expect(() => parseM053Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes when helper is absent, src tree is clean, and the decision record is present", async () => {
    const report = await evaluateM053({
      generatedAt: "2026-04-21T04:30:00.000Z",
      pathExists: async () => false,
      walkFiles: async () => [
        "/repo/src/a.ts",
        "/repo/src/contributor/example.test.ts",
      ],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith(".gsd/DECISIONS.md")) {
          return "| D999 | M053/S01/T02 | security | M053 src-tree no-dynamic-evaluator invariant | choice | rationale | Yes | agent |";
        }
        return "export const ok = true;";
      },
    });

    expect(report.command).toBe("verify:m053");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M053-HELPER-REMOVED",
        passed: true,
        status_code: "removed_helper_absent",
      }),
      expect.objectContaining({
        id: "M053-SRC-NEW-FUNCTION-CLEAN",
        passed: true,
        status_code: "src_tree_no_new_function",
      }),
      expect.objectContaining({
        id: "M053-DECISION-RECORDED",
        passed: true,
        status_code: "decision_record_present",
      }),
    ]);

    const rendered = renderM053Report(report);
    expect(rendered).toContain("Proof surface: PASS");
    expect(rendered).toContain("M053-HELPER-REMOVED PASS");
    expect(rendered).toContain("M053-SRC-NEW-FUNCTION-CLEAN PASS");
    expect(rendered).toContain("M053-DECISION-RECORDED PASS");
  });

  test("fails with named status codes when the helper reappears, src tree regresses, or the decision is missing", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM053ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      pathExists: async () => true,
      walkFiles: async () => ["/repo/src/bad.ts"],
      readTextFile: async (filePath: string) => {
        if (filePath.endsWith(".gsd/DECISIONS.md")) {
          return "# Decisions Register\n";
        }
        return 'const importModule = new Function("specifier", "return import(specifier)");';
      },
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M053-HELPER-REMOVED",
        passed: false,
        status_code: "removed_helper_present",
      }),
      expect.objectContaining({
        id: "M053-SRC-NEW-FUNCTION-CLEAN",
        passed: false,
        status_code: "src_tree_contains_new_function",
      }),
      expect.objectContaining({
        id: "M053-DECISION-RECORDED",
        passed: false,
        status_code: "decision_record_missing",
      }),
    ]);
    expect(report.checks[1]?.detail).toContain("src/bad.ts");
    expect(stderr.join(" ")).toContain("removed_helper_present");
    expect(stderr.join(" ")).toContain("src_tree_contains_new_function");
    expect(stderr.join(" ")).toContain("decision_record_missing");
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m053"]).toBe("bun scripts/verify-m053.ts");
  });
});
