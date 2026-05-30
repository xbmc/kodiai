import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM075Contract,
  main,
  parseM075Args,
  type M075ChildReport,
} from "./verify-m075.ts";
import type { NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";
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

function liveRows(messages: readonly string[]): readonly NormalizedLogAnalyticsRow[] {
  return messages.map((message, index) => ({
    timeGenerated: `2026-05-20T16:00:0${index}.000Z`,
    rawLog: JSON.stringify({ msg: message, reviewOutputKey: "owner/repo#1:abc", deliveryId: `delivery-${index}` }),
    malformed: false,
    deliveryId: `delivery-${index}`,
    reviewOutputKey: "owner/repo#1:abc",
    message,
    revisionName: "kodiai--abc",
    containerAppName: "kodiai",
    parsedLog: { msg: message, reviewOutputKey: "owner/repo#1:abc", deliveryId: `delivery-${index}` },
  }));
}

function structuredRow(gate: "review-timeout-classification" | "addon-check-classification", classification: string): NormalizedLogAnalyticsRow {
  return {
    timeGenerated: "2026-05-20T16:00:00.000Z",
    rawLog: JSON.stringify({ gate, classification, reviewOutputKey: "owner/repo#1:abc", deliveryId: "delivery-structured" }),
    malformed: false,
    deliveryId: "delivery-structured",
    reviewOutputKey: "owner/repo#1:abc",
    message: `${gate} ${classification}`,
    revisionName: "kodiai--abc",
    containerAppName: "kodiai",
    parsedLog: { gate, classification, reviewOutputKey: "owner/repo#1:abc", deliveryId: "delivery-structured" },
  };
}

function liveCollectors(rows: readonly NormalizedLogAnalyticsRow[] = []) {
  return {
    discoverWorkspaces: async () => ["workspace-1"],
    queryLogs: async ({ timespan }: { timespan: "PT12H" | "P7D" }) => ({ query: `take 200 ${timespan}`, rows }),
  };
}

function healthFetcher(overrides: Record<string, { status: number; json: unknown }> = {}) {
  return async (url: string) => {
    if (url.endsWith("/healthz")) return overrides.healthz ?? { status: 200, json: { status: "ok" } };
    if (url.endsWith("/readiness")) return overrides.readiness ?? { status: 200, json: { status: "ready" } };
    throw new Error("unexpected url");
  };
}

describe("verify-m075 aggregate local proof", () => {
  test("parses local and live CLI arguments while rejecting fixture overrides", () => {
    expect(parseM075Args([])).toEqual({ json: false, help: false, live: false, allowBlocked: false });
    expect(parseM075Args(["--json"])).toEqual({ json: true, help: false, live: false, allowBlocked: false });
    expect(parseM075Args(["--help"])).toEqual({ json: false, help: true, live: false, allowBlocked: false });
    expect(parseM075Args(["--live", "--base-url", "https://kodiai.example", "--allow-blocked"])).toEqual({ json: false, help: false, live: true, allowBlocked: true, baseUrl: "https://kodiai.example" });
    expect(() => parseM075Args(["--fixture"])).toThrow(/not supported/);
    expect(() => parseM075Args(["--base-url", "https:\/\/kodiai.example"])).toThrow(/requires --live/);
    expect(() => parseM075Args(["--allow-blocked"])).toThrow(/requires --live/);
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

  test("live mode passes healthy production-like health and bounded structured reclassification evidence", async () => {
    const report = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: false, baseUrl: "https://kodiai.example" }, {
      readPackageJsonText: async () => packageJson(),
      healthFetcher: healthFetcher(),
      s01LiveCollectors: liveCollectors([
        structuredRow("review-timeout-classification", "expected-bounded-outcome"),
        structuredRow("addon-check-classification", "expected-bounded-outcome"),
      ]),
    });

    expect(report.success).toBe(true);
    expect(report.observed.mode).toBe("live");
    expect(report.failedCheckIds).toEqual([]);
    expect(report.checks.find((check) => check.id === "health.available")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "readiness.available")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "raw-regression.absent")?.status).toBe("pass");
    expect(report.observed.liveLogs?.structuredReclassificationCounts["review-timeout-classification.expected-bounded-outcome"]).toBe(2);
  });

  test("live readiness can be degraded but ready", async () => {
    const report = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: false, baseUrl: "https://kodiai.example" }, {
      readPackageJsonText: async () => packageJson(),
      healthFetcher: healthFetcher({ readiness: { status: 200, json: { status: "ready", github: "degraded", reason: "GitHub API unreachable" } } }),
      s01LiveCollectors: liveCollectors([
        structuredRow("review-timeout-classification", "expected-bounded-outcome"),
      ]),
    });

    expect(report.success).toBe(true);
    expect(report.observed.health?.readinessDegraded).toBe(true);
    expect(report.checks.find((check) => check.id === "readiness.available")?.status).toBe("pass");
  });

  test("live mode reports blocked base URL and blocked Azure source without counting it as success", async () => {
    const report = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: true }, {
      readPackageJsonText: async () => packageJson(),
      env: {},
      s01LiveCollectors: { discoverWorkspaces: async () => [] },
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m075_live_blocked");
    expect(report.failedCheckIds).toContain("health.source.blocked");
    expect(report.failedCheckIds).toContain("live-log-source.blocked");
    expect(report.failedCheckIds).toContain("live-source.available");
  });

  test("live mode fails when raw regression evidence is present", async () => {
    const report = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: false, baseUrl: "https://kodiai.example" }, {
      readPackageJsonText: async () => packageJson(),
      healthFetcher: healthFetcher(),
      s01LiveCollectors: liveCollectors(liveRows(["review timeout exceeded budget"])),
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("raw-regression.absent");
    expect(report.observed.liveLogs?.rawRegressionCounts["review.timeout-or-long-run"]).toBe(2);
  });

  test("live mode fails closed on health HTTP errors, invalid JSON, Azure query errors, and redaction failures", async () => {
    const badHealth = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: false, baseUrl: "https://kodiai.example" }, {
      readPackageJsonText: async () => packageJson(),
      healthFetcher: healthFetcher({ healthz: { status: 500, json: { status: "down" } }, readiness: { status: 200, json: "not-json" } }),
      s01LiveCollectors: liveCollectors(),
    });
    const queryError = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: false, baseUrl: "https://kodiai.example" }, {
      readPackageJsonText: async () => packageJson(),
      healthFetcher: healthFetcher(),
      s01LiveCollectors: { discoverWorkspaces: async () => ["workspace-1"], queryLogs: async () => { throw new Error("query failed"); } },
    });
    const unsafe = await evaluateM075Contract({ json: true, help: false, live: true, allowBlocked: false, baseUrl: "https://kodiai.example" }, {
      readPackageJsonText: async () => packageJson(),
      healthFetcher: healthFetcher(),
      s01LiveCollectors: liveCollectors([{
        ...structuredRow("review-timeout-classification", "expected-bounded-outcome"),
        parsedLog: { gate: "review-timeout-classification", classification: "expected-bounded-outcome", rawLog: "RAW_PROMPT_CANARY" },
      }]),
    });

    expect(badHealth.failedCheckIds).toContain("health.available");
    expect(badHealth.failedCheckIds).toContain("readiness.available");
    expect(queryError.failedCheckIds).toContain("live-log-source.unavailable");
    expect(unsafe.failedCheckIds).toContain("live-redaction.safe");
    expect(JSON.stringify(unsafe)).not.toContain("RAW_PROMPT_CANARY");
  });

  test("main exits zero for allowed blocked live evidence while preserving blocked JSON status", async () => {
    let output = "";
    const exitCode = await main(["--live", "--allow-blocked", "--json"], {
      stdout: { write: (chunk) => { output += String(chunk); } },
      stderr: { write: () => undefined },
      evaluate: async () => ({
        command: COMMAND_NAME,
        generatedAt: "2026-05-20T16:00:00.000Z",
        success: false,
        statusCode: "m075_live_blocked",
        failedCheckIds: ["health.source.blocked"],
        checks: [{ id: "health.source.blocked", status: "blocked", message: "blocked", issues: [] }],
        observed: { mode: "live", childCount: 6, passedChildCount: 6, failedChildCount: 0, blockedChildCount: 0, packageScriptsChecked: [] },
        children: [],
        issues: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output).success).toBe(false);
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
