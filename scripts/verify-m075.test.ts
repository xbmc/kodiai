import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM075Contract,
  main,
  parseM075Args,
  type M075ChildReport,
} from "./verify-m075.ts";
import { COMMAND_NAME as S01_COMMAND_NAME, EXPECTED_PACKAGE_SCRIPT as S01_EXPECTED_PACKAGE_SCRIPT } from "./verify-m075-s01.ts";
import { COMMAND_NAME as S02_COMMAND_NAME, EXPECTED_PACKAGE_SCRIPT as S02_EXPECTED_PACKAGE_SCRIPT } from "./verify-m075-s02.ts";
import { COMMAND_NAME as S03_COMMAND_NAME, EXPECTED_PACKAGE_SCRIPT as S03_EXPECTED_PACKAGE_SCRIPT } from "./verify-m075-s03.ts";
import { COMMAND_NAME as S04_COMMAND_NAME, EXPECTED_PACKAGE_SCRIPT as S04_EXPECTED_PACKAGE_SCRIPT } from "./verify-m075-s04.ts";
import { COMMAND_NAME as S05_COMMAND_NAME, EXPECTED_PACKAGE_SCRIPT as S05_EXPECTED_PACKAGE_SCRIPT } from "./verify-m075-s05.ts";
import { COMMAND_NAME as S06_COMMAND_NAME, EXPECTED_PACKAGE_SCRIPT as S06_EXPECTED_PACKAGE_SCRIPT } from "./verify-m075-s06.ts";

function packageJson(overrides: Record<string, string | undefined> = {}): string {
  const scripts: Record<string, string> = {
    [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT,
    [S01_COMMAND_NAME]: S01_EXPECTED_PACKAGE_SCRIPT,
    [S02_COMMAND_NAME]: S02_EXPECTED_PACKAGE_SCRIPT,
    [S03_COMMAND_NAME]: S03_EXPECTED_PACKAGE_SCRIPT,
    [S04_COMMAND_NAME]: S04_EXPECTED_PACKAGE_SCRIPT,
    [S05_COMMAND_NAME]: S05_EXPECTED_PACKAGE_SCRIPT,
    [S06_COMMAND_NAME]: S06_EXPECTED_PACKAGE_SCRIPT,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete scripts[key];
    else scripts[key] = value;
  }
  return JSON.stringify({ scripts });
}

function childReport(child: "s01" | "s02" | "s03" | "s04" | "s05" | "s06", overrides: Partial<M075ChildReport> = {}): M075ChildReport {
  const commandByChild = {
    s01: S01_COMMAND_NAME,
    s02: S02_COMMAND_NAME,
    s03: S03_COMMAND_NAME,
    s04: S04_COMMAND_NAME,
    s05: S05_COMMAND_NAME,
    s06: S06_COMMAND_NAME,
  } as const;
  const statusByChild = {
    s01: "m075_s01_ok",
    s02: "m075_s02_ok",
    s03: "m075_s03_ok",
    s04: "m075_s04_ok",
    s05: "m075_s05_ok",
    s06: "m075_s06_ok",
  } as const;
  return {
    command: commandByChild[child],
    generatedAt: "2026-05-20T16:00:00.000Z",
    success: true,
    statusCode: statusByChild[child],
    failedCheckIds: [],
    checks: [],
    issues: [],
    ...overrides,
  } as M075ChildReport;
}

describe("verify-m075 aggregate local proof", () => {
  test("parses aggregate-only CLI arguments and rejects fixture/live overrides", () => {
    expect(parseM075Args([])).toEqual({ json: false, help: false });
    expect(parseM075Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM075Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM075Args(["--fixture"])).toThrow(/not supported/);
    expect(() => parseM075Args(["--live"])).toThrow(/not supported/);
    expect(() => parseM075Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("passes when all S01-S06 child contracts and package wiring pass", async () => {
    const report = await evaluateM075Contract({
      generatedAt: "2026-05-20T16:00:00.000Z",
      readPackageJsonText: async () => packageJson(),
    });

    expect(report).toMatchObject({
      command: COMMAND_NAME,
      generatedAt: "2026-05-20T16:00:00.000Z",
      success: true,
      statusCode: "m075_ok",
      failedCheckIds: [],
      observed: {
        childCount: 6,
        passedChildCount: 6,
        failedChildCount: 0,
        blockedChildCount: 0,
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "local.s01.pass",
      "local.s02.pass",
      "local.s03.pass",
      "local.s04.pass",
      "local.s05.pass",
      "local.s06.pass",
      "package-wiring.present",
      "redaction.safe",
      "local-contracts.pass",
    ]);
    expect(report.children.map((child) => child.statusCode)).toEqual([
      "m075_s01_ok",
      "m075_s02_ok",
      "m075_s03_ok",
      "m075_s04_ok",
      "m075_s05_ok",
      "m075_s06_ok",
    ]);
  });

  test("fails closed with child status code and failed check id when a child evaluator fails", async () => {
    const report = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      childEvaluators: {
        s03: async () => childReport("s03", {
          success: false,
          statusCode: "m075_s03_contract_failed",
          failedCheckIds: ["redaction.safe"],
          checks: [{ id: "redaction.safe", status: "fail", message: "unsafe", issues: ["redaction.safe failed"] }],
          issues: ["redaction.safe failed"],
        }),
      },
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("local.s03.pass");
    expect(report.failedCheckIds).toContain("local-contracts.pass");
    expect(report.children.find((child) => child.child === "s03")).toMatchObject({
      statusCode: "m075_s03_contract_failed",
      failedCheckIds: ["redaction.safe"],
    });
    expect(report.issues.join("\n")).toContain("statusCode=m075_s03_contract_failed");
    expect(report.issues.join("\n")).toContain("failedCheckId=redaction.safe");
  });

  test("preserves blocked child status instead of collapsing it into success", async () => {
    const report = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      childEvaluators: {
        s01: async () => childReport("s01", {
          success: false,
          statusCode: "m075_s01_live_source_blocked",
          failedCheckIds: ["source.available"],
          checks: [{ id: "source.available", status: "blocked", message: "blocked", issues: ["source unavailable"] }],
          issues: ["source.available: source unavailable"],
        }),
      },
    });

    expect(report.success).toBe(false);
    expect(report.checks.find((check) => check.id === "local.s01.pass")?.status).toBe("blocked");
    expect(report.checks.find((check) => check.id === "local-contracts.pass")?.status).toBe("blocked");
    expect(report.observed.blockedChildCount).toBe(1);
  });

  test("fails package-wiring.present when aggregate package script drifts", async () => {
    const report = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson({ [COMMAND_NAME]: undefined }),
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("package-wiring.present");
    expect(report.issues.join("\n")).toContain("verify:m075 must be wired");
  });

  test("fails redaction.safe and redacts unsafe child issue text", async () => {
    const report = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      childEvaluators: {
        s04: async () => childReport("s04", {
          success: false,
          statusCode: "m075_s04_contract_failed",
          failedCheckIds: ["redaction.safe"],
          issues: ["RAW_PROMPT_CANARY TOKEN=abc123 diff --git unsafe"],
        }),
      },
    });

    const serialized = JSON.stringify(report);
    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).toContain("[redacted unsafe aggregate issue text]");
    expect(serialized).not.toContain("RAW_PROMPT_CANARY");
    expect(serialized).not.toContain("diff --git");
  });

  test("malformed child reports and thrown evaluator errors fail closed", async () => {
    const malformed = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      childEvaluators: { s05: async () => ({ success: true }) },
    });
    const thrown = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      childEvaluators: { s06: async () => { throw new Error("boom"); } },
    });

    expect(malformed.success).toBe(false);
    expect(malformed.children.find((child) => child.child === "s05")?.statusCode).toBe("m075_aggregate_child_malformed");
    expect(malformed.failedCheckIds).toContain("local.s05.pass");
    expect(thrown.success).toBe(false);
    expect(thrown.children.find((child) => child.child === "s06")?.statusCode).toBe("m075_aggregate_child_malformed");
    expect(thrown.issues.join("\n")).toContain("evaluator threw boom");
  });

  test("malformed aggregate options reject ignored fixture paths and invalid child evaluator entries", async () => {
    const fixtureOverride = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      fixturePaths: { s03: ".gsd/raw.json" },
    } as never);
    const invalidEvaluator = await evaluateM075Contract({
      readPackageJsonText: async () => packageJson(),
      childEvaluators: { s03: "not-a-function" },
    } as never);

    expect(fixtureOverride.success).toBe(false);
    expect(fixtureOverride.failedCheckIds).toContain("local-contracts.pass");
    expect(fixtureOverride.issues.join("\n")).toContain("fixturePaths");
    expect(invalidEvaluator.success).toBe(false);
    expect(invalidEvaluator.issues.join("\n")).toContain("must be a function");
  });

  test("main emits JSON success and returns nonzero for invalid args", async () => {
    let output = "";
    let error = "";
    const ok = await main(["--json"], {
      stdout: { write: (chunk) => { output += String(chunk); } },
      stderr: { write: (chunk) => { error += String(chunk); } },
      evaluate: async () => ({
        command: COMMAND_NAME,
        generatedAt: "2026-05-20T16:00:00.000Z",
        success: true,
        statusCode: "m075_ok",
        failedCheckIds: [],
        checks: [],
        observed: { childCount: 6, passedChildCount: 6, failedChildCount: 0, blockedChildCount: 0, packageScriptsChecked: [] },
        children: [],
        issues: [],
      }),
    });
    const bad = await main(["--fixture"], {
      stdout: { write: (chunk) => { output += String(chunk); } },
      stderr: { write: (chunk) => { error += String(chunk); } },
    });

    expect(ok).toBe(0);
    expect(JSON.parse(output).statusCode).toBe("m075_ok");
    expect(bad).toBe(2);
    expect(error).toContain("m075_invalid_arg");
  });
});
