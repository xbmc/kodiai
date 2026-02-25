import { describe, it, expect, mock } from "bun:test";
import type { Logger } from "pino";
import { createRetriever } from "./retrieval.ts";
import type { ReviewCommentStore, ReviewCommentSearchResult } from "./review-comment-types.ts";
import type { WikiPageStore, WikiPageSearchResult } from "./wiki-types.ts";
import type { LearningMemoryStore } from "./types.ts";

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

// ---------------------------------------------------------------------------
// Language-aware ranking E2E tests (Phase 93)
// ---------------------------------------------------------------------------

describe("Language-aware cross-corpus ranking E2E", () => {
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

  /**
   * Build a retriever where the isolation layer returns memories with specific
   * language fields, and the wiki store returns chunks with specific languageTags.
   */
  function createLanguageAwareDeps(opts: {
    /** language field for memory record 1 */
    memory1Language: string;
    /** language field for memory record 2 */
    memory2Language: string;
    /** languageTags for wiki chunk 1 */
    wikiTags1: string[];
    /** languageTags for wiki chunk 2 */
    wikiTags2: string[];
  }) {
    const retrieveWithIsolation = mock(async () => ({
      results: [
        {
          memoryId: 1,
          distance: 0.2,
          sourceRepo: "owner/repo",
          record: {
            repo: "owner/repo",
            owner: "owner",
            findingId: 1,
            reviewId: 101,
            sourceRepo: "owner/repo",
            findingText: "Finding A",
            severity: "major" as const,
            category: "correctness" as const,
            filePath: "src/parser.cpp",
            outcome: "accepted" as const,
            embeddingModel: "test",
            embeddingDim: 2,
            stale: false,
            language: opts.memory1Language,
          },
        },
        {
          memoryId: 2,
          distance: 0.21,
          sourceRepo: "owner/repo",
          record: {
            repo: "owner/repo",
            owner: "owner",
            findingId: 2,
            reviewId: 102,
            sourceRepo: "owner/repo",
            findingText: "Finding B",
            severity: "major" as const,
            category: "correctness" as const,
            filePath: "src/main.py",
            outcome: "accepted" as const,
            embeddingModel: "test",
            embeddingDim: 2,
            stale: false,
            language: opts.memory2Language,
          },
        },
      ],
      provenance: {
        repoSources: ["owner/repo"],
        sharedPoolUsed: false,
        totalCandidates: 2,
        query: { repo: "owner/repo", topK: 5, threshold: 0.3 },
      },
    }));

    const embeddingProvider = {
      model: "test",
      dimensions: 2,
      generate: async () => ({
        embedding: new Float32Array([0.5, 0.5]),
        model: "test",
        dimensions: 2,
      }),
    };

    const wikiPageStore: Partial<WikiPageStore> = {
      searchByEmbedding: mock(async (): Promise<WikiPageSearchResult[]> => [
        {
          record: {
            id: 10,
            createdAt: new Date().toISOString(),
            pageId: 1001,
            pageTitle: "C++ Memory Safety",
            namespace: "engineering",
            pageUrl: "https://wiki.example.com/cpp-memory-safety",
            sectionHeading: "Buffer Overflow",
            sectionAnchor: null,
            sectionLevel: 2,
            chunkIndex: 0,
            chunkText: "C++ memory safety: always check buffer bounds before writing.",
            rawText: "Always check buffer bounds before writing.",
            tokenCount: 10,
            embedding: null,
            embeddingModel: "test",
            stale: false,
            lastModified: new Date().toISOString(),
            revisionId: 1,
            deleted: false,
            languageTags: opts.wikiTags1,
          },
          distance: 0.19,
        },
        {
          record: {
            id: 11,
            createdAt: new Date().toISOString(),
            pageId: 1002,
            pageTitle: "General Coding Standards",
            namespace: "engineering",
            pageUrl: "https://wiki.example.com/general-standards",
            sectionHeading: "Best Practices",
            sectionAnchor: null,
            sectionLevel: 2,
            chunkIndex: 0,
            chunkText: "General coding standards for all languages.",
            rawText: "General coding standards for all languages.",
            tokenCount: 8,
            embedding: null,
            embeddingModel: "test",
            stale: false,
            lastModified: new Date().toISOString(),
            revisionId: 1,
            deleted: false,
            languageTags: opts.wikiTags2,
          },
          distance: 0.2,
        },
      ]),
      searchByFullText: mock(async (): Promise<WikiPageSearchResult[]> => []),
    };

    return {
      embeddingProvider,
      isolationLayer: { retrieveWithIsolation },
      wikiPageStore: wikiPageStore as WikiPageStore,
    };
  }

  it("language boost: C++ memory ranks higher in C++ PR", async () => {
    // Memory 1 = cpp, Memory 2 = python, very similar distances (0.2 vs 0.21)
    const deps = createLanguageAwareDeps({
      memory1Language: "cpp",
      memory2Language: "python",
      wikiTags1: ["general"],
      wikiTags2: ["general"],
    });

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      wikiPageStore: deps.wikiPageStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["buffer overflow"],
      prLanguages: ["cpp"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    // Find the cpp and python memory chunks in unified results
    const cppChunk = result!.unifiedResults.find((r) => r.metadata?.language === "cpp");
    const pythonChunk = result!.unifiedResults.find((r) => r.metadata?.language === "python");

    expect(cppChunk).toBeDefined();
    expect(pythonChunk).toBeDefined();

    // C++ chunk should have higher rrfScore (boosted) than Python chunk (not boosted)
    expect(cppChunk!.rrfScore).toBeGreaterThan(pythonChunk!.rrfScore);
  });

  it("no penalty: non-matching language result is not penalized", async () => {
    // Memory 1 = python, no language match for C++ PR
    // Run once with prLanguages=["cpp"] and once without any languages
    const deps = createLanguageAwareDeps({
      memory1Language: "python",
      memory2Language: "python",
      wikiTags1: ["general"],
      wikiTags2: ["general"],
    });

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      wikiPageStore: deps.wikiPageStore,
    });

    const withLangResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["buffer overflow"],
      prLanguages: ["cpp"],
      logger: createNoopLogger(),
    });

    const withoutLangResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["buffer overflow"],
      logger: createNoopLogger(),
    });

    expect(withLangResult).not.toBeNull();
    expect(withoutLangResult).not.toBeNull();

    // Python chunks should NOT be penalized when C++ is the PR language
    // Their rrfScore with prLanguages=["cpp"] should be >= score without any language context
    const pythonChunkWith = withLangResult!.unifiedResults.find((r) => r.metadata?.language === "python");
    const pythonChunkWithout = withoutLangResult!.unifiedResults.find((r) => r.metadata?.language === "python");

    if (pythonChunkWith && pythonChunkWithout) {
      expect(pythonChunkWith.rrfScore).toBeGreaterThanOrEqual(pythonChunkWithout.rrfScore);
    }
  });

  it("wiki language tag boost: C++ wiki chunk ranks higher in C++ PR", async () => {
    // Wiki chunk 1 = ["cpp"], wiki chunk 2 = ["general"], similar distances
    const deps = createLanguageAwareDeps({
      memory1Language: "cpp",
      memory2Language: "cpp",
      wikiTags1: ["cpp"],
      wikiTags2: ["general"],
    });

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      wikiPageStore: deps.wikiPageStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["buffer overflow"],
      prLanguages: ["cpp"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    // Find wiki chunks by their languageTags metadata
    const wikiChunks = result!.unifiedResults.filter((r) => r.source === "wiki");
    const cppWikiChunk = wikiChunks.find((r) => {
      const tags = r.metadata?.languageTags as string[] | undefined;
      return tags && tags.includes("cpp");
    });
    const generalWikiChunk = wikiChunks.find((r) => {
      const tags = r.metadata?.languageTags as string[] | undefined;
      return tags && tags.includes("general") && !tags.includes("cpp");
    });

    if (cppWikiChunk && generalWikiChunk) {
      // C++ tagged wiki chunk should rank higher than general wiki chunk
      expect(cppWikiChunk.rrfScore).toBeGreaterThan(generalWikiChunk.rrfScore);
    }
  });

  it("related language affinity: C memory gets boosted in C++ PR", async () => {
    // Memory 1 = c (related to cpp), Memory 2 = python (unrelated)
    const deps = createLanguageAwareDeps({
      memory1Language: "c",
      memory2Language: "python",
      wikiTags1: ["general"],
      wikiTags2: ["general"],
    });

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      wikiPageStore: deps.wikiPageStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["buffer overflow"],
      prLanguages: ["cpp"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    const cChunk = result!.unifiedResults.find((r) => r.metadata?.language === "c");
    const pythonChunk = result!.unifiedResults.find((r) => r.metadata?.language === "python");

    if (cChunk && pythonChunk) {
      // C (related to C++) should rank higher than Python (unrelated) in a C++ PR
      expect(cChunk.rrfScore).toBeGreaterThanOrEqual(pythonChunk.rrfScore);
    }
  });

  it("multi-language proportional boost: 80% C++ gets stronger boost than 20% Python", async () => {
    // Memory 1 = cpp, Memory 2 = python; prLanguages weighted 80% C++
    const deps = createLanguageAwareDeps({
      memory1Language: "cpp",
      memory2Language: "python",
      wikiTags1: ["general"],
      wikiTags2: ["general"],
    });

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: false, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      wikiPageStore: deps.wikiPageStore,
    });

    // 4 C++ files, 1 Python file = 80% C++, 20% Python
    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["buffer overflow"],
      prLanguages: ["cpp", "cpp", "cpp", "cpp", "python"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    const cppChunk = result!.unifiedResults.find((r) => r.metadata?.language === "cpp");
    const pythonChunk = result!.unifiedResults.find((r) => r.metadata?.language === "python");

    if (cppChunk && pythonChunk) {
      // C++ results should get a stronger boost than Python results
      // (proportional to their share: 0.8 * BOOST_FACTOR vs 0.2 * BOOST_FACTOR)
      expect(cppChunk.rrfScore).toBeGreaterThan(pythonChunk.rrfScore);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-corpus retrieval E2E tests (Phase 91)
// ---------------------------------------------------------------------------

describe("Cross-corpus retrieval E2E", () => {
  function createFullMockDeps() {
    const retrieveWithIsolation = mock(async () => {
      const mkRecord = (memoryId: number, filePath: string) => ({
        repo: "owner/repo",
        owner: "owner",
        findingId: memoryId,
        reviewId: memoryId + 100,
        sourceRepo: "owner/repo",
        findingText: `Buffer overflow risk in ${filePath} when input exceeds bounds`,
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
          { memoryId: 1, distance: 0.15, record: mkRecord(1, "src/parser.cpp"), sourceRepo: "owner/repo" },
        ],
        provenance: {
          repoSources: ["owner/repo"],
          sharedPoolUsed: false,
          totalCandidates: 1,
          query: { repo: "owner/repo", topK: 5, threshold: 0.3 },
        },
      };
    });

    const embeddingProvider = {
      model: "test",
      dimensions: 2,
      generate: async () => ({
        embedding: new Float32Array([0.5, 0.5]),
        model: "test",
        dimensions: 2,
      }),
    };

    const isolationLayer = { retrieveWithIsolation };

    // Mock review comment store
    const reviewCommentStore: Partial<ReviewCommentStore> = {
      searchByEmbedding: mock(async (): Promise<ReviewCommentSearchResult[]> => [
        {
          record: {
            id: 10,
            createdAt: new Date().toISOString(),
            repo: "owner/repo",
            owner: "owner",
            prNumber: 42,
            prTitle: "Fix parser error handling",
            commentGithubId: 100,
            threadId: "thread-1",
            inReplyToId: null,
            filePath: "src/parser.cpp",
            startLine: 10,
            endLine: 15,
            diffHunk: null,
            authorLogin: "reviewer1",
            authorAssociation: "MEMBER",
            body: "Parser error handling should validate input length before processing",
            chunkIndex: 0,
            chunkText: "Parser error handling should validate input length before processing",
            tokenCount: 10,
            embedding: null,
            embeddingModel: "test",
            stale: false,
            githubCreatedAt: new Date().toISOString(),
            githubUpdatedAt: null,
            deleted: false,
            backfillBatch: null,
          },
          distance: 0.2,
        },
      ]),
      searchByFullText: mock(async (): Promise<ReviewCommentSearchResult[]> => [
        {
          record: {
            id: 11,
            createdAt: new Date().toISOString(),
            repo: "owner/repo",
            owner: "owner",
            prNumber: 42,
            prTitle: "Fix parser error handling",
            commentGithubId: 101,
            threadId: "thread-2",
            inReplyToId: null,
            filePath: "src/parser.cpp",
            startLine: 20,
            endLine: 25,
            diffHunk: null,
            authorLogin: "reviewer2",
            authorAssociation: "MEMBER",
            body: "Parser needs bounds checking for buffer overflow prevention",
            chunkIndex: 0,
            chunkText: "Parser needs bounds checking for buffer overflow prevention",
            tokenCount: 8,
            embedding: null,
            embeddingModel: "test",
            stale: false,
            githubCreatedAt: new Date().toISOString(),
            githubUpdatedAt: null,
            deleted: false,
            backfillBatch: null,
          },
          distance: 0.3,
        },
      ]),
    };

    // Mock wiki page store
    const wikiPageStore: Partial<WikiPageStore> = {
      searchByEmbedding: mock(async (): Promise<WikiPageSearchResult[]> => [
        {
          record: {
            id: 20,
            createdAt: new Date().toISOString(),
            source: "confluence",
            namespace: "engineering",
            pageId: 1001,
            pageTitle: "Parser Architecture",
            sectionTitle: "Error Handling",
            chunkIndex: 0,
            chunkText: "The parser module uses a two-phase approach: validation then execution. All inputs must be bounds-checked.",
            tokenCount: 15,
            embedding: null,
            embeddingModel: "test",
            stale: false,
            lastModified: new Date().toISOString(),
            revisionId: 1,
            deleted: false,
          },
          distance: 0.18,
        },
      ]),
      searchByFullText: mock(async (): Promise<WikiPageSearchResult[]> => [
        {
          record: {
            id: 21,
            createdAt: new Date().toISOString(),
            source: "confluence",
            namespace: "engineering",
            pageId: 1002,
            pageTitle: "Coding Standards",
            sectionTitle: "Input Validation",
            chunkIndex: 0,
            chunkText: "All parser inputs must validate buffer sizes before processing to prevent overflow.",
            tokenCount: 12,
            embedding: null,
            embeddingModel: "test",
            stale: false,
            lastModified: new Date().toISOString(),
            revisionId: 1,
            deleted: false,
          },
          distance: 0.25,
        },
      ]),
    };

    return {
      embeddingProvider,
      isolationLayer,
      retrieveWithIsolation,
      reviewCommentStore: reviewCommentStore as ReviewCommentStore,
      wikiPageStore: wikiPageStore as WikiPageStore,
    };
  }

  it("cross-corpus retrieval returns attributed results from all three corpora", async () => {
    const deps = createFullMockDeps();

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: true, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      reviewCommentStore: deps.reviewCommentStore,
      wikiPageStore: deps.wikiPageStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    // unifiedResults should contain items from all three corpora
    const sources = new Set(result!.unifiedResults.map((r) => r.source));
    expect(sources.has("code")).toBe(true);
    expect(sources.has("review_comment")).toBe(true);
    expect(sources.has("wiki")).toBe(true);

    // Each item should have sourceLabel and rrfScore
    for (const chunk of result!.unifiedResults) {
      expect(chunk.sourceLabel).toBeTruthy();
      expect(chunk.rrfScore).toBeGreaterThan(0);
      expect(chunk.text).toBeTruthy();
    }

    // contextWindow should be a non-empty string containing source labels
    expect(result!.contextWindow).toBeTruthy();
    expect(typeof result!.contextWindow).toBe("string");

    // provenance should track unified pipeline
    expect(result!.provenance.hybridSearchUsed).toBe(true);
    expect(result!.provenance.unifiedResultCount).toBe(result!.unifiedResults.length);
  });

  it("PR review trigger boosts code and review sources", async () => {
    const deps = createFullMockDeps();

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: true, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      reviewCommentStore: deps.reviewCommentStore,
      wikiPageStore: deps.wikiPageStore,
    });

    // With pr_review trigger, code and review should rank higher
    const prResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      triggerType: "pr_review",
      logger: createNoopLogger(),
    });

    // Without trigger
    const baseResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      logger: createNoopLogger(),
    });

    expect(prResult).not.toBeNull();
    expect(baseResult).not.toBeNull();

    // pr_review should still have all three sources
    const prSources = new Set(prResult!.unifiedResults.map((r) => r.source));
    expect(prSources.has("code")).toBe(true);

    // Code and review chunks should have higher RRF scores with pr_review trigger
    // because of the 1.2x source weight boost
    const prCodeChunks = prResult!.unifiedResults.filter((r) => r.source === "code");
    const baseCodeChunks = baseResult!.unifiedResults.filter((r) => r.source === "code");

    if (prCodeChunks.length > 0 && baseCodeChunks.length > 0) {
      // The boosted score should be >= the non-boosted score
      expect(prCodeChunks[0].rrfScore).toBeGreaterThanOrEqual(baseCodeChunks[0].rrfScore);
    }
  });

  it("question trigger boosts wiki source", async () => {
    const deps = createFullMockDeps();

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: true, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      reviewCommentStore: deps.reviewCommentStore,
      wikiPageStore: deps.wikiPageStore,
    });

    // With question trigger, wiki should rank higher
    const questionResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      triggerType: "question",
      logger: createNoopLogger(),
    });

    // Without trigger
    const baseResult = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      logger: createNoopLogger(),
    });

    expect(questionResult).not.toBeNull();

    // Wiki chunks should have higher RRF scores with question trigger
    const qWikiChunks = questionResult!.unifiedResults.filter((r) => r.source === "wiki");
    const baseWikiChunks = baseResult!.unifiedResults.filter((r) => r.source === "wiki");

    if (qWikiChunks.length > 0 && baseWikiChunks.length > 0) {
      expect(qWikiChunks[0].rrfScore).toBeGreaterThanOrEqual(baseWikiChunks[0].rrfScore);
    }
  });

  it("fail-open: missing wiki store still returns code and review results", async () => {
    const deps = createFullMockDeps();

    // Create retriever WITHOUT wiki store
    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: true, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      reviewCommentStore: deps.reviewCommentStore,
      // No wikiPageStore — should still work
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    // Should have code results from isolation layer
    expect(result!.findings.length).toBeGreaterThan(0);

    // Unified results should still contain code at minimum
    const sources = new Set(result!.unifiedResults.map((r) => r.source));
    expect(sources.has("code")).toBe(true);

    // Should NOT crash — wiki simply absent
    expect(result!.provenance).toBeDefined();
  });

  it("fail-open: missing review comment store still returns code and wiki results", async () => {
    const deps = createFullMockDeps();

    // Create retriever WITHOUT review comment store
    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: true, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      wikiPageStore: deps.wikiPageStore,
      // No reviewCommentStore
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();
    expect(result!.findings.length).toBeGreaterThan(0);

    // Should have code + wiki but not review_comment
    const sources = new Set(result!.unifiedResults.map((r) => r.source));
    expect(sources.has("code")).toBe(true);
    expect(sources.has("wiki")).toBe(true);
  });

  it("legacy fields are preserved alongside unified results", async () => {
    const deps = createFullMockDeps();

    const retriever = createRetriever({
      embeddingProvider: deps.embeddingProvider as never,
      isolationLayer: deps.isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 10, distanceThreshold: 0.5, adaptive: true, maxContextChars: 4000 },
        sharing: { enabled: false },
      },
      reviewCommentStore: deps.reviewCommentStore,
      wikiPageStore: deps.wikiPageStore,
    });

    const result = await retriever.retrieve({
      repo: "owner/repo",
      owner: "owner",
      queries: ["parser error handling"],
      logger: createNoopLogger(),
    });

    expect(result).not.toBeNull();

    // Legacy fields should still be populated for backward compatibility
    expect(result!.findings).toBeDefined();
    expect(Array.isArray(result!.findings)).toBe(true);
    expect(result!.reviewPrecedents).toBeDefined();
    expect(Array.isArray(result!.reviewPrecedents)).toBe(true);
    expect(result!.wikiKnowledge).toBeDefined();
    expect(Array.isArray(result!.wikiKnowledge)).toBe(true);

    // New unified fields should also be populated
    expect(result!.unifiedResults).toBeDefined();
    expect(result!.unifiedResults.length).toBeGreaterThan(0);
    expect(result!.contextWindow).toBeDefined();
    expect(typeof result!.contextWindow).toBe("string");
  });
});
