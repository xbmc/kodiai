import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FIXTURE_PATH,
  evaluateM073S03Fixture,
  main,
  parseM073S03Args,
} from "./verify-m073-s03.ts";
import { aggregateReviewCacheTelemetryObservations } from "../src/review-cache-telemetry/cache-telemetry.ts";

async function goldenFixtureText(): Promise<string> {
  return await Bun.file(DEFAULT_FIXTURE_PATH).text();
}

describe("verify-m073-s03", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S03Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S03Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S03Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S03Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S03Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S03Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for the golden cache telemetry fixture", async () => {
    const report = await evaluateM073S03Fixture(DEFAULT_FIXTURE_PATH, {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: goldenFixtureText,
    });

    expect(report).toMatchObject({
      command: "verify:m073:s03",
      generatedAt: "2026-05-18T03:00:00.000Z",
      fixturePath: DEFAULT_FIXTURE_PATH,
      overallPassed: true,
      statusCode: "m073_s03_ok",
      failedCheckIds: [],
      observedTotals: {
        observationCount: 7,
        deliveryCount: 6,
        bookkeepingErrorCount: 1,
        statusCounts: {
          hit: 1,
          miss: 2,
          degraded: 2,
          bypass: 2,
        },
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "cache-observations.present",
      "vocabulary.bounded",
      "observation-identity.unique",
      "reuse-safety.valid",
      "totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails malformed fixture shape", async () => {
    const report = await evaluateM073S03Fixture("malformed.json", {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: async () => JSON.stringify({ cacheTelemetryObservations: "not-array" }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("fixture.shape");
    expect(report.failedCheckIds).toContain("cache-observations.present");
    expect(report.issues.join("\n")).toContain("cacheTelemetryObservations must be an array");
  });

  test("fails unknown status/reason and duplicate observation keys", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    const observations = fixture.cacheTelemetryObservations as Array<Record<string, unknown>>;
    observations.push({
      cacheSurface: "review-derived-prompt",
      status: "warmish",
      reason: "unbounded-freeform-reason",
      deliveryId: "delivery-cache-001",
      repo: "octo/example",
    });
    fixture.cacheTelemetrySummary = aggregateReviewCacheTelemetryObservations(observations as never);

    const report = await evaluateM073S03Fixture("unknown.json", {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });
    const issues = report.issues.join("\n");

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("vocabulary.bounded");
    expect(report.failedCheckIds).toContain("observation-identity.unique");
    expect(issues).toContain("status is not allowed");
    expect(issues).toContain("reason is not allowed");
    expect(issues).toContain("duplicates deliveryId/cacheSurface without attemptOrdinal");
  });

  test("fails hit without fingerprint metadata and bypass without reason", async () => {
    const observations = [
      {
        cacheSurface: "review-derived-prompt",
        status: "hit",
        deliveryId: "delivery-hit-no-fp",
        repo: "octo/example",
      },
      {
        cacheSurface: "retrieval-query-embedding",
        status: "bypass",
        deliveryId: "delivery-bypass-no-reason",
        repo: "octo/example",
      },
    ];
    const report = await evaluateM073S03Fixture("unsafe-reuse.json", {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: async () => JSON.stringify({
        cacheTelemetryObservations: observations,
        cacheTelemetrySummary: aggregateReviewCacheTelemetryObservations(observations as never),
      }),
    });
    const issues = report.issues.join("\n");

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("reuse-safety.valid");
    expect(issues).toContain("hit row is missing fingerprintVersion");
    expect(issues).toContain("bypass row is missing a bounded reason");
  });

  test("fails raw text fields, raw fingerprint fields, and secret-like values without echoing payloads", async () => {
    const fixture = JSON.parse(await goldenFixtureText()) as Record<string, unknown>;
    fixture.commentBody = "COMMENT BODY SHOULD NOT APPEAR";
    fixture.retrievalText = "RETRIEVAL CHUNK SHOULD NOT APPEAR";
    fixture.fingerprintHash = "abcdef SHOULD NOT APPEAR";
    fixture.token = "github_pat_secret SHOULD NOT APPEAR";

    const report = await evaluateM073S03Fixture("unsafe.json", {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: async () => JSON.stringify(fixture),
    });
    const serialized = JSON.stringify(report);

    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).toContain("commentBody is a forbidden raw-text field");
    expect(serialized).toContain("fingerprintHash is a forbidden raw-fingerprint field");
    expect(serialized).not.toContain("COMMENT BODY SHOULD NOT APPEAR");
    expect(serialized).not.toContain("RETRIEVAL CHUNK SHOULD NOT APPEAR");
    expect(serialized).not.toContain("abcdef SHOULD NOT APPEAR");
    expect(serialized).not.toContain("github_pat_secret SHOULD NOT APPEAR");
  });

  test("main emits parseable JSON for pass, parse failure, missing fixture, and invalid CLI", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--fixture", DEFAULT_FIXTURE_PATH, "--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM073S03Fixture(DEFAULT_FIXTURE_PATH, {
        generatedAt: "2026-05-18T03:00:00.000Z",
        readFixtureText: goldenFixtureText,
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join("")).command).toBe("verify:m073:s03");

    const invalidJsonReport = await evaluateM073S03Fixture("bad.json", {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: async () => "{ not-json and no payload echo }",
    });
    expect(invalidJsonReport.statusCode).toBe("m073_s03_invalid_json");
    expect(JSON.stringify(invalidJsonReport)).not.toContain("not-json");

    const missingReport = await evaluateM073S03Fixture("missing.json", {
      generatedAt: "2026-05-18T03:00:00.000Z",
      readFixtureText: async () => { throw new Error("secret local path detail"); },
    });
    expect(missingReport.statusCode).toBe("m073_s03_fixture_read_failed");
    expect(JSON.stringify(missingReport)).not.toContain("secret local path detail");

    const invalidArgStdout: string[] = [];
    const invalidArgExitCode = await main(["--bad", "--json"], {
      stdout: { write: (chunk: string) => void invalidArgStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidArgExitCode).toBe(2);
    expect(JSON.parse(invalidArgStdout.join("")).statusCode).toBe("m073_s03_invalid_arg");
  });
});
