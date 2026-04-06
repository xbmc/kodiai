import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  shouldAutoActivate,
  getActivationThreshold,
  applyActivationPolicy,
  DEFAULT_ACTIVATION_THRESHOLD,
  ACTIVATION_THRESHOLD_ENV_VAR,
} from "./generated-rule-activation.ts";
import type {
  GeneratedRuleRecord,
  GeneratedRuleStore,
  GeneratedRuleProposal,
  GeneratedRuleLifecycleCounts,
} from "./generated-rule-store.ts";

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

function makeRecord(overrides: Partial<GeneratedRuleRecord> = {}): GeneratedRuleRecord {
  return {
    id: 1,
    repo: "xbmc/xbmc",
    title: "Prefer null guards",
    ruleText: "Add an explicit null guard before dereferencing optional pointers.",
    status: "pending",
    origin: "generated",
    signalScore: 0.8,
    memberCount: 6,
    clusterCentroid: new Float32Array(0),
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    activatedAt: null,
    retiredAt: null,
    ...overrides,
  };
}

function makeActiveRecord(overrides: Partial<GeneratedRuleRecord> = {}): GeneratedRuleRecord {
  return makeRecord({
    status: "active",
    activatedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  });
}

function makeMockStore(overrides: Partial<GeneratedRuleStore> = {}): GeneratedRuleStore {
  return {
    savePendingRule: mock(async (_rule: GeneratedRuleProposal) => makeRecord()),
    getRule: mock(async (_id: number) => null),
    listRulesForRepo: mock(async (_repo: string, _opts?: unknown) => []),
    getActiveRulesForRepo: mock(async (_repo: string, _limit?: number) => []),
    activateRule: mock(async (id: number) => makeActiveRecord({ id })),
    retireRule: mock(async (id: number) => makeRecord({ id, status: "retired", retiredAt: "2025-12-01T00:00:00.000Z" })),
    getLifecycleCounts: mock(async (_repo: string): Promise<GeneratedRuleLifecycleCounts> => ({
      pending: 0,
      active: 0,
      retired: 0,
      total: 0,
    })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldAutoActivate — pure predicate
// ---------------------------------------------------------------------------

describe("shouldAutoActivate", () => {
  test("returns true when score equals threshold", () => {
    expect(shouldAutoActivate(0.7, 0.7)).toBe(true);
  });

  test("returns true when score exceeds threshold", () => {
    expect(shouldAutoActivate(0.9, 0.7)).toBe(true);
  });

  test("returns false when score is below threshold", () => {
    expect(shouldAutoActivate(0.69, 0.7)).toBe(false);
  });

  test("returns false when score is 0", () => {
    expect(shouldAutoActivate(0, 0.5)).toBe(false);
  });

  test("returns true when threshold is 0 and score is 0", () => {
    expect(shouldAutoActivate(0, 0)).toBe(true);
  });

  test("returns true when threshold is 1 and score is 1", () => {
    expect(shouldAutoActivate(1, 1)).toBe(true);
  });

  test("returns false when threshold is 1 and score is 0.999", () => {
    expect(shouldAutoActivate(0.999, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getActivationThreshold — env var parsing
// ---------------------------------------------------------------------------

describe("getActivationThreshold", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to original env state between tests
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  test("returns DEFAULT_ACTIVATION_THRESHOLD when env var is absent", () => {
    expect(getActivationThreshold()).toBe(DEFAULT_ACTIVATION_THRESHOLD);
  });

  test("parses a valid float from env var", () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "0.85";
    expect(getActivationThreshold()).toBe(0.85);
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  test("uses default when env var is non-numeric", () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "banana";
    expect(getActivationThreshold()).toBe(DEFAULT_ACTIVATION_THRESHOLD);
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  test("uses default when env var is above 1", () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "1.5";
    expect(getActivationThreshold()).toBe(DEFAULT_ACTIVATION_THRESHOLD);
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  test("uses default when env var is negative", () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "-0.1";
    expect(getActivationThreshold()).toBe(DEFAULT_ACTIVATION_THRESHOLD);
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  test("accepts 0 as a valid threshold", () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "0";
    expect(getActivationThreshold()).toBe(0);
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  test("accepts 1 as a valid threshold", () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "1";
    expect(getActivationThreshold()).toBe(1);
    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  });

  // Restore after all env-var tests
  Object.assign(process.env, originalEnv);
});

// ---------------------------------------------------------------------------
// applyActivationPolicy — integration over mock store
// ---------------------------------------------------------------------------

describe("applyActivationPolicy", () => {
  const REPO = "xbmc/xbmc";

  test("activates rules that meet the threshold", async () => {
    const pending = [
      makeRecord({ id: 1, signalScore: 0.9 }),
      makeRecord({ id: 2, title: "Second rule", signalScore: 0.75 }),
    ];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
      activateRule: mock(async (id: number) => makeActiveRecord({ id })),
    });

    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, threshold: 0.7 });

    expect(result.activated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.activationFailures).toBe(0);
    expect(result.activatedRules.length).toBe(2);
    expect(result.pendingEvaluated).toBe(2);
    expect(result.threshold).toBe(0.7);
    expect(result.repo).toBe(REPO);
  });

  test("skips rules below the threshold", async () => {
    const pending = [
      makeRecord({ id: 1, signalScore: 0.5 }),
      makeRecord({ id: 2, title: "Barely below", signalScore: 0.699 }),
    ];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
    });

    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, threshold: 0.7 });

    expect(result.activated).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.activationFailures).toBe(0);
    expect(result.activatedRules).toEqual([]);
  });

  test("mixed: activates qualifying, skips non-qualifying", async () => {
    const pending = [
      makeRecord({ id: 1, signalScore: 0.8 }),   // activates
      makeRecord({ id: 2, title: "Below", signalScore: 0.4 }),  // skipped
      makeRecord({ id: 3, title: "Exactly", signalScore: 0.7 }), // activates (equal = pass)
    ];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
      activateRule: mock(async (id: number) => makeActiveRecord({ id })),
    });

    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, threshold: 0.7 });

    expect(result.activated).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.activatedRules.map((r) => r.id)).toEqual([1, 3]);
  });

  test("returns empty result when no pending rules exist", async () => {
    const store = makeMockStore({
      listRulesForRepo: mock(async () => []),
    });

    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, threshold: 0.7 });

    expect(result.activated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.pendingEvaluated).toBe(0);
    expect(result.activatedRules).toEqual([]);
  });

  test("counts activation failures without throwing (fail-open)", async () => {
    const pending = [
      makeRecord({ id: 1, signalScore: 0.9 }),
      makeRecord({ id: 2, title: "Second", signalScore: 0.85 }),
    ];
    let callCount = 0;
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
      activateRule: mock(async (_id: number) => {
        callCount++;
        if (callCount === 1) throw new Error("DB timeout");
        return makeActiveRecord({ id: 2 });
      }),
    });

    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, threshold: 0.7 });

    expect(result.activated).toBe(1);
    expect(result.activationFailures).toBe(1);
    expect(result.activatedRules.length).toBe(1);
    expect(result.activatedRules[0]!.id).toBe(2);
  });

  test("counts null return from activateRule as an activation failure", async () => {
    const pending = [makeRecord({ id: 1, signalScore: 0.9 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
      activateRule: mock(async (_id: number): Promise<GeneratedRuleRecord | null> => null),
    });

    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, threshold: 0.7 });

    expect(result.activated).toBe(0);
    expect(result.activationFailures).toBe(1);
    expect(result.activatedRules).toEqual([]);
  });

  test("uses explicit threshold, not env var, when provided", async () => {
    process.env[ACTIVATION_THRESHOLD_ENV_VAR] = "0.3";
    const pending = [makeRecord({ id: 1, signalScore: 0.5 })]; // passes 0.3 but not 0.9
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
    });

    const result = await applyActivationPolicy({
      store,
      logger: silentLogger,
      repo: REPO,
      threshold: 0.9, // explicit — should override env
    });

    delete process.env[ACTIVATION_THRESHOLD_ENV_VAR];
    expect(result.skipped).toBe(1);
    expect(result.activated).toBe(0);
  });

  test("result includes durationMs ≥ 0", async () => {
    const store = makeMockStore({ listRulesForRepo: mock(async () => []) });
    const result = await applyActivationPolicy({ store, logger: silentLogger, repo: REPO });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("respects limit option when listing pending rules", async () => {
    const capturedOpts: unknown[] = [];
    const store = makeMockStore({
      listRulesForRepo: mock(async (_repo: string, opts: unknown) => {
        capturedOpts.push(opts);
        return [];
      }),
    });

    await applyActivationPolicy({ store, logger: silentLogger, repo: REPO, limit: 5 });

    expect(capturedOpts[0]).toMatchObject({ status: "pending", limit: 5 });
  });
});

// ---------------------------------------------------------------------------
// pending → active transition (store-call contract)
// ---------------------------------------------------------------------------

describe("pending → active transition contract", () => {
  test("activateRule is called with the correct rule id", async () => {
    const activateCalls: number[] = [];
    const pending = [
      makeRecord({ id: 42, signalScore: 0.95 }),
      makeRecord({ id: 43, title: "Second", signalScore: 0.8 }),
    ];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
      activateRule: mock(async (id: number) => {
        activateCalls.push(id);
        return makeActiveRecord({ id });
      }),
    });

    await applyActivationPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", threshold: 0.7 });

    expect(activateCalls).toEqual([42, 43]);
  });

  test("activateRule is not called for below-threshold rules", async () => {
    const activateCalls: number[] = [];
    const pending = [makeRecord({ id: 99, signalScore: 0.1 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => pending),
      activateRule: mock(async (id: number) => {
        activateCalls.push(id);
        return makeActiveRecord({ id });
      }),
    });

    await applyActivationPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", threshold: 0.7 });

    expect(activateCalls).toEqual([]);
  });
});
