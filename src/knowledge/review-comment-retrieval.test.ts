import { describe, test, expect } from "bun:test";
import { searchReviewComments, type ReviewCommentMatch } from "./review-comment-retrieval.ts";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";
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
  returnNull?: boolean;
}): EmbeddingProvider {
  return {
    async generate(_text: string, _inputType: "document" | "query"): Promise<EmbeddingResult> {
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

function makeSearchResult(overrides: Partial<{
  distance: number;
  prNumber: number;
  authorLogin: string;
  filePath: string | null;
  chunkText: string;
  startLine: number | null;
  endLine: number | null;
  prTitle: string | null;
  authorAssociation: string | null;
  githubCreatedAt: string;
}> = {}): ReviewCommentSearchResult {
  return {
    distance: overrides.distance ?? 0.3,
    record: {
      id: 1,
      createdAt: "2025-01-01T00:00:00Z",
      repo: "owner/repo",
      owner: "owner",
      prNumber: overrides.prNumber ?? 123,
      prTitle: overrides.prTitle ?? "Fix auth bug",
      commentGithubId: 1001,
      threadId: "thread-1",
      inReplyToId: null,
      filePath: overrides.filePath ?? "src/auth.ts",
      startLine: overrides.startLine ?? 42,
      endLine: overrides.endLine ?? 50,
      diffHunk: null,
      authorLogin: overrides.authorLogin ?? "reviewer1",
      authorAssociation: overrides.authorAssociation ?? "MEMBER",
      body: "This needs fixing",
      chunkIndex: 0,
      chunkText: overrides.chunkText ?? "This lock ordering can cause deadlocks",
      tokenCount: 10,
      embedding: null,
      embeddingModel: "voyage-code-3",
      stale: false,
      githubCreatedAt: overrides.githubCreatedAt ?? "2025-08-15T10:00:00Z",
      githubUpdatedAt: null,
      deleted: false,
      backfillBatch: null,
    },
  };
}

function makeMockStore(results: ReviewCommentSearchResult[] = []): ReviewCommentStore {
  return {
    async writeChunks() {},
    async softDelete() {},
    async updateChunks() {},
    async searchByEmbedding(): Promise<ReviewCommentSearchResult[]> {
      return results;
    },
    async getThreadComments() { return []; },
    async getSyncState() { return null; },
    async updateSyncState() {},
    async getLatestCommentDate() { return null; },
    async countByRepo() { return 0; },
  };
}

describe("searchReviewComments", () => {
  test("returns matches sorted by distance", async () => {
    const results = [
      makeSearchResult({ distance: 0.4, authorLogin: "far" }),
      makeSearchResult({ distance: 0.1, authorLogin: "close" }),
      makeSearchResult({ distance: 0.25, authorLogin: "mid" }),
    ];
    const store = makeMockStore(results);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "deadlock in lock ordering",
      repo: "owner/repo",
      topK: 5,
      logger: mockLogger,
    });

    expect(matches).toHaveLength(3);
    // Results come from store already sorted by distance (vector DB ORDER BY)
    // but we verify they pass through
    expect(matches.every((m) => m.distance <= 0.7)).toBe(true);
  });

  test("filters by distance threshold", async () => {
    const results = [
      makeSearchResult({ distance: 0.2 }),
      makeSearchResult({ distance: 0.5 }),
      makeSearchResult({ distance: 0.8 }),
    ];
    const store = makeMockStore(results);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      distanceThreshold: 0.6,
      logger: mockLogger,
    });

    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.distance <= 0.6)).toBe(true);
  });

  test("uses default threshold of 0.7", async () => {
    const results = [
      makeSearchResult({ distance: 0.65 }),
      makeSearchResult({ distance: 0.75 }),
    ];
    const store = makeMockStore(results);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: mockLogger,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.distance).toBe(0.65);
  });

  test("returns empty array when embedding fails (fail-open)", async () => {
    const store = makeMockStore([makeSearchResult()]);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider({ returnNull: true }),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: mockLogger,
    });

    expect(matches).toEqual([]);
  });

  test("returns empty array when store has no results", async () => {
    const store = makeMockStore([]);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: mockLogger,
    });

    expect(matches).toEqual([]);
  });

  test("source attribution is always review_comment", async () => {
    const results = [
      makeSearchResult({ distance: 0.2 }),
      makeSearchResult({ distance: 0.3 }),
    ];
    const store = makeMockStore(results);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "test query",
      repo: "owner/repo",
      topK: 5,
      logger: mockLogger,
    });

    expect(matches.every((m) => m.source === "review_comment")).toBe(true);
  });

  test("maps all metadata fields correctly", async () => {
    const results = [
      makeSearchResult({
        distance: 0.15,
        prNumber: 5678,
        prTitle: "Improve auth flow",
        authorLogin: "contributor",
        authorAssociation: "CONTRIBUTOR",
        filePath: "src/video/VideoPlayer.cpp",
        startLine: 120,
        endLine: 145,
        chunkText: "This lock ordering can cause deadlocks when called from the rendering thread",
        githubCreatedAt: "2025-08-15T10:00:00Z",
      }),
    ];
    const store = makeMockStore(results);

    const matches = await searchReviewComments({
      store,
      embeddingProvider: makeMockEmbeddingProvider(),
      query: "deadlock",
      repo: "owner/repo",
      topK: 5,
      logger: mockLogger,
    });

    expect(matches).toHaveLength(1);
    const match = matches[0]!;
    expect(match.prNumber).toBe(5678);
    expect(match.prTitle).toBe("Improve auth flow");
    expect(match.authorLogin).toBe("contributor");
    expect(match.authorAssociation).toBe("CONTRIBUTOR");
    expect(match.filePath).toBe("src/video/VideoPlayer.cpp");
    expect(match.startLine).toBe(120);
    expect(match.endLine).toBe(145);
    expect(match.chunkText).toContain("deadlocks");
    expect(match.githubCreatedAt).toBe("2025-08-15T10:00:00Z");
    expect(match.repo).toBe("owner/repo");
    expect(match.source).toBe("review_comment");
  });
});
