import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  shouldRetireRule,
  getRetirementFloor,
  getMinMemberCount,
  applyRetirementPolicy,
  DEFAULT_RETIREMENT_FLOOR,
  DEFAULT_MIN_MEMBER_COUNT,
  RETIREMENT_FLOOR_ENV_VAR,
  MIN_MEMBER_COUNT_ENV_VAR,
} from "./generated-rule-retirement.ts";
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

function makeActiveRecord(overrides: Partial<GeneratedRuleRecord> = {}): GeneratedRuleRecord {
  return {
    id: 1,
    repo: "xbmc/xbmc",
    title: "Prefer null guards",
    ruleText: "Add an explicit null guard before dereferencing optional pointers.",
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
  return makeActiveRecord({
    id,
    status: "retired",
    retiredAt: "2025-12-01T00:00:00.000Z",
  });
}

function makeMockStore(overrides: Partial<GeneratedRuleStore> = {}): GeneratedRuleStore {
  return {
    savePendingRule: mock(async (_rule: GeneratedRuleProposal) =>
      makeActiveRecord({ status: "pending" as const }),
    ),
    getRule: mock(async (_id: number) => null),
    listRulesForRepo: mock(async (_repo: string, _opts?: unknown) => []),
    getActiveRulesForRepo: mock(async (_repo: string, _limit?: number) => []),
    activateRule: mock(async (id: number) => makeActiveRecord({ id })),
    retireRule: mock(async (id: number) => makeRetiredRecord(id)),
    getLifecycleCounts: mock(
      async (_repo: string): Promise<GeneratedRuleLifecycleCounts> => ({
        pending: 0,
        active: 0,
        retired: 0,
        total: 0,
      }),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldRetireRule — pure predicate
// ---------------------------------------------------------------------------

describe("shouldRetireRule", () => {
  const OPTS = { floor: 0.3, minMemberCount: 3 };

  test("returns shouldRetire=false for a healthy rule", () => {
    const rule = makeActiveRecord({ signalScore: 0.8, memberCount: 6 });
    const result = shouldRetireRule(rule, OPTS);
    expect(result.shouldRetire).toBe(false);
    expect(result.reason).toBeNull();
  });

  test("returns shouldRetire=true with reason=below-floor when signalScore < floor", () => {
    const rule = makeActiveRecord({ signalScore: 0.2, memberCount: 6 });
    const result = shouldRetireRule(rule, OPTS);
    expect(result.shouldRetire).toBe(true);
    expect(result.reason).toBe("below-floor");
  });

  test("returns shouldRetire=true with reason=member-decay when memberCount < minMemberCount", () => {
    const rule = makeActiveRecord({ signalScore: 0.8, memberCount: 2 });
    const result = shouldRetireRule(rule, OPTS);
    expect(result.shouldRetire).toBe(true);
    expect(result.reason).toBe("member-decay");
  });

  test("below-floor takes precedence over member-decay when both apply", () => {
    const rule = makeActiveRecord({ signalScore: 0.1, memberCount: 1 });
    const result = shouldRetireRule(rule, OPTS);
    expect(result.shouldRetire).toBe(true);
    expect(result.reason).toBe("below-floor");
  });

  test("returns shouldRetire=false when signalScore exactly equals floor", () => {
    const rule = makeActiveRecord({ signalScore: 0.3, memberCount: 5 });
    const result = shouldRetireRule(rule, OPTS);
    // Equal to floor = NOT below floor, so should keep
    expect(result.shouldRetire).toBe(false);
  });

  test("returns shouldRetire=false when memberCount exactly equals minMemberCount", () => {
    const rule = makeActiveRecord({ signalScore: 0.8, memberCount: 3 });
    const result = shouldRetireRule(rule, OPTS);
    // Equal to min = NOT below min, so should keep
    expect(result.shouldRetire).toBe(false);
  });

  test("mirrors ruleId, title, signalScore, memberCount from the rule", () => {
    const rule = makeActiveRecord({ id: 42, title: "Test Rule", signalScore: 0.5, memberCount: 7 });
    const result = shouldRetireRule(rule, OPTS);
    expect(result.ruleId).toBe(42);
    expect(result.title).toBe("Test Rule");
    expect(result.signalScore).toBe(0.5);
    expect(result.memberCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// getRetirementFloor — env var parsing
// ---------------------------------------------------------------------------

describe("getRetirementFloor", () => {
  beforeEach(() => {
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });

  test("returns DEFAULT_RETIREMENT_FLOOR when env var is absent", () => {
    expect(getRetirementFloor()).toBe(DEFAULT_RETIREMENT_FLOOR);
  });

  test("parses a valid float from env var", () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "0.2";
    expect(getRetirementFloor()).toBe(0.2);
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });

  test("uses default when env var is non-numeric", () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "invalid";
    expect(getRetirementFloor()).toBe(DEFAULT_RETIREMENT_FLOOR);
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });

  test("uses default when env var is above 1", () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "1.1";
    expect(getRetirementFloor()).toBe(DEFAULT_RETIREMENT_FLOOR);
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });

  test("uses default when env var is negative", () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "-0.1";
    expect(getRetirementFloor()).toBe(DEFAULT_RETIREMENT_FLOOR);
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });

  test("accepts 0 as a valid floor", () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "0";
    expect(getRetirementFloor()).toBe(0);
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });

  test("accepts 1 as a valid floor", () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "1";
    expect(getRetirementFloor()).toBe(1);
    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
  });
});

// ---------------------------------------------------------------------------
// getMinMemberCount — env var parsing
// ---------------------------------------------------------------------------

describe("getMinMemberCount", () => {
  beforeEach(() => {
    delete process.env[MIN_MEMBER_COUNT_ENV_VAR];
  });

  test("returns DEFAULT_MIN_MEMBER_COUNT when env var is absent", () => {
    expect(getMinMemberCount()).toBe(DEFAULT_MIN_MEMBER_COUNT);
  });

  test("parses a valid integer from env var", () => {
    process.env[MIN_MEMBER_COUNT_ENV_VAR] = "5";
    expect(getMinMemberCount()).toBe(5);
    delete process.env[MIN_MEMBER_COUNT_ENV_VAR];
  });

  test("uses default when env var is non-numeric", () => {
    process.env[MIN_MEMBER_COUNT_ENV_VAR] = "banana";
    expect(getMinMemberCount()).toBe(DEFAULT_MIN_MEMBER_COUNT);
    delete process.env[MIN_MEMBER_COUNT_ENV_VAR];
  });

  test("uses default when env var is zero", () => {
    process.env[MIN_MEMBER_COUNT_ENV_VAR] = "0";
    expect(getMinMemberCount()).toBe(DEFAULT_MIN_MEMBER_COUNT);
    delete process.env[MIN_MEMBER_COUNT_ENV_VAR];
  });

  test("uses default when env var is negative", () => {
    process.env[MIN_MEMBER_COUNT_ENV_VAR] = "-2";
    expect(getMinMemberCount()).toBe(DEFAULT_MIN_MEMBER_COUNT);
    delete process.env[MIN_MEMBER_COUNT_ENV_VAR];
  });
});

// ---------------------------------------------------------------------------
// applyRetirementPolicy — integration over mock store
// ---------------------------------------------------------------------------

describe("applyRetirementPolicy", () => {
  const REPO = "xbmc/xbmc";
  const OPTS = { floor: 0.3, minMemberCount: 3 };

  test("retires rules below the signal floor", async () => {
    const active = [
      makeActiveRecord({ id: 1, signalScore: 0.1, memberCount: 5 }),
      makeActiveRecord({ id: 2, title: "Also decayed", signalScore: 0.2, memberCount: 8 }),
    ];
    const store = makeMockStore({ listRulesForRepo: mock(async () => active) });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(2);
    expect(result.kept).toBe(0);
    expect(result.retirementFailures).toBe(0);
    expect(result.retiredRules.length).toBe(2);
    expect(result.activeEvaluated).toBe(2);
    expect(result.floor).toBe(0.3);
    expect(result.minMemberCount).toBe(3);
    expect(result.repo).toBe(REPO);
  });

  test("retires rules with member-decay below minMemberCount", async () => {
    const active = [makeActiveRecord({ id: 1, signalScore: 0.9, memberCount: 1 })];
    const store = makeMockStore({ listRulesForRepo: mock(async () => active) });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(1);
    expect(result.kept).toBe(0);
  });

  test("keeps healthy rules that pass both criteria", async () => {
    const active = [
      makeActiveRecord({ id: 1, signalScore: 0.9, memberCount: 6 }),
      makeActiveRecord({ id: 2, title: "Also healthy", signalScore: 0.5, memberCount: 4 }),
    ];
    const store = makeMockStore({ listRulesForRepo: mock(async () => active) });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(0);
    expect(result.kept).toBe(2);
    expect(result.retirementFailures).toBe(0);
    expect(result.retiredRules).toEqual([]);
  });

  test("mixed: retires decayed, keeps healthy", async () => {
    const active = [
      makeActiveRecord({ id: 1, signalScore: 0.9, memberCount: 6 }),   // keeps
      makeActiveRecord({ id: 2, title: "Decayed", signalScore: 0.1, memberCount: 5 }), // retires (below-floor)
      makeActiveRecord({ id: 3, title: "Low count", signalScore: 0.7, memberCount: 1 }), // retires (member-decay)
    ];
    const store = makeMockStore({ listRulesForRepo: mock(async () => active) });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(2);
    expect(result.kept).toBe(1);
    expect(result.retiredRules.map((r) => r.id).sort()).toEqual([2, 3].sort());
  });

  test("returns empty result when no active rules exist", async () => {
    const store = makeMockStore({ listRulesForRepo: mock(async () => []) });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(0);
    expect(result.kept).toBe(0);
    expect(result.activeEvaluated).toBe(0);
    expect(result.retiredRules).toEqual([]);
  });

  test("counts retirement failures without throwing (fail-open)", async () => {
    const active = [
      makeActiveRecord({ id: 1, signalScore: 0.1, memberCount: 5 }),
      makeActiveRecord({ id: 2, title: "Second", signalScore: 0.05, memberCount: 5 }),
    ];
    let callCount = 0;
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        callCount++;
        if (callCount === 1) throw new Error("DB timeout");
        return makeRetiredRecord(id);
      }),
    });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(1);
    expect(result.retirementFailures).toBe(1);
    expect(result.retiredRules.length).toBe(1);
    expect(result.retiredRules[0]!.id).toBe(2);
  });

  test("counts null return from retireRule as a retirement failure", async () => {
    const active = [makeActiveRecord({ id: 1, signalScore: 0.1, memberCount: 5 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (_id: number): Promise<GeneratedRuleRecord | null> => null),
    });

    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, ...OPTS });

    expect(result.retired).toBe(0);
    expect(result.retirementFailures).toBe(1);
    expect(result.retiredRules).toEqual([]);
  });

  test("uses explicit floor and minMemberCount, not env vars, when provided", async () => {
    process.env[RETIREMENT_FLOOR_ENV_VAR] = "0.01"; // would retire almost nothing
    process.env[MIN_MEMBER_COUNT_ENV_VAR] = "1";    // would keep most
    const active = [makeActiveRecord({ id: 1, signalScore: 0.2, memberCount: 5 })]; // passes 0.01 but not 0.3
    const store = makeMockStore({ listRulesForRepo: mock(async () => active) });

    const result = await applyRetirementPolicy({
      store,
      logger: silentLogger,
      repo: REPO,
      floor: 0.3,           // explicit — should override env
      minMemberCount: 3,    // explicit — should override env
    });

    delete process.env[RETIREMENT_FLOOR_ENV_VAR];
    delete process.env[MIN_MEMBER_COUNT_ENV_VAR];
    expect(result.retired).toBe(1); // 0.2 < 0.3 floor → retired
    expect(result.kept).toBe(0);
  });

  test("result includes durationMs ≥ 0", async () => {
    const store = makeMockStore({ listRulesForRepo: mock(async () => []) });
    const result = await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("respects limit option when listing active rules", async () => {
    const capturedOpts: unknown[] = [];
    const store = makeMockStore({
      listRulesForRepo: mock(async (_repo: string, opts: unknown) => {
        capturedOpts.push(opts);
        return [];
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: REPO, limit: 7 });

    expect(capturedOpts[0]).toMatchObject({ status: "active", limit: 7 });
  });
});

// ---------------------------------------------------------------------------
// active → retired transition (store-call contract)
// ---------------------------------------------------------------------------

describe("active → retired transition contract", () => {
  test("retireRule is called with the correct rule ids", async () => {
    const retireCalls: number[] = [];
    const active = [
      makeActiveRecord({ id: 10, signalScore: 0.1, memberCount: 5 }),
      makeActiveRecord({ id: 11, title: "Second", signalScore: 0.05, memberCount: 5 }),
    ];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        retireCalls.push(id);
        return makeRetiredRecord(id);
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", floor: 0.3, minMemberCount: 3 });

    expect(retireCalls).toEqual([10, 11]);
  });

  test("retireRule is not called for healthy rules", async () => {
    const retireCalls: number[] = [];
    const active = [makeActiveRecord({ id: 99, signalScore: 0.9, memberCount: 10 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        retireCalls.push(id);
        return makeRetiredRecord(id);
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", floor: 0.3, minMemberCount: 3 });

    expect(retireCalls).toEqual([]);
  });

  test("boundary: rule exactly at floor is not retired", async () => {
    const retireCalls: number[] = [];
    const active = [makeActiveRecord({ id: 50, signalScore: 0.3, memberCount: 5 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        retireCalls.push(id);
        return makeRetiredRecord(id);
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", floor: 0.3, minMemberCount: 3 });

    expect(retireCalls).toEqual([]);
  });

  test("boundary: rule just below floor is retired", async () => {
    const retireCalls: number[] = [];
    const active = [makeActiveRecord({ id: 51, signalScore: 0.299, memberCount: 5 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        retireCalls.push(id);
        return makeRetiredRecord(id);
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", floor: 0.3, minMemberCount: 3 });

    expect(retireCalls).toEqual([51]);
  });

  test("boundary: rule exactly at minMemberCount is not retired", async () => {
    const retireCalls: number[] = [];
    const active = [makeActiveRecord({ id: 60, signalScore: 0.9, memberCount: 3 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        retireCalls.push(id);
        return makeRetiredRecord(id);
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", floor: 0.3, minMemberCount: 3 });

    expect(retireCalls).toEqual([]);
  });

  test("boundary: rule just below minMemberCount is retired", async () => {
    const retireCalls: number[] = [];
    const active = [makeActiveRecord({ id: 61, signalScore: 0.9, memberCount: 2 })];
    const store = makeMockStore({
      listRulesForRepo: mock(async () => active),
      retireRule: mock(async (id: number) => {
        retireCalls.push(id);
        return makeRetiredRecord(id);
      }),
    });

    await applyRetirementPolicy({ store, logger: silentLogger, repo: "xbmc/xbmc", floor: 0.3, minMemberCount: 3 });

    expect(retireCalls).toEqual([61]);
  });
});
