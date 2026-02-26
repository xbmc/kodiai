import { describe, it, expect, mock, beforeEach } from "bun:test";
import { runClusterPipeline, cosineSimilarity } from "./cluster-pipeline.ts";
import type { ClusterStore, ReviewCluster, ClusterAssignment, ClusterRunState } from "./cluster-types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function createMockTaskRouter() {
  return {
    resolve: mock(() => ({
      modelId: "claude-haiku-4-5-20250929",
      provider: "anthropic",
      sdk: "ai" as const,
      fallbackModelId: "claude-sonnet-4-5-20250929",
      fallbackProvider: "anthropic",
    })),
  };
}

/** Generate a random Float32Array embedding of given dimension. */
function randomEmbedding(dim: number, seed: number): Float32Array {
  let s = seed;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = rng() * 2 - 1;
  return arr;
}

/** Convert Float32Array to pgvector string format. */
function toVectorString(arr: Float32Array): string {
  return `[${Array.from(arr).join(",")}]`;
}

function createMockStore(overrides: Partial<ClusterStore> = {}): ClusterStore {
  return {
    upsertCluster: mock(async (c: any) => ({ ...c, id: 1, createdAt: new Date(), updatedAt: new Date() })),
    getActiveClusters: mock(async () => []),
    retireCluster: mock(async () => {}),
    updateClusterLabel: mock(async () => {}),
    pinClusterLabel: mock(async () => {}),
    writeAssignments: mock(async () => {}),
    clearAssignments: mock(async () => {}),
    getAssignmentsByCluster: mock(async () => []),
    getRunState: mock(async () => ({
      lastRunAt: null,
      clustersDiscovered: 0,
      commentsProcessed: 0,
      labelsGenerated: 0,
      status: "pending" as const,
      errorMessage: null,
    })),
    saveRunState: mock(async () => {}),
    ...overrides,
  };
}

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });
});

describe("runClusterPipeline", () => {
  it("completes with 0 clusters when no embeddings exist", async () => {
    const mockSql = mock((() => Promise.resolve([])) as any);
    const store = createMockStore();

    const result = await runClusterPipeline({
      sql: mockSql,
      store,
      taskRouter: createMockTaskRouter(),
      logger: createMockLogger(),
      repo: "test/repo",
    });

    expect(result.status).toBe("completed");
    expect(result.clustersDiscovered).toBe(0);
    expect(result.commentsProcessed).toBe(0);
  });

  it("completes with 0 clusters when below minClusterSize", async () => {
    // Only 2 embeddings, minClusterSize=3
    const emb1 = randomEmbedding(1024, 1);
    const emb2 = randomEmbedding(1024, 2);

    let callCount = 0;
    const mockSql = mock((() => {
      callCount++;
      if (callCount === 1) {
        // Embeddings query
        return Promise.resolve([
          { id: 1, embedding: toVectorString(emb1), file_path: "a.ts", chunk_text: "check null", github_created_at: "2026-02-01T00:00:00Z" },
          { id: 2, embedding: toVectorString(emb2), file_path: "b.ts", chunk_text: "missing check", github_created_at: "2026-02-02T00:00:00Z" },
        ]);
      }
      return Promise.resolve([]);
    }) as any);

    const store = createMockStore();

    const result = await runClusterPipeline({
      sql: mockSql,
      store,
      taskRouter: createMockTaskRouter(),
      logger: createMockLogger(),
      repo: "test/repo",
      minClusterSize: 3,
    });

    expect(result.status).toBe("completed");
    expect(result.commentsProcessed).toBe(2);
    expect(result.clustersDiscovered).toBe(0);
  });

  it("saves failed state on error", async () => {
    const mockSql = mock((() => {
      throw new Error("DB connection failed");
    }) as any);
    const store = createMockStore();

    const result = await runClusterPipeline({
      sql: mockSql,
      store,
      taskRouter: createMockTaskRouter(),
      logger: createMockLogger(),
      repo: "test/repo",
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("DB connection failed");
    // saveRunState should have been called with failed status
    expect(store.saveRunState).toHaveBeenCalled();
  });

  it("performs incremental merge when existing clusters exist", async () => {
    // Existing cluster with a centroid
    const existingCentroid = randomEmbedding(1024, 100);
    const existingCluster: ReviewCluster = {
      id: 1,
      repo: "test/repo",
      slug: "null-check-missing",
      label: "Missing null checks",
      centroid: existingCentroid,
      memberCount: 5,
      memberCountAtLabel: 5,
      filePaths: ["src/a.ts"],
      createdAt: new Date(),
      updatedAt: new Date(),
      labelUpdatedAt: new Date(),
      pinned: false,
      retired: false,
    };

    // New embeddings very similar to existing cluster centroid — need >= minClusterSize total
    const similarEmb1 = new Float32Array(existingCentroid);
    const similarEmb2 = new Float32Array(existingCentroid.length);
    const similarEmb3 = new Float32Array(existingCentroid.length);
    for (let i = 0; i < existingCentroid.length; i++) {
      similarEmb2[i] = existingCentroid[i]! + 0.001;
      similarEmb3[i] = existingCentroid[i]! - 0.001;
    }

    let callCount = 0;
    const mockSql = mock((() => {
      callCount++;
      if (callCount === 1) {
        // Embeddings query — 3 embeddings (>= minClusterSize)
        return Promise.resolve([
          { id: 10, embedding: toVectorString(similarEmb1), file_path: "src/a.ts", chunk_text: "add null check", github_created_at: "2026-02-01T00:00:00Z" },
          { id: 11, embedding: toVectorString(similarEmb2), file_path: "src/a.ts", chunk_text: "missing null", github_created_at: "2026-02-02T00:00:00Z" },
          { id: 12, embedding: toVectorString(similarEmb3), file_path: "src/a.ts", chunk_text: "null pointer", github_created_at: "2026-02-03T00:00:00Z" },
        ]);
      }
      // All other queries (retirement check etc)
      return Promise.resolve([{ cnt: 5 }]);
    }) as any);

    const store = createMockStore({
      getActiveClusters: mock(async () => [existingCluster]),
    });

    const result = await runClusterPipeline({
      sql: mockSql,
      store,
      taskRouter: createMockTaskRouter(),
      logger: createMockLogger(),
      repo: "test/repo",
    });

    expect(result.status).toBe("completed");
    // The similar embedding should have been merged into existing cluster
    expect(store.writeAssignments).toHaveBeenCalled();
    expect(store.upsertCluster).toHaveBeenCalled();
  });

  it("skips label regeneration for pinned clusters", async () => {
    const existingCluster: ReviewCluster = {
      id: 1,
      repo: "test/repo",
      slug: "pinned-pattern",
      label: "Pinned label",
      centroid: randomEmbedding(1024, 50),
      memberCount: 10,
      memberCountAtLabel: 5, // 100% change, but pinned
      filePaths: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      labelUpdatedAt: new Date(),
      pinned: true,
      retired: false,
    };

    let callCount = 0;
    const mockSql = mock((() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([]); // No embeddings
      return Promise.resolve([{ cnt: 10 }]);
    }) as any);

    const store = createMockStore({
      getActiveClusters: mock(async () => [existingCluster]),
    });

    await runClusterPipeline({
      sql: mockSql,
      store,
      taskRouter: createMockTaskRouter(),
      logger: createMockLogger(),
      repo: "test/repo",
    });

    // updateClusterLabel should NOT be called for pinned cluster
    expect(store.updateClusterLabel).not.toHaveBeenCalled();
  });
});
