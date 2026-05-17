import { describe, expect, test } from "bun:test";

import {
  DEFAULT_FIXTURE_PATH,
  evaluateM073S01Fixture,
  main,
  parseM073S01Args,
} from "./verify-m073-s01.ts";

const PASSING_FIXTURE = JSON.stringify({
  generatedAt: "2026-05-17T15:00:00.000Z",
  cases: [
    {
      caseId: "normal-full-review",
      label: "Normal full review",
      repo: "octo/example",
      scenario: "normal",
      deliveryIds: ["delivery-normal-001"],
    },
    {
      caseId: "retry-timeout-review",
      label: "Timeout retry review",
      repo: "octo/example",
      scenario: "retry",
      deliveryIds: ["delivery-retry-parent-001", "delivery-retry-child-001"],
    },
  ],
  promptSections: [
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-normal-001",
      repo: "octo/example",
      taskType: "review",
      promptKind: "system",
      sections: [{ sectionName: "persona", sectionPosition: 0, charCount: 400, estimatedTokens: 100 }],
    },
    {
      caseId: "retry-timeout-review",
      deliveryId: "delivery-retry-parent-001",
      repo: "octo/example",
      taskType: "review",
      promptKind: "user",
      sections: [{ sectionName: "changed-files-summary", sectionPosition: 0, charCount: 1200, estimatedTokens: 300 }],
    },
    {
      caseId: "retry-timeout-review",
      deliveryId: "delivery-retry-child-001",
      repo: "octo/example",
      taskType: "review.retry",
      promptKind: "user",
      sections: [{ sectionName: "retry-scope", sectionPosition: 0, charCount: 600, estimatedTokens: 150 }],
    },
  ],
  retrievalCache: [
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-normal-001",
      evidenceType: "retrieval.query-embedding",
      status: "hit",
      cacheHitRate: 1,
      reusedUnits: 3,
      primaryWorkUnits: 3,
      skippedQueries: 1,
      retryAttempts: 0,
    },
    {
      caseId: "retry-timeout-review",
      deliveryId: "delivery-retry-child-001",
      evidenceType: "review.derived-prompt",
      status: "hit",
      cacheHitRate: 1,
      reusedUnits: 1,
      primaryWorkUnits: 1,
      skippedQueries: 1,
      retryAttempts: 1,
    },
  ],
  continuations: [
    { caseId: "normal-full-review", deliveryId: "delivery-normal-001", kind: "initial" },
    { caseId: "retry-timeout-review", deliveryId: "delivery-retry-parent-001", kind: "initial" },
    { caseId: "retry-timeout-review", deliveryId: "delivery-retry-child-001", kind: "retry", parentDeliveryId: "delivery-retry-parent-001" },
  ],
  runtimeUsage: [
    {
      caseId: "normal-full-review",
      deliveryId: "delivery-normal-001",
      taskType: "review",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      sdk: "agent",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheWriteTokens: 50,
      estimatedCostUsd: 0.02,
      durationMs: 10000,
      usedFallback: false,
    },
    {
      caseId: "retry-timeout-review",
      deliveryId: "delivery-retry-child-001",
      taskType: "review.retry",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      sdk: "agent",
      inputTokens: 800,
      outputTokens: 300,
      cacheReadTokens: 100,
      cacheWriteTokens: 25,
      estimatedCostUsd: 0.03,
      durationMs: 12000,
      usedFallback: false,
    },
  ],
  phaseLatencies: [
    { caseId: "normal-full-review", deliveryId: "delivery-normal-001", phase: "remote runtime", status: "completed", durationMs: 10000 },
    { caseId: "retry-timeout-review", deliveryId: "delivery-retry-child-001", phase: "remote runtime", status: "completed", durationMs: 12000 },
  ],
});

describe("verify-m073-s01", () => {
  test("parses CLI arguments with default fixture and rejects unknown flags", () => {
    expect(parseM073S01Args([])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: false });
    expect(parseM073S01Args(["--json"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: true, help: false });
    expect(parseM073S01Args(["--fixture", "custom.json", "--json"])).toEqual({ fixturePath: "custom.json", json: true, help: false });
    expect(parseM073S01Args(["--help"])).toEqual({ fixturePath: DEFAULT_FIXTURE_PATH, json: false, help: true });
    expect(() => parseM073S01Args(["--fixture"])).toThrow(/invalid_cli_args/);
    expect(() => parseM073S01Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("emits a passing compact report for a valid fixture", async () => {
    const report = await evaluateM073S01Fixture("inline.json", {
      generatedAt: "2026-05-17T16:00:00.000Z",
      readFixtureText: async () => PASSING_FIXTURE,
    });

    expect(report).toMatchObject({
      command: "verify:m073:s01",
      generatedAt: "2026-05-17T16:00:00.000Z",
      fixturePath: "inline.json",
      overallPassed: true,
      statusCode: "m073_s01_ok",
      failedCheckIds: [],
      observedTotals: {
        caseCount: 2,
        deliveryCount: 3,
        promptEstimatedTokens: 550,
        runtimeTotalTokens: 2300,
        runtimeDurationMs: 22000,
        phaseLatencyMs: 22000,
      },
    });
    expect(report.checks.some((check) => check.id === "prompt-sections.present" && check.status === "pass")).toBe(true);
    expect(report.checks.some((check) => check.id === "retrieval-cache.valid" && check.status === "pass")).toBe(true);
    expect(report.checks.some((check) => check.id === "continuation.attributed" && check.status === "pass")).toBe(true);
    expect(report.checks.some((check) => check.id === "runtime-usage.present" && check.status === "pass")).toBe(true);
    expect(report.checks.some((check) => check.id === "phase-latency.present" && check.status === "pass")).toBe(true);
    expect(report.observedCases).toContainEqual(expect.objectContaining({
      caseId: "retry-timeout-review",
      retryDeliveries: 1,
      attributedChildDeliveries: 1,
      runtimeTotalTokens: 1100,
    }));
  });

  test("returns bounded nonzero failure for malformed fixture shape", async () => {
    const report = await evaluateM073S01Fixture("malformed.json", {
      generatedAt: "2026-05-17T16:00:00.000Z",
      readFixtureText: async () => JSON.stringify({ cases: [{ caseId: "bad-case", promptText: "do not echo this raw prompt" }] }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.statusCode).toBe("m073_s01_scorecard_failed");
    expect(report.failedCheckIds).toContain("cases.present");
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(report.issues.join("\n")).toContain("promptText is a forbidden raw-text field");
    expect(JSON.stringify(report)).not.toContain("do not echo this raw prompt");
  });

  test("main emits parseable JSON for pass, parse failure, missing fixture, and invalid CLI", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--fixture", "inline.json", "--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateM073S01Fixture("inline.json", {
        generatedAt: "2026-05-17T16:00:00.000Z",
        readFixtureText: async () => PASSING_FIXTURE,
      }),
    });
    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({ command: "verify:m073:s01", overallPassed: true });

    const invalidJsonReport = await evaluateM073S01Fixture("bad.json", {
      generatedAt: "2026-05-17T16:00:00.000Z",
      readFixtureText: async () => "{ not-json and no payload echo }",
    });
    expect(invalidJsonReport.statusCode).toBe("m073_s01_invalid_json");
    expect(JSON.stringify(invalidJsonReport)).not.toContain("not-json");

    const missingReport = await evaluateM073S01Fixture("missing.json", {
      generatedAt: "2026-05-17T16:00:00.000Z",
      readFixtureText: async () => { throw new Error("secret local path detail"); },
    });
    expect(missingReport.statusCode).toBe("m073_s01_fixture_read_failed");
    expect(JSON.stringify(missingReport)).not.toContain("secret local path detail");

    const invalidArgStdout: string[] = [];
    const invalidArgExitCode = await main(["--bad", "--json"], {
      stdout: { write: (chunk: string) => void invalidArgStdout.push(chunk) },
      stderr: { write: () => undefined },
    });
    expect(invalidArgExitCode).toBe(2);
    expect(JSON.parse(invalidArgStdout.join(""))).toMatchObject({
      command: "verify:m073:s01",
      overallPassed: false,
      statusCode: "m073_s01_invalid_arg",
    });
  });

  test("redaction guardrails do not echo raw diff, comment, candidate, model output, or secret-like values", async () => {
    const report = await evaluateM073S01Fixture("unsafe.json", {
      generatedAt: "2026-05-17T16:00:00.000Z",
      readFixtureText: async () => JSON.stringify({
        cases: [],
        promptSections: [],
        retrievalCache: [],
        continuations: [],
        runtimeUsage: [],
        phaseLatencies: [],
        rawPrompt: "RAW PROMPT SHOULD NOT APPEAR",
        diff: "diff --git SHOULD NOT APPEAR",
        commentBody: "comment SHOULD NOT APPEAR",
        candidatePayload: "candidate SHOULD NOT APPEAR",
        modelOutput: "model output SHOULD NOT APPEAR",
        token: "sk-abc123 SHOULD NOT APPEAR",
      }),
    });

    const serialized = JSON.stringify(report);
    expect(report.overallPassed).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(serialized).not.toContain("RAW PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("diff --git SHOULD NOT APPEAR");
    expect(serialized).not.toContain("comment SHOULD NOT APPEAR");
    expect(serialized).not.toContain("candidate SHOULD NOT APPEAR");
    expect(serialized).not.toContain("model output SHOULD NOT APPEAR");
    expect(serialized).not.toContain("sk-abc123 SHOULD NOT APPEAR");
  });
});
