import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { CanonicalCodeStore } from "../knowledge/canonical-code-types.ts";
import type { ReviewGraphBlastRadiusResult } from "../review-graph/query.ts";
import type { StructuralImpactCache } from "./cache.ts";
import type { StructuralImpactSignal } from "./orchestrator.ts";
import {
  createReviewGraphAdapter,
  createCanonicalCorpusAdapter,
  fetchReviewStructuralImpact,
  type ReviewGraphQueryFn,
} from "./review-integration.ts";

function createNoopLogger(): Logger {
  const noop = () => undefined;
  const logger = {
    level: "silent",
    silent: true,
    msgPrefix: "",
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger as unknown as Logger;
}

function makeGraphResult(overrides?: Partial<ReviewGraphBlastRadiusResult>): ReviewGraphBlastRadiusResult {
  return {
    changedFiles: ["src/service.cpp"],
    seedSymbols: [
      {
        stableKey: "src/service.cpp::parseToken",
        symbolName: "parseToken",
        qualifiedName: "parseToken",
        filePath: "src/service.cpp",
      },
    ],
    impactedFiles: [
      {
        path: "src/auth.cpp",
        score: 0.95,
        confidence: 1,
        reasons: ["calls parseToken"],
        relatedChangedPaths: ["src/service.cpp"],
        languages: ["cpp"],
      },
    ],
    probableDependents: [
      {
        stableKey: "src/auth.cpp::authenticate",
        symbolName: "authenticate",
        qualifiedName: "authenticate",
        filePath: "src/auth.cpp",
        score: 0.93,
        confidence: 1,
        reasons: ["calls parseToken"],
        relatedChangedPaths: ["src/service.cpp"],
      },
    ],
    likelyTests: [
      {
        path: "tests/service_test.cpp",
        score: 0.88,
        confidence: 0.9,
        reasons: ["tests parseToken"],
        relatedChangedPaths: ["src/service.cpp"],
        languages: ["cpp"],
        testSymbols: ["test_parseToken"],
      },
    ],
    graphStats: {
      files: 100,
      nodes: 800,
      edges: 3200,
      changedFilesFound: 1,
    },
    ...overrides,
  };
}

function stubGraphQuery(result: ReviewGraphBlastRadiusResult = makeGraphResult()): ReviewGraphQueryFn {
  return async () => result;
}

function makeEmbeddingProvider(): Pick<EmbeddingProvider, "generate"> {
  return {
    generate: async () => ({
      embedding: new Float32Array([0.1, 0.2, 0.3]),
      model: "test-model",
      dimensions: 3,
    }),
  };
}

function makeCanonicalCodeStore(): Pick<CanonicalCodeStore, "searchByEmbedding"> {
  return {
    searchByEmbedding: async () => ([
      {
        id: 1n,
        repo: "acme/repo",
        owner: "acme",
        canonicalRef: "main",
        commitSha: "commit123",
        filePath: "src/related.cpp",
        language: "cpp",
        startLine: 10,
        endLine: 24,
        chunkType: "function",
        symbolName: "parseTokenHelper",
        chunkText: "int parseTokenHelper() { return 1; }",
        contentHash: "hash-1",
        embeddingModel: "test-model",
        distance: 0.17,
      },
    ]),
  };
}

function makeSimpleCache(): StructuralImpactCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: (key) => store.get(key) as ReturnType<StructuralImpactCache["get"]>,
    set: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("createReviewGraphAdapter", () => {
  test("delegates to the reviewGraphQuery substrate", async () => {
    let captured: Parameters<ReviewGraphQueryFn>[0] | undefined;
    const adapter = createReviewGraphAdapter(async (input) => {
      captured = input;
      return makeGraphResult();
    });

    const result = await adapter.queryBlastRadius({
      repo: "acme/repo",
      workspaceKey: "headsha",
      changedPaths: ["src/service.cpp"],
      limit: 25,
    });

    expect(result.graphStats.changedFilesFound).toBe(1);
    expect(captured).toEqual({
      repo: "acme/repo",
      workspaceKey: "headsha",
      changedPaths: ["src/service.cpp"],
      limit: 25,
    });
  });
});

describe("createCanonicalCorpusAdapter", () => {
  test("delegates to canonical search and normalizes the consumer-facing match shape", async () => {
    const adapter = createCanonicalCorpusAdapter({
      canonicalCodeStore: makeCanonicalCodeStore(),
      embeddingProvider: makeEmbeddingProvider(),
      logger: createNoopLogger(),
    });

    const matches = await adapter.searchCanonicalCode({
      repo: "acme/repo",
      canonicalRef: "main",
      query: "parse token helper",
      topK: 5,
      language: "cpp",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      filePath: "src/related.cpp",
      canonicalRef: "main",
      symbolName: "parseTokenHelper",
      distance: 0.17,
    });
  });
});

describe("fetchReviewStructuralImpact", () => {
  test("returns bounded payload and captured graph blast radius when both substrates are available", async () => {
    const result = await fetchReviewStructuralImpact(
      {
        reviewGraphQuery: stubGraphQuery(),
        canonicalCodeStore: makeCanonicalCodeStore(),
        embeddingProvider: makeEmbeddingProvider(),
        logger: createNoopLogger(),
      },
      {
        repo: "acme/repo",
        owner: "acme",
        workspaceKey: "headsha",
        baseSha: "base123",
        headSha: "head123",
        changedPaths: ["src/service.cpp"],
        canonicalRef: "main",
        query: "parse token helper",
      },
    );

    expect(result.payload.status).toBe("ok");
    expect(result.payload.canonicalEvidence).toHaveLength(1);
    expect(result.payload.impactedFiles).toHaveLength(1);
    expect(result.graphBlastRadius?.impactedFiles[0]?.path).toBe("src/auth.cpp");
  });

  test("fails open to partial when graph substrate rejects", async () => {
    const result = await fetchReviewStructuralImpact(
      {
        reviewGraphQuery: async () => { throw new Error("graph exploded"); },
        canonicalCodeStore: makeCanonicalCodeStore(),
        embeddingProvider: makeEmbeddingProvider(),
        logger: createNoopLogger(),
      },
      {
        repo: "acme/repo",
        owner: "acme",
        workspaceKey: "headsha",
        baseSha: "base123",
        headSha: "head123",
        changedPaths: ["src/service.cpp"],
        canonicalRef: "main",
        query: "parse token helper",
      },
    );

    expect(result.payload.status).toBe("partial");
    expect(result.payload.canonicalEvidence).toHaveLength(1);
    expect(result.graphBlastRadius).toBeNull();
    expect(result.payload.degradations.some((item) => item.source === "graph")).toBe(true);
  });

  test("fails open to partial when corpus substrate returns no matches", async () => {
    const result = await fetchReviewStructuralImpact(
      {
        reviewGraphQuery: stubGraphQuery(),
        canonicalCodeStore: {
          searchByEmbedding: async () => {
            throw new Error("vector store unavailable");
          },
        },
        embeddingProvider: makeEmbeddingProvider(),
        logger: createNoopLogger(),
      },
      {
        repo: "acme/repo",
        owner: "acme",
        workspaceKey: "headsha",
        baseSha: "base123",
        headSha: "head123",
        changedPaths: ["src/service.cpp"],
        canonicalRef: "main",
        query: "parse token helper",
      },
    );

    expect(result.payload.status).toBe("partial");
    expect(result.payload.canonicalEvidence).toHaveLength(0);
    expect(result.graphBlastRadius).not.toBeNull();
    expect(result.payload.degradations).toHaveLength(0);
  });

  test("returns unavailable when neither substrate is configured", async () => {
    const signals: StructuralImpactSignal[] = [];

    const result = await fetchReviewStructuralImpact(
      {
        logger: createNoopLogger(),
      },
      {
        repo: "acme/repo",
        owner: "acme",
        workspaceKey: "headsha",
        baseSha: "base123",
        headSha: "head123",
        changedPaths: ["src/service.cpp"],
        canonicalRef: "main",
        query: "parse token helper",
        onSignal: (signal) => signals.push(signal),
      },
    );

    expect(result.payload.status).toBe("unavailable");
    expect(result.graphBlastRadius).toBeNull();
    expect(signals.some((signal) => signal.kind === "graph-error")).toBe(true);
    expect(signals.some((signal) => signal.kind === "corpus-error")).toBe(true);
  });

  test("reuses cache by repo/base/head key and skips repeated substrate calls", async () => {
    const cache = makeSimpleCache();
    let graphCalls = 0;
    let corpusCalls = 0;

    const deps = {
      reviewGraphQuery: async () => {
        graphCalls += 1;
        return makeGraphResult();
      },
      canonicalCodeStore: {
        searchByEmbedding: async () => {
          corpusCalls += 1;
          return makeCanonicalCodeStore().searchByEmbedding({
            queryEmbedding: new Float32Array([0.1]),
            repo: "acme/repo",
            canonicalRef: "main",
            topK: 5,
            language: "cpp",
            distanceThreshold: 0.7,
          });
        },
      },
      embeddingProvider: makeEmbeddingProvider(),
      cache,
      logger: createNoopLogger(),
    };

    const request = {
      repo: "acme/repo",
      owner: "acme",
      workspaceKey: "headsha",
      baseSha: "base123",
      headSha: "head123",
      changedPaths: ["src/service.cpp"],
      canonicalRef: "main",
      query: "parse token helper",
      language: "cpp",
    };

    await fetchReviewStructuralImpact(deps, request);
    await fetchReviewStructuralImpact(deps, request);

    expect(graphCalls).toBe(1);
    expect(corpusCalls).toBe(1);
    expect(cache.store.size).toBe(1);
  });

  test("forwards orchestration signals to the caller", async () => {
    const signals: StructuralImpactSignal[] = [];

    await fetchReviewStructuralImpact(
      {
        reviewGraphQuery: stubGraphQuery(),
        canonicalCodeStore: makeCanonicalCodeStore(),
        embeddingProvider: makeEmbeddingProvider(),
        logger: createNoopLogger(),
      },
      {
        repo: "acme/repo",
        owner: "acme",
        workspaceKey: "headsha",
        baseSha: "base123",
        headSha: "head123",
        changedPaths: ["src/service.cpp"],
        canonicalRef: "main",
        query: "parse token helper",
        onSignal: (signal) => signals.push(signal),
      },
    );

    expect(signals.some((signal) => signal.kind === "graph-ok")).toBe(true);
    expect(signals.some((signal) => signal.kind === "corpus-ok")).toBe(true);
    expect(signals.some((signal) => signal.kind === "result-ok")).toBe(true);
  });

  test("treats a never-resolving graph query as partial via orchestrator timeout", async () => {
    const neverResolveGraph: ReviewGraphQueryFn = async () => {
      await new Promise(() => undefined);
      return makeGraphResult();
    };

    const result = await fetchReviewStructuralImpact(
      {
        reviewGraphQuery: neverResolveGraph,
        canonicalCodeStore: makeCanonicalCodeStore(),
        embeddingProvider: makeEmbeddingProvider(),
        logger: createNoopLogger(),
      },
      {
        repo: "acme/repo",
        owner: "acme",
        workspaceKey: "headsha",
        baseSha: "base123",
        headSha: "head123",
        changedPaths: ["src/service.cpp"],
        canonicalRef: "main",
        query: "parse token helper",
        timeoutMs: 5,
      },
    );

    expect(result.payload.status).toBe("partial");
    expect(result.payload.degradations.some((item) => item.source === "graph" && item.reason.includes("timed out"))).toBe(true);
  });
});
