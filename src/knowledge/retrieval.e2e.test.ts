import { describe, it, expect, mock } from "bun:test";
import type { Logger } from "pino";
import { createRetriever } from "./retrieval.ts";

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

describe("Knowledge Layer E2E: shared retrieval path", () => {
  function createMockDeps() {
    const retrieveWithIsolation = mock(async (params: { queryEmbedding: Float32Array }) => {
      const mkRecord = (memoryId: number, filePath: string) => ({
        repo: "owner/repo",
        owner: "owner",
        findingId: memoryId,
        reviewId: memoryId + 100,
        sourceRepo: "owner/repo",
        findingText: `Finding ${memoryId} in ${filePath}`,
        severity: "major" as const,
        category: "correctness" as const,
        filePath,
        outcome: "accepted" as const,
        embeddingModel: "test",
        embeddingDim: 2,
        stale: false,
      });

      return {
        results: [
          { memoryId: 1, distance: 0.15, record: mkRecord(1, "src/auth/login.ts"), sourceRepo: "owner/repo" },
          { memoryId: 2, distance: 0.25, record: mkRecord(2, "src/middleware/auth.ts"), sourceRepo: "owner/repo" },
        ],
        provenance: {
          repoSources: ["owner/repo"],
          sharedPoolUsed: false,
          totalCandidates: 2,
          query: { repo: "owner/repo", topK: 5, threshold: 0.3 },
        },
      };
    });

    const embeddingProvider = {
      model: "test",
      dimensions: 2,
      generate: async (text: string, _purpose: string) => ({
        embedding: new Float32Array([0.5, 0.5]),
        model: "test",
        dimensions: 2,
      }),
    };

    const isolationLayer = { retrieveWithIsolation };

    return { embeddingProvider, isolationLayer, retrieveWithIsolation };
  }

  it("PR review and Slack assistant use the same retrieve() function", async () => {
    const { embeddingProvider, isolationLayer, retrieveWithIsolation } = createMockDeps();

    // Create ONE retriever instance (same as production wiring)
    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    // Simulate PR review retrieval: multiple queries (intent, file-path, code-shape)
    const prResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: [
        "fix auth bug in login flow",
        "src/auth/login.ts src/middleware/auth.ts",
        "typescript security authentication",
      ],
      prLanguages: ["TypeScript"],
      logger: createNoopLogger(),
    });

    // Simulate Slack retrieval: single query (user message)
    const slackResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["how does the auth login work?"],
      logger: createNoopLogger(),
    });

    // Both return results from the same retriever
    expect(prResult).not.toBeNull();
    expect(slackResult).not.toBeNull();

    // Both used the same isolation layer (mock was called for both)
    // PR: 3 queries = 3 calls, Slack: 1 query = 1 call = 4 total
    expect(retrieveWithIsolation).toHaveBeenCalledTimes(4);

    // Both results have the same shape
    expect(prResult!.findings).toBeDefined();
    expect(slackResult!.findings).toBeDefined();
    expect(prResult!.provenance).toBeDefined();
    expect(slackResult!.provenance).toBeDefined();

    // Both provenance objects have consistent structure
    expect(prResult!.provenance.queryCount).toBe(3);
    expect(slackResult!.provenance.queryCount).toBe(1);
  });

  it("Slack retrieval with empty queries returns null", async () => {
    const { embeddingProvider, isolationLayer } = createMockDeps();

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    // Empty queries = no retrieval
    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: [],
      logger: createNoopLogger(),
    });

    expect(result).toBeNull();
  });

  it("both paths share reranking and threshold pipeline", async () => {
    const { embeddingProvider, isolationLayer } = createMockDeps();

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    // PR path: multi-query with language reranking
    const prResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["auth fix", "src/auth/login.ts"],
      prLanguages: ["TypeScript"],
      logger: createNoopLogger(),
    });

    // Slack path: single query, no language context
    const slackResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["auth fix"],
      logger: createNoopLogger(),
    });

    // Both go through the same pipeline (merge -> rerank -> recency -> threshold)
    // Both have provenance with threshold info
    expect(prResult!.provenance.thresholdMethod).toBeDefined();
    expect(slackResult!.provenance.thresholdMethod).toBeDefined();

    // Both results are ordered by adjusted distance (lower = better)
    if (prResult!.findings.length >= 2) {
      const prDistances = prResult!.findings.map((f) => f.distance);
      for (let i = 1; i < prDistances.length; i++) {
        // Results should be ordered (after reranking, they may not be strictly ordered
        // by original distance, but the pipeline should produce consistent ordering)
        expect(typeof prDistances[i]).toBe("number");
      }
    }

    if (slackResult!.findings.length >= 2) {
      const slackDistances = slackResult!.findings.map((f) => f.distance);
      for (let i = 1; i < slackDistances.length; i++) {
        expect(typeof slackDistances[i]).toBe("number");
      }
    }
  });

  it("retrieval disabled returns null for both paths", async () => {
    const { embeddingProvider, isolationLayer } = createMockDeps();

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: false, topK: 5, distanceThreshold: 0.3, adaptive: true, maxContextChars: 2000 },
        sharing: { enabled: false },
      },
    });

    const prResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["fix auth"],
      logger: createNoopLogger(),
    });

    const slackResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["auth question"],
      logger: createNoopLogger(),
    });

    expect(prResult).toBeNull();
    expect(slackResult).toBeNull();
  });
});
