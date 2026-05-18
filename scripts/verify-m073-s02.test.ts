import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FIXTURE_PATH,
  evaluateM073S02Fixture,
  main,
  parseM073S02Args,
} from "./verify-m073-s02.ts";

const PASSING_FIXTURE = JSON.stringify({
  generatedAt: "2026-05-18T01:00:00.000Z",
  promptBudgetEvidence: [
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-budget-001",
      repo: "octo/example",
      taskType: "review",
      promptKind: "system",
      sections: [
        {
          sectionName: "persona",
          sectionPosition: 0,
          budgetChars: 600,
          budgetTokens: 150,
          includedChars: 400,
          includedTokens: 100,
          trimmedChars: 0,
          trimmedTokens: 0,
          budgetStatus: "included",
          budgetReason: "within-budget",
        },
        {
          sectionName: "changed-files-summary",
          sectionPosition: 1,
          budgetChars: 1200,
          budgetTokens: 300,
          includedChars: 1200,
          includedTokens: 300,
          trimmedChars: 600,
          trimmedTokens: 150,
          budgetStatus: "trimmed",
          budgetReason: "section-over-budget",
        },
      ],
    },
    {
      caseId: "large-diff-review",
      deliveryId: "delivery-budget-002",
      repo: "octo/example",
      taskType: "review",
      promptKind: "user",
      sections: [
        {
          sectionName: "retrieval-context",
          sectionPosition: 0,
          budgetChars: 0,
          budgetTokens: 0,
          includedChars: 0,
          includedTokens: 0,
          trimmedChars: 0,
          trimmedTokens: 0,
          budgetStatus: "bypassed",
          budgetReason: "zero-budget",
        },
      ],
    },
  ],
  overflowSummary: {
    sectionCount: 3,
    includedSections: 1,
    trimmedSections: 1,
    bypassedSections: 1,
    totalBudgetChars: 1800,
    totalBudgetTokens: 450,
    totalIncludedChars: 1600,
    totalIncludedTokens: 400,
    totalTrimmedChars: 600,
    totalTrimmedTokens: 150,
  },
});

describe("verify-m073-s02", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S02Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S02Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S02Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S02Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S02Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S02Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for valid prompt-budget evidence", async () => {
    const report = await evaluateM073S02Fixture("inline.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => PASSING_FIXTURE,
    });

    expect(report).toMatchObject({
      command: "verify:m073:s02",
      generatedAt: "2026-05-18T01:10:00.000Z",
      fixturePath: "inline.json",
      overallPassed: true,
      statusCode: "m073_s02_ok",
      failedCheckIds: [],
      observedTotals: {
        observationCount: 2,
        deliveryCount: 2,
        sectionCount: 3,
        includedSections: 1,
        trimmedSections: 1,
        bypassedSections: 1,
        totalTrimmedChars: 600,
        totalTrimmedTokens: 150,
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "budget-evidence.present",
      "budget-outcomes.valid",
      "overflow-totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails closed when deterministic overflow totals do not match the section outcomes", async () => {
    const fixture = JSON.parse(PASSING_FIXTURE) as Record<string, unknown>;
    fixture.overflowSummary = {
      ...(fixture.overflowSummary as Record<string, unknown>),
      totalTrimmedChars: 599,
    };

    const report = await evaluateM073S02Fixture("bad-totals.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("overflow-totals.deterministic");
    expect(report.issues.join("\n")).toContain("overflowSummary.totalTrimmedChars expected 600 but found 599");
  });

  test("fails malformed, impossible, or unknown budget outcomes", async () => {
    const report = await evaluateM073S02Fixture("invalid-outcomes.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify({
        promptBudgetEvidence: [
          {
            caseId: "invalid-case",
            deliveryId: "delivery-budget-003",
            repo: "octo/example",
            taskType: "review",
            promptKind: "user",
            sections: [
              {
                sectionName: "bad-section",
                sectionPosition: 0,
                budgetChars: 10,
                budgetTokens: 3,
                includedChars: 11,
                includedTokens: 3,
                trimmedChars: 0,
                trimmedTokens: 0,
                budgetStatus: "unknown",
                budgetReason: "within-budget",
              },
            ],
          },
        ],
        overflowSummary: {
          sectionCount: 1,
          includedSections: 0,
          trimmedSections: 0,
          bypassedSections: 0,
          totalBudgetChars: 10,
          totalBudgetTokens: 3,
          totalIncludedChars: 11,
          totalIncludedTokens: 3,
          totalTrimmedChars: 0,
          totalTrimmedTokens: 0,
        },
      }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("budget-outcomes.valid");
    expect(report.issues.join("\n")).toContain("budgetStatus is not allowed");
    expect(report.issues.join("\n")).toContain("includedChars exceeds budgetChars");
  });

  test("redaction guardrails reject raw text fields, oversized strings, and secret-like values without echoing payloads", async () => {
    const report = await evaluateM073S02Fixture("unsafe.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify({
        promptBudgetEvidence: [],
        overflowSummary: {},
        rawPrompt: "RAW PROMPT SHOULD NOT APPEAR",
        sectionText: "SECTION TEXT SHOULD NOT APPEAR",
        token: "sk-abc123 SHOULD NOT APPEAR",
        boundedLabel: "x".repeat(200),
      }),
    });

    const serialized = JSON.stringify(report);
    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).toContain("rawPrompt is a forbidden raw-text field");
    expect(serialized).not.toContain("RAW PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("SECTION TEXT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("sk-abc123 SHOULD NOT APPEAR");
    expect(serialized).not.toContain("x".repeat(200));
  });

  test("main emits parseable JSON for pass, parse failure, missing fixture, and invalid CLI", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--fixture", "inline.json", "--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM073S02Fixture("inline.json", {
        generatedAt: "2026-05-18T01:10:00.000Z",
        readFixtureText: async () => PASSING_FIXTURE,
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({ command: "verify:m073:s02", overallPassed: true });

    const invalidJsonReport = await evaluateM073S02Fixture("bad.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => "{ not-json and no payload echo }",
    });
    expect(invalidJsonReport.statusCode).toBe("m073_s02_invalid_json");
    expect(JSON.stringify(invalidJsonReport)).not.toContain("not-json");

    const missingReport = await evaluateM073S02Fixture("missing.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => { throw new Error("secret local path detail"); },
    });
    expect(missingReport.statusCode).toBe("m073_s02_fixture_read_failed");
    expect(JSON.stringify(missingReport)).not.toContain("secret local path detail");

    const invalidArgStdout: string[] = [];
    const invalidArgExitCode = await main(["--bad", "--json"], {
      stdout: { write: (chunk: string) => void invalidArgStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidArgExitCode).toBe(2);
    expect(JSON.parse(invalidArgStdout.join(""))).toMatchObject({
      command: "verify:m073:s02",
      overallPassed: false,
      statusCode: "m073_s02_invalid_arg",
    });
  });
});
