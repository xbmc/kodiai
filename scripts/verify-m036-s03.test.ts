import { describe, expect, test } from "bun:test";
import {
  M036_S03_CHECK_IDS,
  evaluateM036S03,
  buildM036S03ProofHarness,
  runRetirementCheck,
  runNotifyLifecycleCheck,
  runNotifyFailOpenCheck,
} from "./verify-m036-s03.ts";
import type {
  EvaluationReport,
  RetirementFixtureResult,
  NotifyLifecycleFixtureResult,
  NotifyFailOpenFixtureResult,
} from "./verify-m036-s03.ts";
import type { RetirementPolicyResult } from "../src/knowledge/generated-rule-retirement.ts";
import type { LifecycleNotifyResult } from "../src/knowledge/generated-rule-notify.ts";
import type { GeneratedRuleRecord } from "../src/knowledge/generated-rule-store.ts";

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function makeActiveRecord(overrides?: Partial<GeneratedRuleRecord>): GeneratedRuleRecord {
  return {
    id: 1,
    repo: "xbmc/xbmc",
    title: "Guard state mutations",
    ruleText: "Ensure preconditions hold before mutating shared state.",
    status: "active",
    origin: "generated",
    signalScore: 0.2,
    memberCount: 2,
    clusterCentroid: new Float32Array([1, 0]),
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:00Z",
    activatedAt: "2026-04-04T00:01:00Z",
    retiredAt: null,
    ...overrides,
  };
}

function makeRetiredRecord(base: GeneratedRuleRecord): GeneratedRuleRecord {
  return { ...base, status: "retired", retiredAt: "2026-04-04T01:00:00Z" };
}

function makeRetirementResult(overrides?: Partial<RetirementPolicyResult>): RetirementPolicyResult {
  const rule = makeRetiredRecord(makeActiveRecord());
  return {
    repo: "xbmc/xbmc",
    floor: 0.3,
    minMemberCount: 3,
    activeEvaluated: 1,
    retired: 1,
    kept: 0,
    retirementFailures: 0,
    retiredRules: [rule],
    durationMs: 5,
    ...overrides,
  };
}

function makeNotifyResult(overrides?: Partial<LifecycleNotifyResult>): LifecycleNotifyResult {
  return {
    repo: "xbmc/xbmc",
    activationEvents: 1,
    retirementEvents: 1,
    notifyHookCalled: true,
    notifyHookFailed: false,
    durationMs: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// M036-S03-RETIREMENT
// ---------------------------------------------------------------------------

describe("M036-S03-RETIREMENT", () => {
  test("passes with the real deterministic retirement fixture", async () => {
    const result = await runRetirementCheck();

    expect(result.id).toBe("M036-S03-RETIREMENT");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("rule_retired");
    expect(result.detail).toContain("retired=1");
    expect(result.detail).toContain("floor=0.3");
    expect(result.detail).toContain("ruleId=1");
  });

  test("fails when no rules were retired", async () => {
    const result = await runRetirementCheck(async (): Promise<RetirementFixtureResult> => ({
      policyResult: makeRetirementResult({ retired: 0, retiredRules: [] }),
    }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("retirement_failed");
    expect(result.detail).toContain("retired=0 expected 1");
  });

  test("fails when retirementFailures > 0", async () => {
    const rule = makeRetiredRecord(makeActiveRecord());
    const result = await runRetirementCheck(async (): Promise<RetirementFixtureResult> => ({
      policyResult: makeRetirementResult({ retired: 1, retirementFailures: 2, retiredRules: [rule] }),
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("retirementFailures=2 expected 0");
  });

  test("fails when retired rule status is not 'retired'", async () => {
    const activeRule = makeActiveRecord();  // still 'active' — not properly retired
    const result = await runRetirementCheck(async (): Promise<RetirementFixtureResult> => ({
      policyResult: makeRetirementResult({
        retired: 1,
        retiredRules: [activeRule],
      }),
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("retiredRule status is not 'retired'");
  });
});

// ---------------------------------------------------------------------------
// M036-S03-NOTIFY-LIFECYCLE
// ---------------------------------------------------------------------------

describe("M036-S03-NOTIFY-LIFECYCLE", () => {
  test("passes with the real deterministic notify-lifecycle fixture", async () => {
    const result = await runNotifyLifecycleCheck();

    expect(result.id).toBe("M036-S03-NOTIFY-LIFECYCLE");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("lifecycle_notified");
    expect(result.detail).toContain("activationEvents=1");
    expect(result.detail).toContain("retirementEvents=1");
    expect(result.detail).toContain("hookCalled=true");
    expect(result.detail).toContain("hookCallCount=2");
  });

  test("fails when activationEvents is 0", async () => {
    const result = await runNotifyLifecycleCheck(
      async (): Promise<NotifyLifecycleFixtureResult> => ({
        notifyResult: makeNotifyResult({ activationEvents: 0 }),
        hookCallCount: 1,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("notify_lifecycle_failed");
    expect(result.detail).toContain("activationEvents=0 expected 1");
  });

  test("fails when retirementEvents is 0", async () => {
    const result = await runNotifyLifecycleCheck(
      async (): Promise<NotifyLifecycleFixtureResult> => ({
        notifyResult: makeNotifyResult({ retirementEvents: 0 }),
        hookCallCount: 1,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("retirementEvents=0 expected 1");
  });

  test("fails when hook was not called", async () => {
    const result = await runNotifyLifecycleCheck(
      async (): Promise<NotifyLifecycleFixtureResult> => ({
        notifyResult: makeNotifyResult({ notifyHookCalled: false }),
        hookCallCount: 0,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("notifyHookCalled=false expected true");
  });

  test("fails when hookCallCount does not equal total events", async () => {
    const result = await runNotifyLifecycleCheck(
      async (): Promise<NotifyLifecycleFixtureResult> => ({
        notifyResult: makeNotifyResult(),
        hookCallCount: 1,   // should be 2 (1 activation + 1 retirement)
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("hookCallCount=1 expected 2");
  });

  test("fails when hook failed unexpectedly", async () => {
    const result = await runNotifyLifecycleCheck(
      async (): Promise<NotifyLifecycleFixtureResult> => ({
        notifyResult: makeNotifyResult({ notifyHookFailed: true }),
        hookCallCount: 2,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("notifyHookFailed=true");
  });
});

// ---------------------------------------------------------------------------
// M036-S03-NOTIFY-FAIL-OPEN
// ---------------------------------------------------------------------------

describe("M036-S03-NOTIFY-FAIL-OPEN", () => {
  test("passes with the real deterministic fail-open fixture", async () => {
    const result = await runNotifyFailOpenCheck();

    expect(result.id).toBe("M036-S03-NOTIFY-FAIL-OPEN");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("notify_fail_open");
    expect(result.detail).toContain("notifyHookFailed=true");
    expect(result.detail).toContain("notifyHookCalled=true");
    expect(result.detail).toContain("warnCount=1");
    expect(result.detail).toContain("retirementEvents=1");
  });

  test("fails when notifyHookFailed is false (hook did not throw)", async () => {
    const result = await runNotifyFailOpenCheck(
      async (): Promise<NotifyFailOpenFixtureResult> => ({
        notifyResult: makeNotifyResult({ notifyHookFailed: false, activationEvents: 0 }),
        warnCount: 0,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("not_fail_open");
    expect(result.detail).toContain("notifyHookFailed=false expected true");
  });

  test("fails when no warn log was emitted on hook failure", async () => {
    const result = await runNotifyFailOpenCheck(
      async (): Promise<NotifyFailOpenFixtureResult> => ({
        notifyResult: makeNotifyResult({ notifyHookFailed: true, activationEvents: 0 }),
        warnCount: 0,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("no warn log emitted on hook failure");
  });

  test("fails when retirementEvents is 0 (result not returned)", async () => {
    const result = await runNotifyFailOpenCheck(
      async (): Promise<NotifyFailOpenFixtureResult> => ({
        notifyResult: makeNotifyResult({ notifyHookFailed: true, retirementEvents: 0, activationEvents: 0 }),
        warnCount: 1,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("retirementEvents=0 expected 1");
  });
});

// ---------------------------------------------------------------------------
// evaluateM036S03
// ---------------------------------------------------------------------------

describe("evaluateM036S03", () => {
  test("returns all three check ids and passes with real fixtures", async () => {
    const report = await evaluateM036S03();

    expect(report.check_ids).toStrictEqual(M036_S03_CHECK_IDS);
    expect(report.checks.length).toBe(3);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM036S03({
      _retirementRunFn: async (): Promise<RetirementFixtureResult> => ({
        policyResult: makeRetirementResult({ retired: 0, retiredRules: [] }),
      }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed && !c.skipped);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M036-S03-RETIREMENT");
  });

  test("overallPassed is false when multiple checks fail", async () => {
    const report = await evaluateM036S03({
      _retirementRunFn: async (): Promise<RetirementFixtureResult> => ({
        policyResult: makeRetirementResult({ retired: 0, retiredRules: [] }),
      }),
      _notifyLifecycleRunFn: async (): Promise<NotifyLifecycleFixtureResult> => ({
        notifyResult: makeNotifyResult({ activationEvents: 0, retirementEvents: 0 }),
        hookCallCount: 0,
      }),
    });

    expect(report.overallPassed).toBe(false);
    const failingIds = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failingIds).toContain("M036-S03-RETIREMENT");
    expect(failingIds).toContain("M036-S03-NOTIFY-LIFECYCLE");
  });
});

// ---------------------------------------------------------------------------
// buildM036S03ProofHarness
// ---------------------------------------------------------------------------

describe("buildM036S03ProofHarness", () => {
  test("prints text output containing all three check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM036S03ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M036-S03-RETIREMENT");
    expect(output).toContain("M036-S03-NOTIFY-LIFECYCLE");
    expect(output).toContain("M036-S03-NOTIFY-FAIL-OPEN");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM036S03ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M036_S03_CHECK_IDS));
    expect(parsed.checks.length).toBe(3);
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM036S03ProofHarness({
      stdout,
      stderr,
      _retirementRunFn: async (): Promise<RetirementFixtureResult> => ({
        policyResult: makeRetirementResult({ retired: 0, retiredRules: [] }),
      }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m036:s03 failed");
    expect(stderrChunks.join("")).toContain("M036-S03-RETIREMENT");
  });

  test("JSON output has correct shape when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM036S03ProofHarness({
      stdout,
      stderr,
      json: true,
      _notifyFailOpenRunFn: async (): Promise<NotifyFailOpenFixtureResult> => ({
        notifyResult: makeNotifyResult({ notifyHookFailed: false, activationEvents: 0 }),
        warnCount: 0,
      }),
    });

    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;
    expect(parsed.overallPassed).toBe(false);
    const failing = parsed.checks.filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]!.id).toBe("M036-S03-NOTIFY-FAIL-OPEN");
  });
});
