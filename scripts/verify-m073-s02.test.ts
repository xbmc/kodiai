import { describe, expect, test } from "bun:test";

import {
  DEFAULT_BASELINE_FIXTURE_PATH,
  DEFAULT_FIXTURE_PATH,
  evaluateM073S02Fixture,
  main,
  parseM073S02Args,
} from "./verify-m073-s02.ts";

const BASELINE_FIXTURE = JSON.stringify({
  promptSections: [
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-normal-001",
      repo: "octo/example",
      taskType: "review",
      promptKind: "system",
      sections: [{ sectionName: "persona", sectionPosition: 0, charCount: 420, estimatedTokens: 105 }],
    },
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-normal-001",
      repo: "octo/example",
      taskType: "review",
      promptKind: "user",
      sections: [
        { sectionName: "pr-metadata", sectionPosition: 0, charCount: 500, estimatedTokens: 125 },
        { sectionName: "changed-files-summary", sectionPosition: 1, charCount: 2400, estimatedTokens: 600, truncated: true },
      ],
    },
  ],
});

const PASSING_FIXTURE_OBJECT = {
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
          baselineSource: {
            reason: "s01-baseline",
            sourceFixturePath: DEFAULT_BASELINE_FIXTURE_PATH,
            sourceId: "normal-full-review:delivery-normal-001:system:persona",
            caseId: "normal-full-review",
            deliveryId: "delivery-normal-001",
            promptKind: "system",
            sectionName: "persona",
            baselineChars: 420,
            baselineEstimatedTokens: 105,
          },
        },
      ],
    },
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-budget-001",
      repo: "octo/example",
      taskType: "review",
      promptKind: "user",
      sections: [
        {
          sectionName: "pr-metadata",
          sectionPosition: 0,
          budgetChars: 500,
          budgetTokens: 125,
          includedChars: 500,
          includedTokens: 125,
          trimmedChars: 0,
          trimmedTokens: 0,
          budgetStatus: "included",
          budgetReason: "within-budget",
          baselineSource: {
            reason: "s01-baseline",
            sourceFixturePath: DEFAULT_BASELINE_FIXTURE_PATH,
            sourceId: "normal-full-review:delivery-normal-001:user:pr-metadata",
            caseId: "normal-full-review",
            deliveryId: "delivery-normal-001",
            promptKind: "user",
            sectionName: "pr-metadata",
            baselineChars: 500,
            baselineEstimatedTokens: 125,
          },
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
          baselineSource: {
            reason: "s01-baseline",
            sourceFixturePath: DEFAULT_BASELINE_FIXTURE_PATH,
            sourceId: "normal-full-review:delivery-normal-001:user:changed-files-summary",
            caseId: "normal-full-review",
            deliveryId: "delivery-normal-001",
            promptKind: "user",
            sectionName: "changed-files-summary",
            baselineChars: 2400,
            baselineEstimatedTokens: 600,
          },
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
          baselineSource: { reason: "new-budget-section" },
        },
      ],
    },
  ],
  overflowSummary: {
    sectionCount: 4,
    includedSections: 2,
    trimmedSections: 1,
    bypassedSections: 1,
    totalBudgetChars: 2300,
    totalBudgetTokens: 575,
    totalIncludedChars: 2100,
    totalIncludedTokens: 525,
    totalTrimmedChars: 600,
    totalTrimmedTokens: 150,
  },
};

const PASSING_FIXTURE = JSON.stringify(PASSING_FIXTURE_OBJECT);

function clonePassingFixture(): any {
  return JSON.parse(PASSING_FIXTURE);
}

const READ_BASELINE = async () => BASELINE_FIXTURE;

describe("verify-m073-s02", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S02Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S02Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S02Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S02Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S02Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S02Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for valid prompt-budget evidence with S01 baseline linkage", async () => {
    const report = await evaluateM073S02Fixture("inline.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => PASSING_FIXTURE,
      readBaselineFixtureText: READ_BASELINE,
    });

    expect(report).toMatchObject({
      command: "verify:m073:s02",
      generatedAt: "2026-05-18T01:10:00.000Z",
      fixturePath: "inline.json",
      overallPassed: true,
      statusCode: "m073_s02_ok",
      failedCheckIds: [],
      observedTotals: {
        observationCount: 3,
        deliveryCount: 2,
        sectionCount: 4,
        includedSections: 2,
        trimmedSections: 1,
        bypassedSections: 1,
        totalTrimmedChars: 600,
        totalTrimmedTokens: 150,
        baselineLinkedSections: 3,
        baselineNewSections: 1,
        baselineBypassedSections: 1,
        baselineFixturePaths: [DEFAULT_BASELINE_FIXTURE_PATH],
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "budget-evidence.present",
      "budget-outcomes.valid",
      "overflow-totals.deterministic",
      "baseline-linkage.valid",
      "redaction.safe",
    ]);
  });

  test("fails closed when baselineSource is missing", async () => {
    const fixture = clonePassingFixture();
    delete fixture.promptBudgetEvidence[0].sections[0].baselineSource;

    const report = await evaluateM073S02Fixture("missing-baseline-source.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
      readBaselineFixtureText: READ_BASELINE,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("baseline-linkage.valid");
    expect(report.issues.join("\n")).toContain("baselineSource.reason is not allowed");
  });

  test("fails closed for unknown new-section reasons and source claims on synthetic sections", async () => {
    const unknownReasonFixture = clonePassingFixture();
    unknownReasonFixture.promptBudgetEvidence[2].sections[0].baselineSource.reason = "unknown-source";

    const unknownReport = await evaluateM073S02Fixture("unknown-source.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(unknownReasonFixture),
      readBaselineFixtureText: READ_BASELINE,
    });
    expect(unknownReport.overallPassed).toBe(false);
    expect(unknownReport.issues.join("\n")).toContain("baselineSource.reason is not allowed");

    const syntheticClaimFixture = clonePassingFixture();
    syntheticClaimFixture.promptBudgetEvidence[2].sections[0].baselineSource.sourceId = "normal-full-review:delivery-normal-001:user:pr-metadata";

    const syntheticReport = await evaluateM073S02Fixture("synthetic-claim.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(syntheticClaimFixture),
      readBaselineFixtureText: READ_BASELINE,
    });
    expect(syntheticReport.overallPassed).toBe(false);
    expect(syntheticReport.issues.join("\n")).toContain("new-budget-section must not claim S01 fixture ids or baseline counts");
  });

  test("fails closed for malformed baseline counts, unknown S01 rows, and included counts exceeding declared budget", async () => {
    const fixture = clonePassingFixture();
    fixture.promptBudgetEvidence[0].sections[0].baselineSource.baselineChars = -1;
    fixture.promptBudgetEvidence[1].sections[0].baselineSource.sourceId = "normal-full-review:delivery-normal-001:user:missing";
    fixture.promptBudgetEvidence[1].sections[1].includedChars = 1201;

    const report = await evaluateM073S02Fixture("invalid-baseline-linkage.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
      readBaselineFixtureText: READ_BASELINE,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("baseline-linkage.valid");
    expect(report.failedCheckIds).toContain("budget-outcomes.valid");
    expect(report.issues.join("\n")).toContain("includedChars exceeds budgetChars");
    expect(report.issues.join("\n")).toContain("baselineChars must be a non-negative integer");
    expect(report.issues.join("\n")).toContain("sourceId does not match an S01 baseline row");
  });

  test("fails closed when deterministic overflow totals do not match the section outcomes", async () => {
    const fixture = clonePassingFixture();
    fixture.overflowSummary.totalTrimmedChars = 599;

    const report = await evaluateM073S02Fixture("bad-totals.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
      readBaselineFixtureText: READ_BASELINE,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("overflow-totals.deterministic");
    expect(report.issues.join("\n")).toContain("overflowSummary.totalTrimmedChars expected 600 but found 599");
  });

  test("fails malformed, impossible, or unknown budget outcomes", async () => {
    const fixture = clonePassingFixture();
    fixture.promptBudgetEvidence[0].sections[0].budgetStatus = "unknown";
    fixture.promptBudgetEvidence[0].sections[0].includedChars = 601;
    fixture.overflowSummary.totalIncludedChars = 2301;

    const report = await evaluateM073S02Fixture("invalid-outcomes.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
      readBaselineFixtureText: READ_BASELINE,
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
      readBaselineFixtureText: READ_BASELINE,
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
        readBaselineFixtureText: READ_BASELINE,
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join("")).observedTotals).toMatchObject({ baselineLinkedSections: 3, baselineNewSections: 1 });

    const invalidJsonReport = await evaluateM073S02Fixture("bad.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => "{ not-json and no payload echo }",
      readBaselineFixtureText: READ_BASELINE,
    });
    expect(invalidJsonReport.statusCode).toBe("m073_s02_invalid_json");
    expect(JSON.stringify(invalidJsonReport)).not.toContain("not-json");

    const missingReport = await evaluateM073S02Fixture("missing.json", {
      generatedAt: "2026-05-18T01:10:00.000Z",
      readFixtureText: async () => { throw new Error("secret local path detail"); },
      readBaselineFixtureText: READ_BASELINE,
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
