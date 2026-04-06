/**
 * Tests for SuggestionClusterStore — cluster-model persistence and retrieval.
 *
 * Uses a sequential mock SQL stub (no real DB) for fast unit verification.
 * See generated-rule-store.test.ts for an integration pattern if live DB
 * coverage is ever needed.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  createSuggestionClusterStore,
  CLUSTER_MODEL_TTL_MS,
  type SuggestionClusterModel,
  type SuggestionClusterModelPayload,
} from "./suggestion-cluster-store.ts";

// ── Helpers ───────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  } as unknown as import("pino").Logger;
}

/** Build a deterministic normalized Float32Array (dim=4 for test brevity). */
function makeCentroid(seed: number, dim = 4): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = seed + i * 0.1;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) arr[i] = arr[i]! / norm;
  return arr;
}

const NOW_ISO = "2026-04-04T12:00:00.000Z";
const EXPIRES_ISO = new Date(new Date(NOW_ISO).getTime() + CLUSTER_MODEL_TTL_MS).toISOString();

/** Build a fake DB row that matches ModelRow shape. */
function makeModelRow(overrides: Partial<{
  repo: string;
  positive_centroids: unknown;
  negative_centroids: unknown;
  member_count: number;
  positive_member_count: number;
  negative_member_count: number;
  built_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}> = {}) {
  const pos = [[1, 0, 0, 0], [0, 1, 0, 0]];
  const neg = [[0, 0, 1, 0]];
  return {
    id: 1,
    repo: "xbmc/xbmc",
    positive_centroids: pos,
    negative_centroids: neg,
    member_count: 40,
    positive_member_count: 25,
    negative_member_count: 15,
    built_at: NOW_ISO,
    expires_at: EXPIRES_ISO,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

/** Create a sequential SQL mock. Each call pops the next response array. */
function makeSequentialSql(responses: unknown[][]) {
  const calls: { query: string; values: unknown[] }[] = [];
  let idx = 0;
  const sql = mock((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?"), values });
    const rows = responses[idx] ?? [];
    idx++;
    return Promise.resolve(rows);
  });
  return { sql: sql as unknown as import("../db/client.ts").Sql, calls };
}

/** Minimal payload for saveModel. */
function makePayload(overrides: Partial<SuggestionClusterModelPayload> = {}): SuggestionClusterModelPayload {
  return {
    repo: "xbmc/xbmc",
    positiveCentroids: [makeCentroid(1), makeCentroid(2)],
    negativeCentroids: [makeCentroid(3)],
    memberCount: 40,
    positiveMemberCount: 25,
    negativeMemberCount: 15,
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────

describe("createSuggestionClusterStore", () => {
  it("creates store with all required methods", () => {
    const { sql } = makeSequentialSql([]);
    const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

    expect(store.getModel).toBeDefined();
    expect(store.getModelIncludingStale).toBeDefined();
    expect(store.saveModel).toBeDefined();
    expect(store.deleteModel).toBeDefined();
    expect(store.listExpiredModelRepos).toBeDefined();
  });

  // ── getModel ────────────────────────────────────────────────────────

  describe("getModel", () => {
    it("returns null when no row is returned", async () => {
      const { sql } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      const result = await store.getModel("xbmc/xbmc");
      expect(result).toBeNull();
    });

    it("deserializes centroid arrays correctly", async () => {
      const row = makeModelRow();
      const { sql } = makeSequentialSql([[row]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      expect(model).not.toBeNull();
      expect(model!.repo).toBe("xbmc/xbmc");
      expect(model!.positiveCentroids).toHaveLength(2);
      expect(model!.negativeCentroids).toHaveLength(1);
      expect(model!.positiveCentroids[0]).toBeInstanceOf(Float32Array);
      expect(model!.negativeCentroids[0]).toBeInstanceOf(Float32Array);
    });

    it("maps numeric fields correctly", async () => {
      const row = makeModelRow({ member_count: 40, positive_member_count: 25, negative_member_count: 15 });
      const { sql } = makeSequentialSql([[row]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      expect(model!.memberCount).toBe(40);
      expect(model!.positiveMemberCount).toBe(25);
      expect(model!.negativeMemberCount).toBe(15);
    });

    it("preserves ISO timestamp strings", async () => {
      const row = makeModelRow({ built_at: NOW_ISO, expires_at: EXPIRES_ISO });
      const { sql } = makeSequentialSql([[row]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      expect(model!.builtAt).toBe(NOW_ISO);
      expect(model!.expiresAt).toBe(EXPIRES_ISO);
    });

    it("converts Date objects to ISO strings", async () => {
      const row = makeModelRow({
        built_at: new Date(NOW_ISO) as unknown as string,
        expires_at: new Date(EXPIRES_ISO) as unknown as string,
      });
      const { sql } = makeSequentialSql([[row]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      expect(typeof model!.builtAt).toBe("string");
      expect(typeof model!.expiresAt).toBe("string");
    });

    it("issues query with expires_at > now() filter (not stale)", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await store.getModel("xbmc/xbmc");
      expect(calls[0]!.query).toContain("expires_at");
      expect(calls[0]!.query).toContain("now()");
    });

    it("handles JSONB stored as string by JSON.parsing it", async () => {
      const pos = [[0.5, 0.5, 0.0, 0.0]];
      const neg = [[0.0, 0.0, 0.5, 0.5]];
      const row = makeModelRow({
        positive_centroids: JSON.stringify(pos),
        negative_centroids: JSON.stringify(neg),
      });
      const { sql } = makeSequentialSql([[row]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      expect(model!.positiveCentroids).toHaveLength(1);
      expect(model!.positiveCentroids[0]![0]).toBeCloseTo(0.5);
    });
  });

  // ── getModelIncludingStale ──────────────────────────────────────────

  describe("getModelIncludingStale", () => {
    it("returns null when no row exists", async () => {
      const { sql } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      expect(await store.getModelIncludingStale("repo/repo")).toBeNull();
    });

    it("issues query WITHOUT expires_at filter", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await store.getModelIncludingStale("xbmc/xbmc");
      // The query should not contain an expires_at WHERE clause
      expect(calls[0]!.query).not.toContain("expires_at");
    });

    it("returns stale model data correctly", async () => {
      const row = makeModelRow({ member_count: 7, positive_member_count: 4, negative_member_count: 3 });
      const { sql } = makeSequentialSql([[row]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModelIncludingStale("xbmc/xbmc");
      expect(model!.memberCount).toBe(7);
    });
  });

  // ── saveModel ──────────────────────────────────────────────────────

  describe("saveModel", () => {
    it("returns a model record on success", async () => {
      const returnedRow = makeModelRow();
      const { sql } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.saveModel(makePayload());
      expect(model).not.toBeNull();
      expect(model.repo).toBe("xbmc/xbmc");
      expect(model.memberCount).toBe(40);
    });

    it("serializes centroids to JSONB format in query", async () => {
      const returnedRow = makeModelRow();
      const { sql, calls } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      await store.saveModel(makePayload());
      const savedQuery = calls[0]!.query;
      // The SQL should have an INSERT INTO suggestion_cluster_models
      expect(savedQuery).toContain("suggestion_cluster_models");
      // Values should include serialized centroids
      const hasJsonbValue = calls[0]!.values.some(
        (v) => typeof v === "string" && v.startsWith("[["),
      );
      expect(hasJsonbValue).toBe(true);
    });

    it("uses ON CONFLICT (repo) DO UPDATE", async () => {
      const returnedRow = makeModelRow();
      const { sql, calls } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      await store.saveModel(makePayload());
      expect(calls[0]!.query).toContain("ON CONFLICT");
    });

    it("uses default TTL when expiresAt is not provided", async () => {
      const returnedRow = makeModelRow();
      const { sql, calls } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const before = Date.now();
      await store.saveModel(makePayload());
      const after = Date.now();

      const expiresAtValue = calls[0]!.values.find(
        (v) => typeof v === "string" && v.includes("T") && v.includes("Z"),
      ) as string | undefined;

      expect(expiresAtValue).toBeDefined();
      const expiresMs = new Date(expiresAtValue!).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + CLUSTER_MODEL_TTL_MS - 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + CLUSTER_MODEL_TTL_MS + 1000);
    });

    it("respects a custom expiresAt when provided", async () => {
      const returnedRow = makeModelRow();
      const { sql, calls } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const customExpiry = new Date("2030-01-01T00:00:00.000Z");
      await store.saveModel(makePayload({ expiresAt: customExpiry }));

      const expiresAtValue = calls[0]!.values.find(
        (v) => typeof v === "string" && v.includes("2030"),
      );
      expect(expiresAtValue).toBeDefined();
    });

    it("throws and logs on DB error", async () => {
      const logger = createMockLogger();
      const sql = mock((_strings: TemplateStringsArray, ..._values: unknown[]) => {
        return Promise.reject(new Error("DB connection refused"));
      }) as unknown as import("../db/client.ts").Sql;

      const store = createSuggestionClusterStore({ sql, logger });
      await expect(store.saveModel(makePayload())).rejects.toThrow("DB connection refused");
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("handles empty centroid arrays (no clusters built)", async () => {
      const returnedRow = makeModelRow({
        positive_centroids: [],
        negative_centroids: [],
        member_count: 0,
        positive_member_count: 0,
        negative_member_count: 0,
      });
      const { sql } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.saveModel(
        makePayload({ positiveCentroids: [], negativeCentroids: [], memberCount: 0, positiveMemberCount: 0, negativeMemberCount: 0 }),
      );
      expect(model.positiveCentroids).toHaveLength(0);
      expect(model.negativeCentroids).toHaveLength(0);
    });
  });

  // ── deleteModel ────────────────────────────────────────────────────

  describe("deleteModel", () => {
    it("issues DELETE query with repo filter", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      await store.deleteModel("xbmc/xbmc");
      expect(calls[0]!.query).toContain("DELETE");
      expect(calls[0]!.values).toContain("xbmc/xbmc");
    });

    it("does not throw when no row matches", async () => {
      const { sql } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await expect(store.deleteModel("nonexistent/repo")).resolves.toBeUndefined();
    });
  });

  // ── listExpiredModelRepos ──────────────────────────────────────────

  describe("listExpiredModelRepos", () => {
    it("returns empty array when no expired models", async () => {
      const { sql } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      const repos = await store.listExpiredModelRepos();
      expect(repos).toEqual([]);
    });

    it("returns repo names from expired rows", async () => {
      const { sql } = makeSequentialSql([[
        { repo: "org/repo-a" },
        { repo: "org/repo-b" },
      ]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      const repos = await store.listExpiredModelRepos();
      expect(repos).toEqual(["org/repo-a", "org/repo-b"]);
    });

    it("applies default limit of 50", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await store.listExpiredModelRepos();
      expect(calls[0]!.values).toContain(50);
    });

    it("respects a custom limit", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await store.listExpiredModelRepos(10);
      expect(calls[0]!.values).toContain(10);
    });

    it("clamps limit to minimum 1", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await store.listExpiredModelRepos(0);
      expect(calls[0]!.values).toContain(1);
    });

    it("filters by expires_at <= now()", async () => {
      const { sql, calls } = makeSequentialSql([[]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });
      await store.listExpiredModelRepos();
      expect(calls[0]!.query).toContain("expires_at");
      expect(calls[0]!.query).toContain("now()");
    });
  });

  // ── serializeCentroids round-trip ──────────────────────────────────

  describe("centroid serialization round-trip", () => {
    it("preserves Float32Array values through save→read cycle", async () => {
      const original = makeCentroid(7, 8);
      const returnedRow = makeModelRow({
        positive_centroids: [Array.from(original)],
        negative_centroids: [],
      });
      const { sql } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      const recovered = model!.positiveCentroids[0]!;
      expect(recovered).toBeInstanceOf(Float32Array);
      expect(recovered.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(recovered[i]).toBeCloseTo(original[i]!, 5);
      }
    });

    it("handles empty arrays in centroid slot", async () => {
      const returnedRow = makeModelRow({
        positive_centroids: [[], [0.1, 0.2]],
        negative_centroids: [],
      });
      const { sql } = makeSequentialSql([[returnedRow]]);
      const store = createSuggestionClusterStore({ sql, logger: createMockLogger() });

      const model = await store.getModel("xbmc/xbmc");
      expect(model!.positiveCentroids[0]!.length).toBe(0);
      expect(model!.positiveCentroids[1]!.length).toBe(2);
    });
  });
});

// ── CLUSTER_MODEL_TTL_MS export ────────────────────────────────────────

describe("CLUSTER_MODEL_TTL_MS", () => {
  it("equals 24 hours in milliseconds", () => {
    expect(CLUSTER_MODEL_TTL_MS).toBe(86_400_000);
  });
});
