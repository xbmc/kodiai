import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FIXTURE_PATH,
  evaluateM073S05Fixture,
  main,
  parseM073S05Args,
} from "./verify-m073-s05.ts";
import {
  aggregateVisibleBudgetProjections,
  type VisibleBudgetProjection,
} from "../src/review-visible-budget/visible-budget-behavior.ts";

const GOLDEN_FIXTURE_URL = new URL("./fixtures/m073-s05-visible-budget.json", import.meta.url);

async function goldenFixtureText(): Promise<string> {
  return await Bun.file(GOLDEN_FIXTURE_URL).text();
}

describe("verify-m073-s05", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S05Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S05Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S05Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S05Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S05Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S05Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for the golden visible budget fixture", async () => {
    const report = await evaluateM073S05Fixture(DEFAULT_FIXTURE_PATH, {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: goldenFixtureText,
    });

    expect(report).toMatchObject({
      command: "verify:m073:s05",
      generatedAt: "2026-05-18T05:30:00.000Z",
      fixturePath: DEFAULT_FIXTURE_PATH,
      overallPassed: true,
      statusCode: "m073_s05_ok",
      failedCheckIds: [],
      observedTotals: {
        projectionCount: 3,
        scenarioCounts: {
          "happy-path": 1,
          "scoped-review": 1,
          "fallback-review": 1,
        },
        statusCounts: {
          complete: 1,
          scoped: 1,
          fallback: 1,
        },
        reasonCounts: {
          "within-budget": 1,
          "prompt-budget-limited": 1,
          "continuation-fallback": 1,
          "continuation-compacted": 0,
          "cache-degraded": 0,
        },
        promptSectionCount: 5,
        promptTrimmedSectionCount: 2,
        promptBypassedSectionCount: 1,
        promptTrimmedTokenCount: 350,
        cacheObservationCount: 7,
        continuationObservationCount: 7,
        continuationFallbackCount: 4,
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "projection-cases.present",
      "scenario-coverage.present",
      "vocabulary.bounded",
      "projection-safety.valid",
      "totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails malformed fixture shape", async () => {
    const report = await evaluateM073S05Fixture("malformed.json", {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: async () => JSON.stringify({ visibleBudgetProjections: "not-array" }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("fixture.shape");
    expect(report.failedCheckIds).toContain("projection-cases.present");
    expect(report.issues.join("\n")).toContain("visibleBudgetProjections must be an array");
  });

  test("fails missing scenario coverage and inconsistent scoped-review status", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    const projections = fixture.visibleBudgetProjections as VisibleBudgetProjection[];
    const scoped = projections.find((projection) => projection.scenario === "scoped-review") as unknown as Record<string, unknown>;
    scoped.visibleStatus = "complete";
    scoped.visibleReason = "within-budget";
    fixture.visibleBudgetProjections = [scoped];
    fixture.visibleBudgetSummary = aggregateVisibleBudgetProjections(fixture.visibleBudgetProjections as VisibleBudgetProjection[]);

    const report = await evaluateM073S05Fixture("bad-scenario.json", {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });
    const issues = report.issues.join("\n");

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("scenario-coverage.present");
    expect(report.failedCheckIds).toContain("projection-safety.valid");
    expect(issues).toContain("missing happy-path projection");
    expect(issues).toContain("missing fallback-review projection");
    expect(issues).toContain("scoped-review scenario requires scoped status");
  });

  test("fails impossible deterministic totals", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    fixture.visibleBudgetSummary = {
      ...(fixture.visibleBudgetSummary as Record<string, unknown>),
      promptTrimmedTokenCount: 349,
    };

    const report = await evaluateM073S05Fixture("bad-totals.json", {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("totals.deterministic");
    expect(report.issues.join("\n")).toContain("visibleBudgetSummary.promptTrimmedTokenCount expected 350 but found 349");
  });

  test("fails raw text fields, raw fingerprint fields, and secret-like values without echoing payloads", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    fixture.promptText = "PROMPT SHOULD NOT APPEAR";
    fixture.diffHunk = "DIFF SHOULD NOT APPEAR";
    fixture.commentBody = "COMMENT SHOULD NOT APPEAR";
    fixture.cacheKey = "CACHE KEY SHOULD NOT APPEAR";
    fixture.rawFingerprint = "FINGERPRINT SHOULD NOT APPEAR";
    fixture.candidatePayload = "CANDIDATE SHOULD NOT APPEAR";
    fixture.modelOutput = "MODEL OUTPUT SHOULD NOT APPEAR";
    fixture.token = "sk-abc123 SHOULD NOT APPEAR";

    const report = await evaluateM073S05Fixture("unsafe-redaction.json", {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });
    const serialized = JSON.stringify(report);

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).toContain("promptText is a forbidden raw-text field");
    expect(serialized).toContain("cacheKey is a forbidden raw-fingerprint field");
    expect(serialized).toContain("rawFingerprint is a forbidden raw-fingerprint field");
    expect(serialized).not.toContain("PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("DIFF SHOULD NOT APPEAR");
    expect(serialized).not.toContain("COMMENT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("CACHE KEY SHOULD NOT APPEAR");
    expect(serialized).not.toContain("FINGERPRINT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("CANDIDATE SHOULD NOT APPEAR");
    expect(serialized).not.toContain("MODEL OUTPUT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("sk-abc123 SHOULD NOT APPEAR");
  });

  test("main emits parseable JSON for pass, parse failure, missing fixture, and invalid CLI", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--fixture", DEFAULT_FIXTURE_PATH, "--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM073S05Fixture(DEFAULT_FIXTURE_PATH, {
        generatedAt: "2026-05-18T05:30:00.000Z",
        readFixtureText: goldenFixtureText,
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join("")).command).toBe("verify:m073:s05");

    const invalidJsonReport = await evaluateM073S05Fixture("bad.json", {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: async () => "{ not-json and no payload echo }",
    });
    expect(invalidJsonReport.statusCode).toBe("m073_s05_invalid_json");
    expect(JSON.stringify(invalidJsonReport)).not.toContain("not-json");

    const missingReport = await evaluateM073S05Fixture("missing.json", {
      generatedAt: "2026-05-18T05:30:00.000Z",
      readFixtureText: async () => { throw new Error("secret local path detail"); },
    });
    expect(missingReport.statusCode).toBe("m073_s05_fixture_read_failed");
    expect(JSON.stringify(missingReport)).not.toContain("secret local path detail");

    const invalidArgStdout: string[] = [];
    const invalidArgExitCode = await main(["--bad", "--json"], {
      stdout: { write: (chunk: string) => void invalidArgStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidArgExitCode).toBe(2);
    expect(JSON.parse(invalidArgStdout.join("")).statusCode).toBe("m073_s05_invalid_arg");
  });
});
