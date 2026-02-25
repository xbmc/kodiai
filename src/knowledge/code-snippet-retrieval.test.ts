import { test, expect, describe } from "bun:test";
import { searchCodeSnippets } from "./code-snippet-retrieval.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { CodeSnippetStore, CodeSnippetSearchResult } from "./code-snippet-types.ts";

function createMockLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as import("pino").Logger;
}

function createMockEmbeddingProvider(embedding: Float32Array | null): EmbeddingProvider {
  return {
    async generate(_text: string, _inputType: "document" | "query") {
      if (!embedding) return null;
      return { embedding, model: "voyage-code-3", dimensions: 1024 };
    },
    get model() { return "voyage-code-3"; },
    get dimensions() { return 1024; },
  };
}

function createMockStore(results: CodeSnippetSearchResult[] = []): CodeSnippetStore {
  return {
    async writeSnippet() {},
    async writeOccurrence() {},
    async searchByEmbedding() { return results; },
    close() {},
  };
}

function createErrorStore(): CodeSnippetStore {
  return {
    async writeSnippet() {},
    async writeOccurrence() {},
    async searchByEmbedding() { throw new Error("DB connection failed"); },
    close() {},
  };
}

describe("searchCodeSnippets", () => {
  test("returns empty when embedding provider returns null", async () => {
    const result = await searchCodeSnippets({
      store: createMockStore(),
      embeddingProvider: createMockEmbeddingProvider(null),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(result).toEqual([]);
  });

  test("returns mapped results when store returns data", async () => {
    const searchResults: CodeSnippetSearchResult[] = [
      {
        contentHash: "hash1",
        embeddedText: "some code",
        distance: 0.15,
        language: "typescript",
        repo: "owner/repo",
        prNumber: 42,
        prTitle: "Fix bug",
        filePath: "src/main.ts",
        startLine: 10,
        endLine: 15,
        createdAt: "2026-02-25T00:00:00Z",
      },
    ];

    const result = await searchCodeSnippets({
      store: createMockStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(new Float32Array([0.1, 0.2])),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("snippet");
    expect(result[0]!.contentHash).toBe("hash1");
    expect(result[0]!.prNumber).toBe(42);
    expect(result[0]!.filePath).toBe("src/main.ts");
    expect(result[0]!.distance).toBe(0.15);
  });

  test("returns empty on store error (fail-open)", async () => {
    const result = await searchCodeSnippets({
      store: createErrorStore(),
      embeddingProvider: createMockEmbeddingProvider(new Float32Array([0.1])),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(result).toEqual([]);
  });

  test("all results have source: 'snippet'", async () => {
    const searchResults: CodeSnippetSearchResult[] = [
      {
        contentHash: "h1", embeddedText: "code1", distance: 0.1, language: "go",
        repo: "r", prNumber: 1, prTitle: null, filePath: "f.go",
        startLine: 1, endLine: 3, createdAt: "2026-01-01T00:00:00Z",
      },
      {
        contentHash: "h2", embeddedText: "code2", distance: 0.2, language: "go",
        repo: "r", prNumber: 2, prTitle: "PR 2", filePath: "g.go",
        startLine: 10, endLine: 20, createdAt: "2026-01-02T00:00:00Z",
      },
    ];

    const result = await searchCodeSnippets({
      store: createMockStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(new Float32Array([0.1])),
      query: "test",
      repo: "r",
      topK: 10,
      logger: createMockLogger(),
    });

    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.source).toBe("snippet");
    }
  });

  test("passes distance threshold to store", async () => {
    let receivedThreshold: number | undefined;

    const store: CodeSnippetStore = {
      async writeSnippet() {},
      async writeOccurrence() {},
      async searchByEmbedding(params) {
        receivedThreshold = params.distanceThreshold;
        return [];
      },
      close() {},
    };

    await searchCodeSnippets({
      store,
      embeddingProvider: createMockEmbeddingProvider(new Float32Array([0.1])),
      query: "test",
      repo: "r",
      topK: 5,
      distanceThreshold: 0.5,
      logger: createMockLogger(),
    });

    expect(receivedThreshold).toBe(0.5);
  });
});
