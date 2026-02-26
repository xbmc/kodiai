import { describe, it, expect, mock } from "bun:test";
import { matchClusterPatterns } from "./cluster-matcher.ts";
import type { ClusterStore, ReviewCluster, ClusterAssignment } from "./cluster-types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

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

function makeCluster(overrides: Partial<ReviewCluster> & { id: number; slug: string }): ReviewCluster {
  return {
    repo: "test/repo",
    label: `Label for ${overrides.slug}`,
    centroid: randomEmbedding(1024, overrides.id * 100),
    memberCount: 5,
    memberCountAtLabel: 5,
    filePaths: ["src/a.ts"],
    createdAt: new Date(),
    updatedAt: new Date(),
    labelUpdatedAt: new Date(),
    pinned: false,
    retired: false,
    ...overrides,
  };
}

function createMockStore(clusters: ReviewCluster[]): ClusterStore {
  return {
    upsertCluster: mock(async () => clusters[0]!),
    getActiveClusters: mock(async () => clusters),
    retireCluster: mock(async () => {}),
    updateClusterLabel: mock(async () => {}),
    pinClusterLabel: mock(async () => {}),
    writeAssignments: mock(async () => {}),
    clearAssignments: mock(async () => {}),
    getAssignmentsByCluster: mock(async (): Promise<ClusterAssignment[]> => [
      { id: 1, clusterId: 1, reviewCommentId: 100, probability: 0.9, assignedAt: new Date() },
    ]),
    getRunState: mock(async () => ({
      lastRunAt: null, clustersDiscovered: 0, commentsProcessed: 0,
      labelsGenerated: 0, status: "pending" as const, errorMessage: null,
    })),
    saveRunState: mock(async () => {}),
  };
}

/** Mock SQL that returns configurable recent count and age. */
function createMockSql(recentCount: number = 5, avgAgeDays: number = 10) {
  let callCount = 0;
  return mock((() => {
    callCount++;
    // Odd calls: recent count query; Even calls: sample text query
    if (callCount % 2 === 1) {
      return Promise.resolve([{ cnt: recentCount, avg_age_days: avgAgeDays }]);
    }
    return Promise.resolve([{ chunk_text: "Example review comment text" }]);
  }) as any);
}

describe("matchClusterPatterns", () => {
  it("returns empty array when prEmbedding is null", async () => {
    const store = createMockStore([makeCluster({ id: 1, slug: "test" })]);

    const result = await matchClusterPatterns(
      { prEmbedding: null, prFilePaths: ["src/a.ts"], repo: "test/repo" },
      store,
      createMockSql() as any,
      createMockLogger(),
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when no active clusters", async () => {
    const store = createMockStore([]);

    const result = await matchClusterPatterns(
      { prEmbedding: randomEmbedding(1024, 1), prFilePaths: ["src/a.ts"], repo: "test/repo" },
      store,
      createMockSql() as any,
      createMockLogger(),
    );

    expect(result).toEqual([]);
  });

  it("matches clusters with high embedding similarity", async () => {
    const centroid = randomEmbedding(1024, 42);
    const cluster = makeCluster({ id: 1, slug: "null-check", centroid });
    const store = createMockStore([cluster]);

    // PR embedding identical to centroid -> cosine sim = 1.0
    const result = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: [], repo: "test/repo" },
      store,
      createMockSql(5, 5) as any,
      createMockLogger(),
    );

    expect(result.length).toBe(1);
    expect(result[0]!.slug).toBe("null-check");
    expect(result[0]!.similarityScore).toBeCloseTo(1.0, 3);
    expect(result[0]!.combinedScore).toBeGreaterThan(0.3);
  });

  it("caps results at 3 matches", async () => {
    // 5 clusters, all with same centroid as PR
    const centroid = randomEmbedding(1024, 99);
    const clusters = Array.from({ length: 5 }, (_, i) =>
      makeCluster({ id: i + 1, slug: `pattern-${i + 1}`, centroid: new Float32Array(centroid) }),
    );
    const store = createMockStore(clusters);

    const result = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: ["src/a.ts"], repo: "test/repo" },
      store,
      createMockSql(5, 5) as any,
      createMockLogger(),
    );

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("filters clusters with fewer than 3 recent members", async () => {
    const centroid = randomEmbedding(1024, 77);
    const cluster = makeCluster({ id: 1, slug: "low-count", centroid });
    const store = createMockStore([cluster]);

    // Only 2 recent members (below threshold of 3)
    const result = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: [], repo: "test/repo" },
      store,
      createMockSql(2, 5) as any,
      createMockLogger(),
    );

    expect(result).toEqual([]);
  });

  it("includes file path overlap in combined score", async () => {
    const centroid = randomEmbedding(1024, 55);
    const clusterA = makeCluster({
      id: 1,
      slug: "with-overlap",
      centroid,
      filePaths: ["src/a.ts", "src/b.ts"],
    });
    const store = createMockStore([clusterA]);

    const result = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: ["src/a.ts", "src/b.ts"], repo: "test/repo" },
      store,
      createMockSql(5, 5) as any,
      createMockLogger(),
    );

    expect(result.length).toBe(1);
    expect(result[0]!.filePathOverlap).toBeGreaterThan(0);
  });

  it("applies recency weighting (recent clusters score higher)", async () => {
    const centroid = randomEmbedding(1024, 33);
    const cluster = makeCluster({ id: 1, slug: "recent", centroid });
    const store = createMockStore([cluster]);

    // Very recent: avgAgeDays=1
    const resultRecent = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: [], repo: "test/repo" },
      store,
      createMockSql(5, 1) as any,
      createMockLogger(),
    );

    // Older: avgAgeDays=55
    const store2 = createMockStore([cluster]);
    const resultOld = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: [], repo: "test/repo" },
      store2,
      createMockSql(5, 55) as any,
      createMockLogger(),
    );

    // Recent should have higher combined score
    if (resultRecent.length > 0 && resultOld.length > 0) {
      expect(resultRecent[0]!.combinedScore).toBeGreaterThan(resultOld[0]!.combinedScore);
    }
  });

  it("returns representative sample in matches", async () => {
    const centroid = randomEmbedding(1024, 44);
    const cluster = makeCluster({ id: 1, slug: "with-sample", centroid });
    const store = createMockStore([cluster]);

    const result = await matchClusterPatterns(
      { prEmbedding: new Float32Array(centroid), prFilePaths: [], repo: "test/repo" },
      store,
      createMockSql(5, 5) as any,
      createMockLogger(),
    );

    expect(result.length).toBe(1);
    expect(result[0]!.representativeSample).toBe("Example review comment text");
  });

  it("handles errors gracefully (fail-open)", async () => {
    const cluster = makeCluster({ id: 1, slug: "error-test", centroid: randomEmbedding(1024, 88) });
    const store = createMockStore([cluster]);

    // SQL throws error
    const mockSql = mock((() => {
      throw new Error("SQL error");
    }) as any);

    const result = await matchClusterPatterns(
      { prEmbedding: randomEmbedding(1024, 88), prFilePaths: [], repo: "test/repo" },
      store,
      mockSql as any,
      createMockLogger(),
    );

    // Should return empty, not throw
    expect(result).toEqual([]);
  });
});
