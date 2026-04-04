import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createGeneratedRuleStore } from "./generated-rule-store.ts";
import { createDbClient, type Sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import type { GeneratedRuleStore, GeneratedRuleProposal } from "./generated-rule-store.ts";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as import("pino").Logger;

function makeEmbedding(seed: number = 42): Float32Array {
  const arr = new Float32Array(1024);
  let val = seed;
  for (let i = 0; i < 1024; i++) {
    val = ((val * 1664525 + 1013904223) & 0xffffffff) >>> 0;
    arr[i] = (val / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < 1024; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1024; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function makeProposal(overrides: Partial<GeneratedRuleProposal> = {}): GeneratedRuleProposal {
  return {
    repo: "xbmc/xbmc",
    title: "Prefer null guards before dereference",
    ruleText: "Add an explicit null guard before dereferencing optional pointers.",
    signalScore: 0.82,
    memberCount: 6,
    clusterCentroid: makeEmbedding(1),
    ...overrides,
  };
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)("GeneratedRuleStore", () => {
  let sql: Sql;
  let store: GeneratedRuleStore;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    const client = createDbClient({
      connectionString: TEST_DB_URL!,
      logger: mockLogger,
    });
    sql = client.sql;
    closeDb = client.close;
    await runMigrations(sql);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await sql`DELETE FROM generated_rules`;
    store = createGeneratedRuleStore({ sql, logger: mockLogger });
  });

  test("savePendingRule persists a pending generated rule", async () => {
    const saved = await store.savePendingRule(makeProposal());

    expect(saved.id).toBeGreaterThan(0);
    expect(saved.status).toBe("pending");
    expect(saved.origin).toBe("generated");
    expect(saved.signalScore).toBe(0.82);
    expect(saved.memberCount).toBe(6);
    expect(saved.clusterCentroid).toBeInstanceOf(Float32Array);
    expect(saved.clusterCentroid.length).toBe(1024);
    expect(saved.activatedAt).toBeNull();
    expect(saved.retiredAt).toBeNull();

    const rows = await sql`SELECT repo, title, status, origin FROM generated_rules`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.repo).toBe("xbmc/xbmc");
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.origin).toBe("generated");
  });

  test("savePendingRule upserts by repo and title without duplicating rows", async () => {
    await store.savePendingRule(makeProposal({ signalScore: 0.61, memberCount: 5 }));
    const updated = await store.savePendingRule(makeProposal({ signalScore: 0.93, memberCount: 9 }));

    const rows = await sql`SELECT COUNT(*)::int AS cnt FROM generated_rules WHERE repo = 'xbmc/xbmc'`;
    expect(rows[0]!.cnt).toBe(1);
    expect(updated.status).toBe("pending");
    expect(updated.signalScore).toBe(0.93);
    expect(updated.memberCount).toBe(9);
  });

  test("savePendingRule preserves active lifecycle state on reproposal", async () => {
    const created = await store.savePendingRule(makeProposal());
    const activated = await store.activateRule(created.id);
    expect(activated).not.toBeNull();
    expect(activated!.status).toBe("active");

    const reproposed = await store.savePendingRule(makeProposal({ signalScore: 0.95, memberCount: 10 }));
    expect(reproposed.status).toBe("active");
    expect(reproposed.signalScore).toBe(0.95);
    expect(reproposed.memberCount).toBe(10);
    expect(reproposed.activatedAt).not.toBeNull();
  });

  test("activateRule transitions pending rule to active", async () => {
    const created = await store.savePendingRule(makeProposal());

    const activated = await store.activateRule(created.id);

    expect(activated).not.toBeNull();
    expect(activated!.status).toBe("active");
    expect(activated!.activatedAt).not.toBeNull();
    expect(activated!.retiredAt).toBeNull();

    const activeRules = await store.getActiveRulesForRepo("xbmc/xbmc");
    expect(activeRules.length).toBe(1);
    expect(activeRules[0]!.id).toBe(created.id);
  });

  test("retireRule transitions rule to retired and removes it from active list", async () => {
    const created = await store.savePendingRule(makeProposal());
    await store.activateRule(created.id);

    const retired = await store.retireRule(created.id);

    expect(retired).not.toBeNull();
    expect(retired!.status).toBe("retired");
    expect(retired!.retiredAt).not.toBeNull();
    expect(retired!.activatedAt).not.toBeNull();

    const activeRules = await store.getActiveRulesForRepo("xbmc/xbmc");
    expect(activeRules).toEqual([]);
  });

  test("listRulesForRepo and getLifecycleCounts expose lifecycle surfaces", async () => {
    const pending = await store.savePendingRule(makeProposal({ title: "Pending rule" }));
    const active = await store.savePendingRule(makeProposal({ title: "Active rule", signalScore: 0.9 }));
    const retired = await store.savePendingRule(makeProposal({ title: "Retired rule", signalScore: 0.4 }));

    await store.activateRule(active.id);
    await store.activateRule(retired.id);
    await store.retireRule(retired.id);

    const allRules = await store.listRulesForRepo("xbmc/xbmc");
    const counts = await store.getLifecycleCounts("xbmc/xbmc");

    expect(allRules.length).toBe(3);
    expect(allRules.map((rule) => rule.id)).toContain(pending.id);
    expect(counts).toEqual({
      pending: 1,
      active: 1,
      retired: 1,
      total: 3,
    });
  });

  test("getRule returns null for unknown id", async () => {
    const result = await store.getRule(999999);
    expect(result).toBeNull();
  });
});
