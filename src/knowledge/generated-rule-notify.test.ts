import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  notifyLifecycleRun,
  notifyActivation,
  notifyRetirement,
  type LifecycleEvent,
  type LifecycleNotifyResult,
} from "./generated-rule-notify.ts";
import type { GeneratedRuleRecord } from "./generated-rule-store.ts";
import type { ActivationPolicyResult } from "./generated-rule-activation.ts";
import type { RetirementPolicyResult } from "./generated-rule-retirement.ts";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
  level: "silent",
} as unknown as import("pino").Logger;

function makeActiveRecord(id: number, overrides: Partial<GeneratedRuleRecord> = {}): GeneratedRuleRecord {
  return {
    id,
    repo: "xbmc/xbmc",
    title: `Rule ${id}`,
    ruleText: "Sample rule text.",
    status: "active",
    origin: "generated",
    signalScore: 0.8,
    memberCount: 6,
    clusterCentroid: new Float32Array(0),
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    activatedAt: "2025-06-01T00:00:00.000Z",
    retiredAt: null,
    ...overrides,
  };
}

function makeRetiredRecord(id: number): GeneratedRuleRecord {
  return makeActiveRecord(id, {
    status: "retired",
    retiredAt: "2025-12-01T00:00:00.000Z",
  });
}

function makeActivationResult(
  overrides: Partial<ActivationPolicyResult> = {},
): ActivationPolicyResult {
  return {
    repo: "xbmc/xbmc",
    threshold: 0.7,
    pendingEvaluated: 2,
    activated: 1,
    skipped: 1,
    activationFailures: 0,
    activatedRules: [makeActiveRecord(1)],
    durationMs: 100,
    ...overrides,
  };
}

function makeRetirementResult(
  overrides: Partial<RetirementPolicyResult> = {},
): RetirementPolicyResult {
  return {
    repo: "xbmc/xbmc",
    floor: 0.3,
    minMemberCount: 3,
    activeEvaluated: 3,
    retired: 1,
    kept: 2,
    retirementFailures: 0,
    retiredRules: [makeRetiredRecord(2)],
    durationMs: 80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// notifyLifecycleRun — combined activation + retirement
// ---------------------------------------------------------------------------

describe("notifyLifecycleRun", () => {
  test("returns counts matching activated and retired rule lists", async () => {
    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
    });

    expect(result.activationEvents).toBe(1);
    expect(result.retirementEvents).toBe(1);
    expect(result.repo).toBe("xbmc/xbmc");
  });

  test("returns zero counts when no rules changed", async () => {
    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult({ activatedRules: [], activated: 0 }),
      retirement: makeRetirementResult({ retiredRules: [], retired: 0 }),
    });

    expect(result.activationEvents).toBe(0);
    expect(result.retirementEvents).toBe(0);
  });

  test("does not call notifyHook when no events", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (events: LifecycleEvent[]) => { hookCalls.push(events); });

    await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult({ activatedRules: [], activated: 0 }),
      retirement: makeRetirementResult({ retiredRules: [], retired: 0 }),
      notifyHook: hook,
    });

    expect(hookCalls).toHaveLength(0);
  });

  test("calls notifyHook with all events when rules changed", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (events: LifecycleEvent[]) => { hookCalls.push(events); });

    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
      notifyHook: hook,
    });

    expect(hookCalls).toHaveLength(1);
    const events = hookCalls[0]!;
    expect(events).toHaveLength(2);
    const types = events.map((e) => e.type);
    expect(types).toContain("activated");
    expect(types).toContain("retired");
    expect(result.notifyHookCalled).toBe(true);
    expect(result.notifyHookFailed).toBe(false);
  });

  test("hook receives correct event shapes for activated rules", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (events: LifecycleEvent[]) => { hookCalls.push(events); });

    await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult({ activatedRules: [makeActiveRecord(7, { signalScore: 0.9, memberCount: 10 })] }),
      retirement: makeRetirementResult({ retiredRules: [], retired: 0 }),
      notifyHook: hook,
    });

    const events = hookCalls[0]!;
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe("activated");
    expect(ev.ruleId).toBe(7);
    expect(ev.repo).toBe("xbmc/xbmc");
    expect(ev.signalScore).toBe(0.9);
    expect(ev.memberCount).toBe(10);
    expect(typeof ev.timestamp).toBe("string");
    expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("hook receives correct event shapes for retired rules", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (events: LifecycleEvent[]) => { hookCalls.push(events); });

    await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult({ activatedRules: [], activated: 0 }),
      retirement: makeRetirementResult({ retiredRules: [makeRetiredRecord(42)], retired: 1 }),
      notifyHook: hook,
    });

    const events = hookCalls[0]!;
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe("retired");
    expect(ev.ruleId).toBe(42);
    expect(ev.repo).toBe("xbmc/xbmc");
  });

  test("notifyHook failure does not throw (fail-open)", async () => {
    const hook = mock(async (_events: LifecycleEvent[]) => {
      throw new Error("Slack is down");
    });

    // Should not throw
    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
      notifyHook: hook,
    });

    expect(result.notifyHookCalled).toBe(true);
    expect(result.notifyHookFailed).toBe(true);
    // Lifecycle results are still correct despite hook failure
    expect(result.activationEvents).toBe(1);
    expect(result.retirementEvents).toBe(1);
  });

  test("notifyHook failure does not affect returned counts", async () => {
    const hook = mock(async () => { throw new Error("network error"); });

    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult({ activatedRules: [makeActiveRecord(1), makeActiveRecord(2)], activated: 2 }),
      retirement: makeRetirementResult({ retiredRules: [makeRetiredRecord(3)], retired: 1 }),
      notifyHook: hook,
    });

    // Counts are from the rule lists, not from the hook
    expect(result.activationEvents).toBe(2);
    expect(result.retirementEvents).toBe(1);
    expect(result.notifyHookFailed).toBe(true);
  });

  test("notifyHookCalled is false when no hook provided", async () => {
    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
      // no hook
    });

    expect(result.notifyHookCalled).toBe(false);
    expect(result.notifyHookFailed).toBe(false);
  });

  test("returns durationMs as a non-negative number", async () => {
    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
    });

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("uses repo from activation result", async () => {
    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult({ repo: "my-org/my-repo", activatedRules: [makeActiveRecord(1, { repo: "my-org/my-repo" })] }),
      retirement: makeRetirementResult({ repo: "my-org/my-repo", retiredRules: [] }),
    });

    expect(result.repo).toBe("my-org/my-repo");
  });

  test("does not throw when logger has no child method", async () => {
    const flatLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as import("pino").Logger;

    const result = await notifyLifecycleRun({
      logger: flatLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
    });

    expect(result.activationEvents).toBe(1);
    expect(result.retirementEvents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// notifyActivation — activation only
// ---------------------------------------------------------------------------

describe("notifyActivation", () => {
  test("returns correct activation count, zero retirements", async () => {
    const result = await notifyActivation({
      logger: silentLogger,
      result: makeActivationResult({ activatedRules: [makeActiveRecord(1), makeActiveRecord(2)], activated: 2 }),
    });

    expect(result.activationEvents).toBe(2);
    expect(result.retirementEvents).toBe(0);
  });

  test("does not call hook when no rules activated", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (e: LifecycleEvent[]) => { hookCalls.push(e); });

    await notifyActivation({
      logger: silentLogger,
      result: makeActivationResult({ activatedRules: [], activated: 0 }),
      notifyHook: hook,
    });

    expect(hookCalls).toHaveLength(0);
  });

  test("calls hook with activated events when rules present", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (e: LifecycleEvent[]) => { hookCalls.push(e); });

    await notifyActivation({
      logger: silentLogger,
      result: makeActivationResult(),
      notifyHook: hook,
    });

    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]!.every((e) => e.type === "activated")).toBe(true);
  });

  test("hook failure is fail-open — no throw, notifyHookFailed=true", async () => {
    const hook = mock(async () => { throw new Error("hook error"); });

    const result = await notifyActivation({
      logger: silentLogger,
      result: makeActivationResult(),
      notifyHook: hook,
    });

    expect(result.notifyHookFailed).toBe(true);
    expect(result.activationEvents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// notifyRetirement — retirement only
// ---------------------------------------------------------------------------

describe("notifyRetirement", () => {
  test("returns correct retirement count, zero activations", async () => {
    const result = await notifyRetirement({
      logger: silentLogger,
      result: makeRetirementResult({ retiredRules: [makeRetiredRecord(5), makeRetiredRecord(6)], retired: 2 }),
    });

    expect(result.retirementEvents).toBe(2);
    expect(result.activationEvents).toBe(0);
  });

  test("does not call hook when no rules retired", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (e: LifecycleEvent[]) => { hookCalls.push(e); });

    await notifyRetirement({
      logger: silentLogger,
      result: makeRetirementResult({ retiredRules: [], retired: 0 }),
      notifyHook: hook,
    });

    expect(hookCalls).toHaveLength(0);
  });

  test("calls hook with retired events when rules present", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (e: LifecycleEvent[]) => { hookCalls.push(e); });

    await notifyRetirement({
      logger: silentLogger,
      result: makeRetirementResult(),
      notifyHook: hook,
    });

    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]!.every((e) => e.type === "retired")).toBe(true);
  });

  test("hook failure is fail-open — no throw, notifyHookFailed=true", async () => {
    const hook = mock(async () => { throw new Error("hook error"); });

    const result = await notifyRetirement({
      logger: silentLogger,
      result: makeRetirementResult(),
      notifyHook: hook,
    });

    expect(result.notifyHookFailed).toBe(true);
    expect(result.retirementEvents).toBe(1);
  });

  test("event shape for retired rules includes timestamp and ruleId", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (e: LifecycleEvent[]) => { hookCalls.push(e); });

    await notifyRetirement({
      logger: silentLogger,
      result: makeRetirementResult({ retiredRules: [makeRetiredRecord(99)], retired: 1 }),
      notifyHook: hook,
    });

    const ev = hookCalls[0]![0]!;
    expect(ev.ruleId).toBe(99);
    expect(ev.type).toBe("retired");
    expect(typeof ev.timestamp).toBe("string");
    expect(ev.timestamp.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle isolation — notification failure never blocks lifecycle state
// ---------------------------------------------------------------------------

describe("lifecycle isolation", () => {
  test("notifyLifecycleRun completes successfully even when hook throws synchronously", async () => {
    const syncThrowHook = mock(async () => {
      throw new TypeError("unexpected sync-style error");
    });

    const result = await notifyLifecycleRun({
      logger: silentLogger,
      activation: makeActivationResult(),
      retirement: makeRetirementResult(),
      notifyHook: syncThrowHook,
    });

    expect(result.notifyHookFailed).toBe(true);
    // Core result is still intact
    expect(result.activationEvents).toBe(1);
    expect(result.retirementEvents).toBe(1);
    expect(typeof result.durationMs).toBe("number");
  });

  test("notifyActivation does not propagate hook rejection", async () => {
    const hook = mock(async () => Promise.reject(new Error("rejected")));

    await expect(
      notifyActivation({
        logger: silentLogger,
        result: makeActivationResult(),
        notifyHook: hook,
      }),
    ).resolves.toBeDefined();
  });

  test("notifyRetirement does not propagate hook rejection", async () => {
    const hook = mock(async () => Promise.reject(new Error("rejected")));

    await expect(
      notifyRetirement({
        logger: silentLogger,
        result: makeRetirementResult(),
        notifyHook: hook,
      }),
    ).resolves.toBeDefined();
  });

  test("multiple concurrent notifyLifecycleRun calls do not interfere", async () => {
    const hookCalls: LifecycleEvent[][] = [];
    const hook = mock(async (e: LifecycleEvent[]) => {
      hookCalls.push(e);
    });

    const [r1, r2] = await Promise.all([
      notifyLifecycleRun({
        logger: silentLogger,
        activation: makeActivationResult({ repo: "org/repo-a", activatedRules: [makeActiveRecord(1, { repo: "org/repo-a" })] }),
        retirement: makeRetirementResult({ repo: "org/repo-a", retiredRules: [] }),
        notifyHook: hook,
      }),
      notifyLifecycleRun({
        logger: silentLogger,
        activation: makeActivationResult({ repo: "org/repo-b", activatedRules: [makeActiveRecord(2, { repo: "org/repo-b" }), makeActiveRecord(3, { repo: "org/repo-b" })] }),
        retirement: makeRetirementResult({ repo: "org/repo-b", retiredRules: [makeRetiredRecord(4)] }),
        notifyHook: hook,
      }),
    ]);

    expect(r1.repo).toBe("org/repo-a");
    expect(r1.activationEvents).toBe(1);
    expect(r2.repo).toBe("org/repo-b");
    expect(r2.activationEvents).toBe(2);
    expect(r2.retirementEvents).toBe(1);
    // Both calls triggered the hook
    expect(hookCalls).toHaveLength(2);
  });
});
