import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FIXTURE_PATH,
  evaluateM073S04Fixture,
  main,
  parseM073S04Args,
} from "./verify-m073-s04.ts";
import { aggregateContinuationCompactionObservations } from "../src/review-continuation/continuation-compaction.ts";

async function goldenFixtureText(): Promise<string> {
  return await Bun.file(DEFAULT_FIXTURE_PATH).text();
}

describe("verify-m073-s04", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S04Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S04Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S04Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S04Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S04Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S04Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for the golden continuation compaction fixture", async () => {
    const report = await evaluateM073S04Fixture(DEFAULT_FIXTURE_PATH, {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: goldenFixtureText,
    });

    expect(report).toMatchObject({
      command: "verify:m073:s04",
      generatedAt: "2026-05-18T04:00:00.000Z",
      fixturePath: DEFAULT_FIXTURE_PATH,
      overallPassed: true,
      statusCode: "m073_s04_ok",
      failedCheckIds: [],
      observedTotals: {
        observationCount: 7,
        deliveryCount: 7,
        attemptCount: 7,
        statusCounts: {
          compacted: 1,
          fallback: 4,
          degraded: 1,
          bypass: 1,
        },
        includedDeltaCount: 29,
        reusedCheckpointCount: 3,
        omittedScopeCount: 15,
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "compaction-observations.present",
      "vocabulary.bounded",
      "attempt-identity.valid",
      "decision-safety.valid",
      "totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails malformed fixture shape", async () => {
    const report = await evaluateM073S04Fixture("malformed.json", {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: async () => JSON.stringify({ continuationCompactionObservations: "not-array" }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("fixture.shape");
    expect(report.failedCheckIds).toContain("compaction-observations.present");
    expect(report.issues.join("\n")).toContain("continuationCompactionObservations must be an array");
  });

  test("fails unknown vocabulary and duplicate attempt identity", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    const observations = fixture.continuationCompactionObservations as Array<Record<string, unknown>>;
    observations.push({
      caseId: "bad-vocabulary",
      deliveryId: "delivery-continuation-001",
      repo: "octo/example",
      attemptId: "attempt-002",
      status: "compact-ish",
      reason: "unsafe-reason",
      fallbackState: "unknown",
      includedDeltaCount: 0,
      reusedCheckpointCount: 0,
      omittedScopeCount: 0,
      remainingScopeCount: 0,
    });
    fixture.continuationCompactionSummary = aggregateContinuationCompactionObservations(observations as never);

    const report = await evaluateM073S04Fixture("unknown.json", {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });
    const issues = report.issues.join("\n");

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("vocabulary.bounded");
    expect(report.failedCheckIds).toContain("attempt-identity.valid");
    expect(issues).toContain("status is not allowed");
    expect(issues).toContain("reason is not allowed");
    expect(issues).toContain("duplicates deliveryId/attemptId");
  });

  test("fails unsafe compacted row and fallback row that attempts checkpoint reuse", async () => {
    const observations = [
      {
        caseId: "unsafe-compacted",
        deliveryId: "delivery-continuation-unsafe",
        repo: "octo/example",
        attemptId: "attempt-002",
        status: "compacted",
        reason: "safe-delta-reuse",
        fallbackState: "none",
        includedDeltaCount: 1,
        reusedCheckpointCount: 0,
        omittedScopeCount: 0,
        remainingScopeCount: 1,
      },
      {
        caseId: "unsafe-fallback",
        deliveryId: "delivery-continuation-fallback",
        repo: "octo/example",
        attemptId: "attempt-001",
        status: "fallback",
        reason: "missing-checkpoint",
        fallbackState: "fuller-context",
        includedDeltaCount: 4,
        reusedCheckpointCount: 1,
        omittedScopeCount: 0,
        remainingScopeCount: 4,
      },
    ];

    const report = await evaluateM073S04Fixture("unsafe.json", {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: async () => JSON.stringify({
        continuationCompactionObservations: observations,
        continuationCompactionSummary: aggregateContinuationCompactionObservations(observations as never),
      }),
    });
    const issues = report.issues.join("\n");

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("decision-safety.valid");
    expect(issues).toContain("compacted status requires priorAttemptId");
    expect(issues).toContain("compacted status requires at least one reused checkpoint");
    expect(issues).toContain("fallback status cannot reuse checkpoints");
  });

  test("fails raw text fields, raw fingerprint fields, and secret-like values without echoing payloads", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    fixture.promptText = "PROMPT SHOULD NOT APPEAR";
    fixture.diffHunk = "DIFF SHOULD NOT APPEAR";
    fixture.candidateText = "CANDIDATE SHOULD NOT APPEAR";
    fixture.modelOutput = "MODEL OUTPUT SHOULD NOT APPEAR";
    fixture.rawFingerprint = "FINGERPRINT SHOULD NOT APPEAR";
    fixture.token = "sk-abc123 SHOULD NOT APPEAR";

    const report = await evaluateM073S04Fixture("unsafe-redaction.json", {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });
    const serialized = JSON.stringify(report);

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).toContain("promptText is a forbidden raw-text field");
    expect(serialized).toContain("rawFingerprint is a forbidden raw-fingerprint field");
    expect(serialized).not.toContain("PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("DIFF SHOULD NOT APPEAR");
    expect(serialized).not.toContain("CANDIDATE SHOULD NOT APPEAR");
    expect(serialized).not.toContain("MODEL OUTPUT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("FINGERPRINT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("sk-abc123 SHOULD NOT APPEAR");
  });

  test("main emits parseable JSON for pass, parse failure, missing fixture, and invalid CLI", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--fixture", DEFAULT_FIXTURE_PATH, "--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM073S04Fixture(DEFAULT_FIXTURE_PATH, {
        generatedAt: "2026-05-18T04:00:00.000Z",
        readFixtureText: goldenFixtureText,
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join("")).command).toBe("verify:m073:s04");

    const invalidJsonReport = await evaluateM073S04Fixture("bad.json", {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: async () => "{ not-json and no payload echo }",
    });
    expect(invalidJsonReport.statusCode).toBe("m073_s04_invalid_json");
    expect(JSON.stringify(invalidJsonReport)).not.toContain("not-json");

    const missingReport = await evaluateM073S04Fixture("missing.json", {
      generatedAt: "2026-05-18T04:00:00.000Z",
      readFixtureText: async () => { throw new Error("secret local path detail"); },
    });
    expect(missingReport.statusCode).toBe("m073_s04_fixture_read_failed");
    expect(JSON.stringify(missingReport)).not.toContain("secret local path detail");

    const invalidArgStdout: string[] = [];
    const invalidArgExitCode = await main(["--bad", "--json"], {
      stdout: { write: (chunk: string) => void invalidArgStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidArgExitCode).toBe(2);
    expect(JSON.parse(invalidArgStdout.join("")).statusCode).toBe("m073_s04_invalid_arg");
  });
});
