import { describe, test, expect, mock } from "bun:test";
import { searchCanonicalCode } from "./canonical-code-retrieval.ts";
import { createRetriever } from "./retrieval.ts";
import type { CanonicalCodeStore } from "./canonical-code-types.ts";
import type { EmbeddingProvider, EmbeddingResult, RetrievalResult, RetrievalWithProvenance } from "./types.ts";
import type { IsolationLayer } from "./isolation.ts";

const mockLogger = {
  info: () => {},
  warn: mock(() => {}),
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as import("pino").Logger;

function makeMockEmbeddingProvider(opts?: { shouldThrow?: boolean; returnNull?: boolean }): EmbeddingProvider {
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

function makeCanonicalStore(results: Awaited<ReturnType<CanonicalCodeStore["searchByEmbedding"]>> = []) {
  return {
    searchByEmbedding: mock(async () => results),
  } satisfies Pick<CanonicalCodeStore, "searchByEmbedding">;
}

describe("searchCanonicalCode", () => {
  test("returns provenance-rich canonical matches", async () => {
    const store = makeCanonicalStore([
      {
        id: BigInt(7),
        repo: "owner/repo",
        owner: "owner",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/auth/token.ts",
        language: "typescript",
        startLine: 10,
        endLine: 42,
        chunkType: "function",
        symbolName: "rotateToken",
        chunkText: "function rotateToken() {}",
        contentHash: "sha256:canon",
        distance: 0.13,
        embeddingModel: "test-model",
      },
    ]);

    const result = await searchCanonicalCode({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "token rotation",
      repo: "owner/repo",
      canonicalRef: "main",
      topK: 5,
      logger: mockLogger,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: BigInt(7),
      chunkText: "function rotateToken() {}",
      distance: 0.13,
      repo: "owner/repo",
      owner: "owner",
      canonicalRef: "main",
      commitSha: "abc123",
      filePath: "src/auth/token.ts",
      language: "typescript",
      startLine: 10,
      endLine: 42,
      chunkType: "function",
      symbolName: "rotateToken",
      contentHash: "sha256:canon",
      embeddingModel: "test-model",
      source: "canonical_code",
    });
  });

  test("returns empty array when embedding generation returns null", async () => {
    const store = makeCanonicalStore([
      {
        id: BigInt(1),
        repo: "owner/repo",
        owner: "owner",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/file.ts",
        language: "typescript",
        startLine: 1,
        endLine: 5,
        chunkType: "function",
        symbolName: "x",
        chunkText: "x",
        contentHash: "h",
        distance: 0.1,
        embeddingModel: "test-model",
      },
    ]);

    const result = await searchCanonicalCode({
      store,
      embeddingProvider: makeMockEmbeddingProvider({ returnNull: true }),
      query: "token rotation",
      repo: "owner/repo",
      canonicalRef: "main",
      topK: 5,
      logger: mockLogger,
    });

    expect(result).toEqual([]);
    expect(store.searchByEmbedding).not.toHaveBeenCalled();
  });

  test("fails open when the store throws", async () => {
    const store = {
      searchByEmbedding: mock(async () => {
        throw new Error("db down");
      }),
    } satisfies Pick<CanonicalCodeStore, "searchByEmbedding">;

    const result = await searchCanonicalCode({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "token rotation",
      repo: "owner/repo",
      canonicalRef: "main",
      topK: 5,
      logger: mockLogger,
    });

    expect(result).toEqual([]);
    expect(store.searchByEmbedding).toHaveBeenCalledTimes(1);
  });
});

describe("createRetriever with canonical code", () => {
  test("includes canonical current-code matches as a distinct unified corpus with provenance", async () => {
    const canonicalStore = makeCanonicalStore([
      {
        id: BigInt(11),
        repo: "owner/repo",
        owner: "owner",
        canonicalRef: "main",
        commitSha: "deadbeef",
        filePath: "src/auth/token.ts",
        language: "typescript",
        startLine: 15,
        endLine: 40,
        chunkType: "function",
        symbolName: "rotateToken",
        chunkText: "export function rotateToken(current: string) { return current + '-next'; }",
        contentHash: "sha256:rotate",
        distance: 0.09,
        embeddingModel: "test-model",
      },
    ]);

    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer([makeRetrievalResult(1, 0.2)]),
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      canonicalCodeStore: canonicalStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["token rotation"],
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.provenance.canonicalCodeCount).toBe(1);

    const canonicalChunk = result!.unifiedResults.find((chunk) => chunk.source === "canonical_code");
    expect(canonicalChunk).toBeDefined();
    expect(canonicalChunk!.sourceLabel).toContain("[canonical: src/auth/token.ts:15-40 @ main]");
    expect(canonicalChunk!.metadata).toMatchObject({
      canonicalRef: "main",
      commitSha: "deadbeef",
      filePath: "src/auth/token.ts",
      chunkType: "function",
      symbolName: "rotateToken",
      contentHash: "sha256:rotate",
    });
    expect(result!.contextWindow).toContain("[canonical: src/auth/token.ts:15-40 @ main]");
  });

  test("canonical retrieval fail-open preserves other corpora", async () => {
    const canonicalStore = {
      searchByEmbedding: mock(async () => {
        throw new Error("canonical unavailable");
      }),
    } satisfies Pick<CanonicalCodeStore, "searchByEmbedding">;

    const retriever = createRetriever({
      embeddingProvider: makeMockEmbeddingProvider(),
      isolationLayer: makeMockIsolationLayer([makeRetrievalResult(1, 0.2)]),
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      canonicalCodeStore: canonicalStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["token rotation"],
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.findings.length).toBeGreaterThan(0);
    expect(result!.provenance.canonicalCodeCount).toBe(0);
    expect(result!.unifiedResults.some((chunk) => chunk.source === "code")).toBe(true);
    expect(result!.unifiedResults.some((chunk) => chunk.source === "canonical_code")).toBe(false);
  });
});
