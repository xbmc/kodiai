import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { searchIssues } from "./issue-retrieval.ts";
import type { IssueSearchResult, IssueStore } from "./issue-types.ts";
import type { EmbeddingProvider, EmbeddingResult } from "./types.ts";

function createMockLogger(): Logger {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: "silent",
  } as unknown as Logger;

  return logger;
}

function createEmbeddingProvider(opts: { returnNull?: boolean } = {}): EmbeddingProvider {
  return {
    async generate(): Promise<EmbeddingResult> {
      if (opts.returnNull) return null;
      return {
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        model: "test-model",
        dimensions: 3,
      };
    },
    get model() {
      return "test-model";
    },
    get dimensions() {
      return 3;
    },
  };
}

function makeIssueResult(overrides: Partial<{
  distance: number;
  body: string | null;
  issueNumber: number;
  title: string;
  state: string;
  repo: string;
  authorLogin: string;
  githubCreatedAt: string;
}> = {}): IssueSearchResult {
  const body = Object.prototype.hasOwnProperty.call(overrides, "body")
    ? overrides.body
    : "Issue body";

  return {
    distance: overrides.distance ?? 0.2,
    record: {
      id: 1,
      createdAt: "2025-01-01T00:00:00Z",
      repo: overrides.repo ?? "owner/repo",
      owner: "owner",
      issueNumber: overrides.issueNumber ?? 42,
      title: overrides.title ?? "Fix crash",
      body,
      state: overrides.state ?? "open",
      authorLogin: overrides.authorLogin ?? "alice",
      authorAssociation: "MEMBER",
      labelNames: [],
      templateSlug: null,
      commentCount: 0,
      assignees: [],
      milestone: null,
      reactionCount: 0,
      isPullRequest: false,
      locked: false,
      embedding: null,
      embeddingModel: "test-model",
      githubCreatedAt: overrides.githubCreatedAt ?? "2025-01-02T00:00:00Z",
      githubUpdatedAt: null,
      closedAt: null,
    },
  };
}

function createStore(results: IssueSearchResult[]): IssueStore {
  return {
    async upsert() {},
    async delete() {},
    async getByNumber() {
      return null;
    },
    async searchByEmbedding() {
      return results;
    },
    async searchByFullText() {
      return [];
    },
    async findSimilar() {
      return [];
    },
    async countByRepo() {
      return 0;
    },
    async upsertComment() {},
    async deleteComment() {},
    async getCommentsByIssue() {
      return [];
    },
    async searchCommentsByEmbedding() {
      return [];
    },
  };
}

describe("searchIssues", () => {
  test("returns empty array when embedding generation returns null", async () => {
    const matches = await searchIssues({
      store: createStore([makeIssueResult()]),
      embeddingProvider: createEmbeddingProvider({ returnNull: true }),
      query: "crash",
      repo: "owner/repo",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(matches).toEqual([]);
  });

  test("filters by threshold and maps metadata into issue matches", async () => {
    const matches = await searchIssues({
      store: createStore([
        makeIssueResult({ distance: 0.25, issueNumber: 12, title: "Keep me", body: "Relevant body" }),
        makeIssueResult({ distance: 0.8, issueNumber: 13, title: "Drop me" }),
      ]),
      embeddingProvider: createEmbeddingProvider(),
      query: "relevant issue",
      repo: "owner/repo",
      topK: 5,
      distanceThreshold: 0.3,
      stateFilter: "open",
      logger: createMockLogger(),
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      distance: 0.25,
      repo: "owner/repo",
      issueNumber: 12,
      title: "Keep me",
      state: "open",
      authorLogin: "alice",
      githubCreatedAt: "2025-01-02T00:00:00Z",
      source: "issue",
    });
    expect(matches[0]?.chunkText).toBe("#12 Keep me\n\nRelevant body");
  });

  test("truncates bodies to exactly 2000 characters and handles missing or empty bodies", async () => {
    const matches = await searchIssues({
      store: createStore([
        makeIssueResult({ issueNumber: 21, title: "Long", body: "x".repeat(2100) }),
        makeIssueResult({ issueNumber: 22, title: "Missing", body: null, distance: 0.3 }),
        makeIssueResult({ issueNumber: 23, title: "Empty", body: "", distance: 0.4 }),
      ]),
      embeddingProvider: createEmbeddingProvider(),
      query: "body mapping",
      repo: "owner/repo",
      topK: 5,
      distanceThreshold: 0.5,
      logger: createMockLogger(),
    });

    expect(matches).toHaveLength(3);
    expect(matches[0]?.chunkText).toBe(`#21 Long\n\n${"x".repeat(2000)}`);
    expect(matches[0]?.chunkText.length).toBe(2010);
    expect(matches[1]?.chunkText).toBe("#22 Missing\n\n");
    expect(matches[2]?.chunkText).toBe("#23 Empty\n\n");
  });
});
