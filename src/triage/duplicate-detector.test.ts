import { describe, it, expect } from "bun:test";
import { findDuplicateCandidates } from "./duplicate-detector.ts";
import type { IssueStore, IssueSearchResult } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider, EmbeddingResult } from "../knowledge/types.ts";
import type { Logger } from "pino";

function createMockLogger(): Logger {
  return {
    warn: () => {},
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as Logger;
}

function createMockEmbeddingProvider(
  result: EmbeddingResult = {
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    model: "voyage-code-3",
    dimensions: 3,
  },
): EmbeddingProvider {
  return {
    generate: async () => result,
    model: "voyage-code-3",
    dimensions: 3,
  };
}

function createMockIssueStore(results: IssueSearchResult[] = []): IssueStore {
  return {
    searchByEmbedding: async () => results,
  } as unknown as IssueStore;
}

function makeSearchResult(
  issueNumber: number,
  title: string,
  state: string,
  distance: number,
): IssueSearchResult {
  return {
    record: {
      id: issueNumber,
      createdAt: "2026-01-01",
      repo: "owner/repo",
      owner: "owner",
      issueNumber,
      title,
      body: null,
      state,
      authorLogin: "user",
      authorAssociation: null,
      labelNames: [],
      templateSlug: null,
      commentCount: 0,
      assignees: [],
      milestone: null,
      reactionCount: 0,
      isPullRequest: false,
      locked: false,
      embedding: null,
      embeddingModel: null,
      githubCreatedAt: "2026-01-01",
      githubUpdatedAt: null,
      closedAt: null,
    },
    distance,
  };
}

describe("findDuplicateCandidates", () => {
  const baseParams = {
    title: "App crashes on login",
    body: "When I try to login, the app crashes.",
    repo: "owner/repo",
    excludeIssueNumber: 100,
    threshold: 75,
    maxCandidates: 3,
    logger: createMockLogger(),
  };

  it("returns empty array when embedding generation returns null (fail-open)", async () => {
    const result = await findDuplicateCandidates({
      ...baseParams,
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(null),
    });

    expect(result).toEqual([]);
  });

  it("returns empty array when searchByEmbedding throws (fail-open)", async () => {
    const store = {
      searchByEmbedding: async () => {
        throw new Error("DB connection failed");
      },
    } as unknown as IssueStore;

    const result = await findDuplicateCandidates({
      ...baseParams,
      issueStore: store,
      embeddingProvider: createMockEmbeddingProvider(),
    });

    expect(result).toEqual([]);
  });

  it("filters out the triggering issue number from results", async () => {
    const results = [
      makeSearchResult(100, "Self match", "open", 0.0), // the triggering issue
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];

    const candidates = await findDuplicateCandidates({
      ...baseParams,
      issueStore: createMockIssueStore(results),
      embeddingProvider: createMockEmbeddingProvider(),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].issueNumber).toBe(50);
  });

  it("filters out candidates below threshold", async () => {
    const results = [
      makeSearchResult(50, "Very similar", "open", 0.1),   // 90% similarity
      makeSearchResult(51, "Somewhat similar", "open", 0.3), // 70% similarity - below 75%
      makeSearchResult(52, "Not similar", "open", 0.6),     // 40% similarity
    ];

    const candidates = await findDuplicateCandidates({
      ...baseParams,
      issueStore: createMockIssueStore(results),
      embeddingProvider: createMockEmbeddingProvider(),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].issueNumber).toBe(50);
    expect(candidates[0].similarityPct).toBe(90);
  });

  it("respects maxCandidates limit", async () => {
    const results = [
      makeSearchResult(50, "Issue A", "open", 0.05),
      makeSearchResult(51, "Issue B", "open", 0.08),
      makeSearchResult(52, "Issue C", "open", 0.10),
      makeSearchResult(53, "Issue D", "open", 0.12),
    ];

    const candidates = await findDuplicateCandidates({
      ...baseParams,
      maxCandidates: 2,
      issueStore: createMockIssueStore(results),
      embeddingProvider: createMockEmbeddingProvider(),
    });

    expect(candidates).toHaveLength(2);
  });

  it("converts distance to similarity percentage correctly", async () => {
    const results = [
      makeSearchResult(50, "Issue A", "open", 0.15), // (1 - 0.15) * 100 = 85
      makeSearchResult(51, "Issue B", "open", 0.25), // (1 - 0.25) * 100 = 75
    ];

    const candidates = await findDuplicateCandidates({
      ...baseParams,
      issueStore: createMockIssueStore(results),
      embeddingProvider: createMockEmbeddingProvider(),
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0].similarityPct).toBe(85);
    expect(candidates[1].similarityPct).toBe(75);
  });
});
