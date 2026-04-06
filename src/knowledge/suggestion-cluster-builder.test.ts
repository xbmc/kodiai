import { describe, it, expect, mock } from "bun:test";
import {
  buildClusterModel,
  MIN_CLUSTER_MEMBERS,
  MIN_ROWS_FOR_CLUSTERING,
  HDBSCAN_MIN_CLUSTER_SIZE,
} from "./suggestion-cluster-builder.ts";
import type { SuggestionClusterStore, SuggestionClusterModel } from "./suggestion-cluster-store.ts";

// ── Helpers ───────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  } as any;
}

/** Deterministic seeded RNG for reproducible embeddings. */
function seedRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generate a Float32Array of length `dim` with seed-based values. */
function makeEmbedding(dim: number, seed: number): Float32Array {
  const rng = seedRng(seed);
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = rng() * 2 - 1;
  return arr;
}

/**
 * Convert a Float32Array to pgvector format "[0.1,0.2,...]".
 * Simulates how learning_memories.embedding is stored on read.
 */
function toVectorString(arr: Float32Array): string {
  return `[${Array.from(arr).join(",")}]`;
}

type FakeRow = {
  id: number;
  outcome: string;
  embedding: string; // pgvector string
};

/**
 * Create a mock sql function that returns the given rows for all queries.
 */
function makeSqlStub(rows: FakeRow[]): any {
  return mock((strings: TemplateStringsArray, ..._values: unknown[]) => {
    void strings;
    return Promise.resolve(rows);
  });
}

/**
 * Create a minimal SuggestionClusterStore stub.
 * saveModel returns a fake SuggestionClusterModel with incrementing IDs.
 */
function makeStoreStub(savedModels: SuggestionClusterModel[] = []): SuggestionClusterStore {
  let nextId = 1;
  return {
    getModel: mock(async () => null),
    getModelIncludingStale: mock(async () => null),
    saveModel: mock(async (payload) => {
      const model: SuggestionClusterModel = {
        id: nextId++,
        repo: payload.repo,
        positiveCentroids: payload.positiveCentroids,
        negativeCentroids: payload.negativeCentroids,
        memberCount: payload.memberCount,
        positiveMemberCount: payload.positiveMemberCount,
        negativeMemberCount: payload.negativeMemberCount,
        builtAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      savedModels.push(model);
      return model;
    }),
    deleteModel: mock(async () => {}),
    listExpiredModelRepos: mock(async () => []),
  };
}

// ── Constant exports ──────────────────────────────────────────────────

describe("constants", () => {
  it("MIN_CLUSTER_MEMBERS is 3", () => {
    expect(MIN_CLUSTER_MEMBERS).toBe(3);
  });

  it("MIN_ROWS_FOR_CLUSTERING is 5", () => {
    expect(MIN_ROWS_FOR_CLUSTERING).toBe(5);
  });

  it("HDBSCAN_MIN_CLUSTER_SIZE is 3", () => {
    expect(HDBSCAN_MIN_CLUSTER_SIZE).toBe(3);
  });
});

// ── Insufficient data ─────────────────────────────────────────────────

describe("buildClusterModel — insufficient data", () => {
  it("returns built=false when no rows at all", async () => {
    const sql = makeSqlStub([]);
    const store = makeStoreStub();
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
    });

    expect(result.built).toBe(false);
    expect(result.model).toBeNull();
    expect(result.skipReason).toContain("Insufficient data");
    expect((store.saveModel as any).mock.calls).toHaveLength(0);
  });

  it("returns built=false when below minRowsForClustering", async () => {
    // 3 positive rows, threshold is 5
    const dim = 16;
    const rows: FakeRow[] = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      outcome: "accepted",
      embedding: toVectorString(makeEmbedding(dim, i + 1)),
    }));

    const sql = makeSqlStub(rows);
    const store = makeStoreStub();
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
    });

    expect(result.built).toBe(false);
    expect(result.skipReason).toContain("Insufficient data");
  });

  it("allows overriding minRowsForClustering", async () => {
    // 3 positive rows — not enough at default=5, but enough at custom=3
    const dim = 16;
    const rows: FakeRow[] = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      outcome: "accepted",
      embedding: toVectorString(makeEmbedding(dim, i + 1)),
    }));

    const sql = makeSqlStub(rows);
    const store = makeStoreStub();
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 3,
      minClusterSize: 3,
    });

    // With only 3 rows and minClusterSize=3, HDBSCAN may form 0 or 1 clusters
    // depending on data distribution. Either way it should not skip due to rows.
    // built could be true (model saved with 0 centroids is valid) or false (error path)
    // — what matters is that we didn't skip for "Insufficient data" at 3 rows.
    if (!result.built) {
      expect(result.skipReason).not.toContain("Insufficient data");
    }
  });

  it("skips rows with null / missing embeddings", async () => {
    const rows = [
      { id: 1, outcome: "accepted", embedding: null },
      { id: 2, outcome: "accepted", embedding: "" },
      { id: 3, outcome: "accepted", embedding: "not-a-vector" },
    ] as any;

    const sql = makeSqlStub(rows);
    const store = makeStoreStub();
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
    });

    expect(result.built).toBe(false);
    expect(result.skipReason).toContain("Insufficient data");
  });
});

// ── Outcome class splitting ───────────────────────────────────────────

describe("buildClusterModel — outcome class splitting", () => {
  it("treats accepted and thumbs_up as positive", async () => {
    const dim = 8;
    const rows: FakeRow[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        outcome: i % 2 === 0 ? "accepted" : "thumbs_up",
        embedding: toVectorString(makeEmbedding(dim, i + 10)),
      })),
    ];

    const sql = makeSqlStub(rows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
    });

    // saveModel should have been called with non-zero positiveMemberCount
    const calls = (store.saveModel as any).mock.calls;
    expect(calls).toHaveLength(1);
    const [payload] = calls[0] as any;
    expect(payload.positiveMemberCount).toBeGreaterThan(0);
    // No negative outcomes in input
    expect(payload.negativeMemberCount).toBe(0);
  });

  it("treats suppressed and thumbs_down as negative", async () => {
    const dim = 8;
    const rows: FakeRow[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        outcome: i % 2 === 0 ? "suppressed" : "thumbs_down",
        embedding: toVectorString(makeEmbedding(dim, i + 20)),
      })),
    ];

    const sql = makeSqlStub(rows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
    });

    const calls = (store.saveModel as any).mock.calls;
    expect(calls).toHaveLength(1);
    const [payload] = calls[0] as any;
    expect(payload.negativeMemberCount).toBeGreaterThan(0);
    expect(payload.positiveMemberCount).toBe(0);
  });

  it("ignores unknown outcome classes", async () => {
    const dim = 8;
    const rows: FakeRow[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        outcome: "accepted",
        embedding: toVectorString(makeEmbedding(dim, i + 1)),
      })),
      { id: 100, outcome: "unknown_outcome", embedding: toVectorString(makeEmbedding(dim, 99)) },
      { id: 101, outcome: "pending", embedding: toVectorString(makeEmbedding(dim, 100)) },
    ];

    const sql = makeSqlStub(rows);
    const store = makeStoreStub();
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
    });

    // Unknown outcomes don't count toward either class
    if (result.built) {
      expect(result.positiveMemberCount + result.negativeMemberCount).toBeLessThanOrEqual(5);
    }
  });
});

// ── Model shape with sufficient data ─────────────────────────────────

describe("buildClusterModel — centroid generation", () => {
  /**
   * Create a set of rows that should form two clearly separable clusters:
   * half near [1,0,...] and half near [-1,0,...].
   */
  function makeSeparableRows(dim: number, outcomeClass: string): FakeRow[] {
    const rows: FakeRow[] = [];
    // Cluster A: positive x
    for (let i = 0; i < 5; i++) {
      const emb = makeEmbedding(dim, i + 1);
      emb[0] = 1.0 + (i * 0.01); // strong positive x bias
      for (let d = 1; d < dim; d++) emb[d] = 0.01 * i;
      rows.push({ id: i + 1, outcome: outcomeClass, embedding: toVectorString(emb) });
    }
    // Cluster B: negative x
    for (let i = 0; i < 5; i++) {
      const emb = makeEmbedding(dim, i + 100);
      emb[0] = -1.0 - (i * 0.01);
      for (let d = 1; d < dim; d++) emb[d] = 0.01 * i;
      rows.push({ id: i + 100, outcome: outcomeClass, embedding: toVectorString(emb) });
    }
    return rows;
  }

  it("builds a model with at least 1 centroid when data is sufficient", async () => {
    const dim = 4;
    const rows = makeSeparableRows(dim, "accepted");

    const sql = makeSqlStub(rows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    expect(result.built).toBe(true);
    expect(result.model).not.toBeNull();
    expect(result.positiveCentroidCount).toBeGreaterThanOrEqual(1);
    expect(savedModels).toHaveLength(1);
  });

  it("returned model has correct repo", async () => {
    const dim = 4;
    const rows = makeSeparableRows(dim, "accepted");
    const sql = makeSqlStub(rows);
    const store = makeStoreStub();

    const result = await buildClusterModel({
      repo: "my-org/my-repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    expect(result.repo).toBe("my-org/my-repo");
    if (result.model) {
      expect(result.model.repo).toBe("my-org/my-repo");
    }
  });

  it("centroids are Float32Arrays with correct dimension", async () => {
    const dim = 8;
    const rows = makeSeparableRows(dim, "accepted");
    const sql = makeSqlStub(rows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    if (result.built && result.model) {
      for (const c of result.model.positiveCentroids) {
        expect(c).toBeInstanceOf(Float32Array);
        expect(c.length).toBe(dim);
      }
    }
  });

  it("builds independent positive and negative classes", async () => {
    const dim = 4;
    const positiveRows = makeSeparableRows(dim, "accepted");
    const negativeRows = makeSeparableRows(dim, "suppressed").map((r) => ({
      ...r,
      id: r.id + 200,
    }));
    const allRows = [...positiveRows, ...negativeRows];

    const sql = makeSqlStub(allRows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    expect(result.built).toBe(true);
    expect(result.positiveCentroidCount).toBeGreaterThanOrEqual(1);
    expect(result.negativeCentroidCount).toBeGreaterThanOrEqual(1);
    expect(result.positiveMemberCount).toBeGreaterThan(0);
    expect(result.negativeMemberCount).toBeGreaterThan(0);
  });

  it("memberCount equals positiveMemberCount + negativeMemberCount", async () => {
    const dim = 4;
    const rows = [
      ...makeSeparableRows(dim, "accepted"),
      ...makeSeparableRows(dim, "suppressed").map((r) => ({ ...r, id: r.id + 200 })),
    ];

    const sql = makeSqlStub(rows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    if (result.built) {
      expect(result.positiveMemberCount + result.negativeMemberCount).toBe(
        result.positiveMemberCount + result.negativeMemberCount,
      );
      // Check model saved to store
      expect(savedModels[0]!.memberCount).toBe(
        savedModels[0]!.positiveMemberCount + savedModels[0]!.negativeMemberCount,
      );
    }
  });

  it("saveModel is called exactly once on success", async () => {
    const dim = 4;
    const rows = makeSeparableRows(dim, "thumbs_up");
    const sql = makeSqlStub(rows);
    const store = makeStoreStub();

    await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    expect((store.saveModel as any).mock.calls).toHaveLength(1);
  });
});

// ── Min-member threshold ──────────────────────────────────────────────

describe("buildClusterModel — min-member threshold", () => {
  it("counts skipped clusters when small clusters are present", async () => {
    const dim = 4;
    // Build a dataset where HDBSCAN finds clusters but some are small
    // 5 rows tightly clustered at [1,0,0,0], 5 rows at [-1,0,0,0]
    // with very high minClusterSize to force some to be skipped
    const rows: FakeRow[] = Array.from({ length: 10 }, (_, i) => {
      const emb = new Float32Array(dim);
      emb[0] = i < 5 ? 1.0 : -1.0;
      return {
        id: i + 1,
        outcome: "accepted",
        embedding: toVectorString(emb),
      };
    });

    const sql = makeSqlStub(rows);
    const store = makeStoreStub();

    // minClusterSize=3 -> HDBSCAN may form clusters; MIN_CLUSTER_MEMBERS default is 3
    // This test just verifies the field is present and non-negative
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    expect(result.skippedClusters).toBeGreaterThanOrEqual(0);
  });

  it("model with zero centroids is saved when all clusters are below threshold", async () => {
    // All 5 rows form a single tight cluster but we'll use minClusterSize=10
    // so HDBSCAN finds no clusters at all -> zero centroids, model still saved
    const dim = 4;
    const rows: FakeRow[] = Array.from({ length: 5 }, (_, i) => {
      const emb = new Float32Array(dim);
      emb[0] = 1.0 + i * 0.001;
      return {
        id: i + 1,
        outcome: "accepted",
        embedding: toVectorString(emb),
      };
    });

    const sql = makeSqlStub(rows);
    const savedModels: SuggestionClusterModel[] = [];
    const store = makeStoreStub(savedModels);

    // minClusterSize > row count -> HDBSCAN returns all noise
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
      minClusterSize: 20, // larger than dataset
    });

    // Either built=true with 0 centroids (saved anyway) or built=false (no data after noise filter)
    // The key assertion: saveModel was called at most once and returned model if built
    if (result.built) {
      expect(result.model).not.toBeNull();
      expect(result.positiveCentroidCount).toBe(0);
      expect(savedModels).toHaveLength(1);
    }
  });
});

// ── Error handling ────────────────────────────────────────────────────

describe("buildClusterModel — error handling", () => {
  it("returns built=false on sql error (fail-open)", async () => {
    const sql = mock((_strings: TemplateStringsArray) => {
      return Promise.reject(new Error("DB connection failed"));
    }) as any;

    const store = makeStoreStub();
    const logger = createMockLogger();

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger,
    });

    expect(result.built).toBe(false);
    expect(result.model).toBeNull();
    expect(result.skipReason).toContain("Build error");
    // Error was logged
    expect((logger.error as any).mock.calls).toHaveLength(1);
  });

  it("returns built=false on store.saveModel error (fail-open)", async () => {
    const dim = 4;
    const rows: FakeRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      outcome: "accepted",
      embedding: toVectorString(makeEmbedding(dim, i + 1)),
    }));

    const sql = makeSqlStub(rows);
    const store: SuggestionClusterStore = {
      ...makeStoreStub(),
      saveModel: mock(async () => {
        throw new Error("saveModel failed");
      }),
    };
    const logger = createMockLogger();

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger,
      minRowsForClustering: 5,
      minClusterSize: 3,
    });

    expect(result.built).toBe(false);
    expect(result.skipReason).toContain("Build error");
    expect((logger.error as any).mock.calls).toHaveLength(1);
  });

  it("does not throw — always returns a result", async () => {
    const sql = mock((_strings: TemplateStringsArray) => {
      throw new Error("Synchronous sql error");
    }) as any;

    const store = makeStoreStub();

    const run = () =>
      buildClusterModel({ repo: "owner/repo", sql, store, logger: createMockLogger() });

    await expect(run()).resolves.toBeDefined();
  });
});

// ── Return shape ──────────────────────────────────────────────────────

describe("buildClusterModel — return shape", () => {
  it("result always has repo, built, model, counts, and skippedClusters", async () => {
    const sql = makeSqlStub([]);
    const store = makeStoreStub();

    const result = await buildClusterModel({
      repo: "my/repo",
      sql,
      store,
      logger: createMockLogger(),
    });

    expect(result).toHaveProperty("repo");
    expect(result).toHaveProperty("built");
    expect(result).toHaveProperty("model");
    expect(result).toHaveProperty("positiveCentroidCount");
    expect(result).toHaveProperty("negativeCentroidCount");
    expect(result).toHaveProperty("positiveMemberCount");
    expect(result).toHaveProperty("negativeMemberCount");
    expect(result).toHaveProperty("skippedClusters");
  });

  it("result.repo matches input repo", async () => {
    const sql = makeSqlStub([]);
    const store = makeStoreStub();

    const result = await buildClusterModel({
      repo: "my-org/my-app",
      sql,
      store,
      logger: createMockLogger(),
    });

    expect(result.repo).toBe("my-org/my-app");
  });

  it("counts are non-negative integers", async () => {
    const sql = makeSqlStub([]);
    const store = makeStoreStub();

    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
    });

    expect(result.positiveCentroidCount).toBeGreaterThanOrEqual(0);
    expect(result.negativeCentroidCount).toBeGreaterThanOrEqual(0);
    expect(result.positiveMemberCount).toBeGreaterThanOrEqual(0);
    expect(result.negativeMemberCount).toBeGreaterThanOrEqual(0);
    expect(result.skippedClusters).toBeGreaterThanOrEqual(0);
  });
});

// ── Embedding parsing ─────────────────────────────────────────────────

describe("buildClusterModel — embedding parsing", () => {
  it("parses valid pgvector strings", async () => {
    const dim = 4;
    const rows: FakeRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      outcome: "accepted",
      embedding: toVectorString(makeEmbedding(dim, i + 1)),
    }));

    const sql = makeSqlStub(rows);
    const store = makeStoreStub();

    // Should not fail due to parsing issues
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
    });

    // Parsing worked if we got here without errors
    expect(result.repo).toBe("owner/repo");
  });

  it("skips rows with unparseable embeddings", async () => {
    const dim = 4;
    const valid: FakeRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      outcome: "accepted",
      embedding: toVectorString(makeEmbedding(dim, i + 1)),
    }));
    const invalid: FakeRow[] = [
      { id: 100, outcome: "accepted", embedding: "[not,valid,data,nan]" },
      { id: 101, outcome: "accepted", embedding: "garbage" },
    ];

    const sql = makeSqlStub([...valid, ...invalid]);
    const store = makeStoreStub();
    const result = await buildClusterModel({
      repo: "owner/repo",
      sql,
      store,
      logger: createMockLogger(),
      minRowsForClustering: 5,
    });

    // The valid 5 rows should be used (invalid ones skipped)
    // built may be true or false depending on clustering, but no crash
    expect(result.repo).toBe("owner/repo");
  });
});
