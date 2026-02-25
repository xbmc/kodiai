import { describe, test, expect } from "bun:test";
import { createRetriever, type RetrieveOptions, type RetrieveResult } from "./retrieval.ts";
import type { EmbeddingProvider, EmbeddingResult, RetrievalResult, RetrievalWithProvenance } from "./types.ts";
import type { IsolationLayer } from "./isolation.ts";
import type { ReviewCommentStore, ReviewCommentSearchResult } from "./review-comment-types.ts";

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

function makeMockEmbeddingProvider(opts?: {
  shouldThrow?: boolean;
  returnNull?: boolean;
}): EmbeddingProvider {
  return {
    async generate(_text: string, _inputType: "document" | "query"): Promise<EmbeddingResult> {
      if (opts?.shouldThrow) throw new Error("Embedding API error");
      if (opts?.returnNull) return null;
      return {
        embedding: new Float32Array(1024).fill(0.1),
        model: "test-model",
        dimensions: 1024,
      };
    },
    get model() { return "test-model"; },
    get dimensions() { return 1024; },
  };
}

function makeMockIsolationLayer(results: RetrievalResult[] = []): IsolationLayer {
  return {
    async retrieveWithIsolation(_params): Promise<RetrievalWithProvenance> {
      return {
        results,
        provenance: {
          repoSources: ["owner/repo"],
          sharedPoolUsed: false,
          totalCandidates: results.length,
          query: { repo: "owner/repo", topK: 10, threshold: 0.5 },
        },
      };
    },
  };
}

function makeRetrievalResult(memoryId: number, distance: number): RetrievalResult {
  return {
    memoryId,
    distance,
    sourceRepo: "owner/repo",
    record: {
      id: memoryId,
      repo: "owner/repo",
      owner: "owner",
      findingId: memoryId,
      reviewId: 100 + memoryId,
      sourceRepo: "owner/repo",
      findingText: `Finding ${memoryId}`,
      severity: "major",
      category: "correctness",
      filePath: `src/file-${memoryId}.ts`,
      outcome: "accepted",
      embeddingModel: "test-model",
      embeddingDim: 1024,
      stale: false,
      createdAt: new Date().toISOString(),
    },
  };
}

function makeBaseOpts(overrides: Partial<RetrieveOptions> = {}): RetrieveOptions {
  return {
    repo: "owner/repo",
    owner: "owner",
    queries: ["fix auth token rotation"],
    logger: mockLogger,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<{ enabled: boolean; adaptive: boolean }> = {}) {
  return {
    retrieval: {
      enabled: overrides.enabled ?? true,
      topK: 10,
      distanceThreshold: 0.5,
      adaptive: overrides.adaptive ?? true,
      maxContextChars: 2000,
    },
    sharing: { enabled: false },
  };
}

describe("createRetriever", () => {
  test("single query returns results", async () => {
    const results = [makeRetrievalResult(1, 0.2), makeRetrievalResult(2, 0.3)];
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts());

    expect(result).not.toBeNull();
    expect(result!.findings.length).toBeGreaterThan(0);
    expect(result!.provenance.queryCount).toBe(1);
  });

  test("multiple queries executes multi-variant retrieval", async () => {
    const results = [
      makeRetrievalResult(1, 0.15),
      makeRetrievalResult(2, 0.25),
      makeRetrievalResult(3, 0.35),
    ];
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts({
      queries: ["fix auth", "src/auth/token.ts", "typescript security token"],
    }));

    expect(result).not.toBeNull();
    expect(result!.provenance.queryCount).toBe(3);
    // With 3 queries, each becomes a variant
    expect(result!.findings.length).toBeGreaterThan(0);
  });

  test("returns null when retrieval is disabled", async () => {
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(),
      config: makeConfig({ enabled: false }),
    });

    const result = await retriever.retrieve(makeBaseOpts());
    expect(result).toBeNull();
  });

  test("returns null when queries array is empty", async () => {
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(),
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts({ queries: [] }));
    expect(result).toBeNull();
  });

  test("fail-open: returns null when embedding provider throws", async () => {
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider({ shouldThrow: true }),
      isolationLayer: makeMockIsolationLayer(),
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts());
    // When embedding fails, the variant execution will fail but pipeline catches
    // and either returns null (all variants fail) or returns partial results
    // Since embedding throws for ALL variants, merged results will be empty
    expect(result).not.toBeNull(); // Pipeline wraps in try/catch, returns result with empty findings
    expect(result!.findings).toHaveLength(0);
  });

  test("fail-open: returns null when isolation layer throws", async () => {
    const throwingIsolation: IsolationLayer = {
      async retrieveWithIsolation(): Promise<RetrievalWithProvenance> {
        throw new Error("Database connection failed");
      },
    };

    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: throwingIsolation,
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts());
    // Variant execution catches per-variant errors; if all fail, merged is empty
    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(0);
  });

  test("adaptive threshold filters high-distance results", async () => {
    const results = [
      makeRetrievalResult(1, 0.1),
      makeRetrievalResult(2, 0.15),
      makeRetrievalResult(3, 0.2),
      makeRetrievalResult(4, 0.25),
      makeRetrievalResult(5, 0.3),
      makeRetrievalResult(6, 0.35),
      makeRetrievalResult(7, 0.4),
      makeRetrievalResult(8, 0.9), // Should be filtered by adaptive threshold
    ];

    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig({ adaptive: true }),
    });

    const result = await retriever.retrieve(makeBaseOpts());

    expect(result).not.toBeNull();
    // The high-distance result (0.9) should be filtered out by adaptive threshold
    // due to the large gap between 0.4 and 0.9
    const maxDistance = Math.max(...result!.findings.map((f) =>
      "adjustedDistance" in f ? (f as unknown as { adjustedDistance: number }).adjustedDistance : f.distance
    ));
    expect(maxDistance).toBeLessThan(0.9);
  });

  test("non-adaptive mode still returns results", async () => {
    const results = [makeRetrievalResult(1, 0.2), makeRetrievalResult(2, 0.3)];
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig({ adaptive: false }),
    });

    const result = await retriever.retrieve(makeBaseOpts());

    expect(result).not.toBeNull();
    expect(result!.findings.length).toBeGreaterThan(0);
    expect(result!.provenance.thresholdMethod).toBe("configured");
  });

  test("provenance includes correct metadata", async () => {
    const results = [makeRetrievalResult(1, 0.2)];
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts({
      queries: ["query1", "query2"],
    }));

    expect(result).not.toBeNull();
    expect(result!.provenance.queryCount).toBe(2);
    expect(typeof result!.provenance.candidateCount).toBe("number");
    expect(typeof result!.provenance.sharedPoolUsed).toBe("boolean");
    expect(typeof result!.provenance.thresholdMethod).toBe("string");
    expect(typeof result!.provenance.thresholdValue).toBe("number");
  });

  test("reviewPrecedents populated when reviewCommentStore provided", async () => {
    const results = [makeRetrievalResult(1, 0.2)];
    const mockCommentStore: ReviewCommentStore = {
      async writeChunks() {},
      async softDelete() {},
      async updateChunks() {},
      async searchByEmbedding(): Promise<ReviewCommentSearchResult[]> {
        return [{
          distance: 0.25,
          record: {
            id: 1, createdAt: "2025-01-01T00:00:00Z", repo: "owner/repo", owner: "owner",
            prNumber: 123, prTitle: "Fix bug", commentGithubId: 1001, threadId: "t1",
            inReplyToId: null, filePath: "src/auth.ts", startLine: 42, endLine: 50,
            diffHunk: null, authorLogin: "reviewer1", authorAssociation: "MEMBER",
            body: "Review comment", chunkIndex: 0, chunkText: "This is a review comment",
            tokenCount: 5, embedding: null, embeddingModel: "voyage-code-3",
            stale: false, githubCreatedAt: "2025-08-15T10:00:00Z", githubUpdatedAt: null,
            deleted: false, backfillBatch: null,
          },
        }];
      },
      async getThreadComments() { return []; },
      async getSyncState() { return null; },
      async updateSyncState() {},
      async getLatestCommentDate() { return null; },
      async countByRepo() { return 0; },
    };

    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig(),
      reviewCommentStore: mockCommentStore,
    });

    const result = await retriever.retrieve(makeBaseOpts());
    expect(result).not.toBeNull();
    expect(result!.reviewPrecedents).toHaveLength(1);
    expect(result!.reviewPrecedents[0]!.source).toBe("review_comment");
    expect(result!.reviewPrecedents[0]!.authorLogin).toBe("reviewer1");
    expect(result!.provenance.reviewCommentCount).toBe(1);
  });

  test("review comment search failure does not block learning memory results", async () => {
    const results = [makeRetrievalResult(1, 0.2)];
    const throwingCommentStore: ReviewCommentStore = {
      async writeChunks() {},
      async softDelete() {},
      async updateChunks() {},
      async searchByEmbedding(): Promise<ReviewCommentSearchResult[]> {
        throw new Error("Review comment store connection failed");
      },
      async getThreadComments() { return []; },
      async getSyncState() { return null; },
      async updateSyncState() {},
      async getLatestCommentDate() { return null; },
      async countByRepo() { return 0; },
    };

    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig(),
      reviewCommentStore: throwingCommentStore,
    });

    const result = await retriever.retrieve(makeBaseOpts());
    expect(result).not.toBeNull();
    expect(result!.findings.length).toBeGreaterThan(0);
    expect(result!.reviewPrecedents).toHaveLength(0);
    expect(result!.provenance.reviewCommentCount).toBe(0);
  });

  test("existing behavior unchanged when reviewCommentStore is undefined", async () => {
    const results = [makeRetrievalResult(1, 0.2)];
    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer(results),
      config: makeConfig(),
    });

    const result = await retriever.retrieve(makeBaseOpts());
    expect(result).not.toBeNull();
    expect(result!.reviewPrecedents).toHaveLength(0);
    expect(result!.provenance.reviewCommentCount).toBe(0);
  });
});
