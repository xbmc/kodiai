import { describe, test, expect } from "bun:test";
import {
  truncateIssueBody,
  selectTailComments,
  computeBudgetDistribution,
  assembleIssueThread,
} from "./thread-assembler.ts";
import type { IssueCommentRecord, IssueStore } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";

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

function makeComment(overrides: Partial<IssueCommentRecord> = {}): IssueCommentRecord {
  return {
    id: 1,
    createdAt: "2025-01-01T00:00:00Z",
    repo: "owner/repo",
    issueNumber: 42,
    commentGithubId: 1000,
    authorLogin: "alice",
    authorAssociation: "NONE",
    body: "Default comment body",
    embedding: null,
    embeddingModel: null,
    githubCreatedAt: "2025-01-01T00:00:00Z",
    githubUpdatedAt: null,
    ...overrides,
  };
}

function makeEmbedding(seed: number = 42): Float32Array {
  const arr = new Float32Array(8);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = ((seed * (i + 1) * 7919) % 1000) / 1000;
  }
  return arr;
}

describe("truncateIssueBody", () => {
  test("returns short body unchanged", () => {
    const body = "This is a short bug report.";
    expect(truncateIssueBody(body)).toBe(body);
  });

  test("truncates long body to first and last paragraph", () => {
    const paragraphs = [
      "First paragraph about the bug.",
      "Second paragraph with more details about the reproduction steps.",
      "Third paragraph discussing the environment.",
      "Fourth paragraph with expected vs actual behavior and the fix that was applied.",
    ];
    const body = paragraphs.join("\n\n");
    const result = truncateIssueBody(body, 100);
    expect(result).toContain(paragraphs[0]);
    expect(result).toContain("[...]");
    expect(result).toContain(paragraphs[3]);
    expect(result).not.toContain(paragraphs[1]);
  });

  test("hard truncates when only 1-2 paragraphs", () => {
    const body = "A".repeat(600);
    const result = truncateIssueBody(body);
    expect(result.length).toBeLessThanOrEqual(504); // 500 + "..."
    expect(result).toEndWith("...");
  });

  test("handles empty body", () => {
    expect(truncateIssueBody("")).toBe("");
  });

  test("respects custom maxChars", () => {
    const body = "A".repeat(300);
    const result = truncateIssueBody(body, 200);
    expect(result.length).toBeLessThanOrEqual(204); // 200 + "..."
    expect(result).toEndWith("...");
  });
});

describe("selectTailComments", () => {
  const comments: IssueCommentRecord[] = [
    makeComment({ commentGithubId: 1, body: "a".repeat(100), githubCreatedAt: "2025-01-01T01:00:00Z" }),
    makeComment({ commentGithubId: 2, body: "b".repeat(200), githubCreatedAt: "2025-01-01T02:00:00Z" }),
    makeComment({ commentGithubId: 3, body: "c".repeat(300), githubCreatedAt: "2025-01-01T03:00:00Z" }),
    makeComment({ commentGithubId: 4, body: "d".repeat(150), githubCreatedAt: "2025-01-01T04:00:00Z" }),
    makeComment({ commentGithubId: 5, body: "e".repeat(250), githubCreatedAt: "2025-01-01T05:00:00Z" }),
  ];

  test("selects last comments within budget", () => {
    const result = selectTailComments(comments, 500);
    // Last 2: 250 + 150 = 400 <= 500. Next would be 300 more = 700 > 500
    expect(result.selected.length).toBe(2);
    expect(result.selected[0]!.commentGithubId).toBe(4);
    expect(result.selected[1]!.commentGithubId).toBe(5);
    expect(result.charsUsed).toBe(400);
  });

  test("returns all comments if budget allows", () => {
    const result = selectTailComments(comments, 5000);
    expect(result.selected.length).toBe(5);
    expect(result.remaining.length).toBe(0);
    expect(result.charsUsed).toBe(1000);
  });

  test("returns empty when budget is 0", () => {
    const result = selectTailComments(comments, 0);
    expect(result.selected.length).toBe(0);
    expect(result.remaining.length).toBe(5);
    expect(result.charsUsed).toBe(0);
  });

  test("handles empty comments array", () => {
    const result = selectTailComments([], 1000);
    expect(result.selected.length).toBe(0);
    expect(result.remaining.length).toBe(0);
    expect(result.charsUsed).toBe(0);
  });

  test("maintains chronological order", () => {
    const result = selectTailComments(comments, 500);
    // Should be in chronological order (4 before 5)
    expect(result.selected[0]!.commentGithubId).toBe(4);
    expect(result.selected[1]!.commentGithubId).toBe(5);
  });

  test("remaining excludes selected", () => {
    const result = selectTailComments(comments, 500);
    const selectedIds = new Set(result.selected.map((c) => c.commentGithubId));
    for (const r of result.remaining) {
      expect(selectedIds.has(r.commentGithubId)).toBe(false);
    }
    expect(result.selected.length + result.remaining.length).toBe(comments.length);
  });
});

describe("computeBudgetDistribution", () => {
  test("returns empty for no matches", () => {
    expect(computeBudgetDistribution([], 12000)).toEqual([]);
  });

  test("returns full budget for single match", () => {
    expect(computeBudgetDistribution([{ distance: 0.2 }], 12000)).toEqual([12000]);
  });

  test("distributes proportionally by similarity", () => {
    const result = computeBudgetDistribution(
      [{ distance: 0.2 }, { distance: 0.4 }],
      12000,
    );
    // sim 0.8 and 0.6, total 1.4
    // first: floor(0.8/1.4 * 12000) = floor(6857.14) = 6857
    // second: floor(0.6/1.4 * 12000) = floor(5142.86) = 5142
    expect(result[0]).toBe(6857);
    expect(result[1]).toBe(5142);
    expect(result[0]! > result[1]!).toBe(true);
  });

  test("handles equal distances", () => {
    const result = computeBudgetDistribution(
      [{ distance: 0.3 }, { distance: 0.3 }, { distance: 0.3 }],
      12000,
    );
    const even = Math.floor(12000 / 3);
    expect(result[0]).toBe(even);
    expect(result[1]).toBe(even);
    expect(result[2]).toBe(even);
  });
});

describe("assembleIssueThread", () => {
  const mockEmbedding = makeEmbedding();

  function createMockIssueStore(overrides: Partial<IssueStore> = {}): IssueStore {
    return {
      upsert: async () => {},
      delete: async () => {},
      getByNumber: async () => ({
        id: 1,
        createdAt: "2025-01-01",
        repo: "owner/repo",
        owner: "owner",
        issueNumber: 42,
        title: "Test Issue",
        body: "Short body",
        state: "closed",
        authorLogin: "alice",
        authorAssociation: "NONE",
        labelNames: [],
        templateSlug: null,
        commentCount: 3,
        assignees: [],
        milestone: null,
        reactionCount: 0,
        isPullRequest: false,
        locked: false,
        embedding: null,
        embeddingModel: null,
        githubCreatedAt: "2025-01-01",
        githubUpdatedAt: null,
        closedAt: "2025-01-15",
      }),
      searchByEmbedding: async () => [],
      searchByFullText: async () => [],
      findSimilar: async () => [],
      countByRepo: async () => 0,
      upsertComment: async () => {},
      deleteComment: async () => {},
      getCommentsByIssue: async () => [
        makeComment({ commentGithubId: 10, body: "First comment", githubCreatedAt: "2025-01-02T00:00:00Z" }),
        makeComment({ commentGithubId: 11, body: "Middle comment with details", githubCreatedAt: "2025-01-03T00:00:00Z" }),
        makeComment({ commentGithubId: 12, body: "Final fix applied here", githubCreatedAt: "2025-01-04T00:00:00Z" }),
      ],
      searchCommentsByEmbedding: async () => [
        {
          record: makeComment({ commentGithubId: 10, body: "First comment" }),
          distance: 0.1,
        },
      ],
      ...overrides,
    };
  }

  const mockEmbeddingProvider: EmbeddingProvider = {
    generate: async () => ({ embedding: mockEmbedding, model: "test", dimensions: 8 }),
    model: "test",
    dimensions: 8,
  };

  test("assembles thread with tail + semantic comments", async () => {
    const store = createMockIssueStore();
    const result = await assembleIssueThread({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      issueNumber: 42,
      queryEmbedding: mockEmbedding,
      charBudget: 5000,
      logger: mockLogger,
    });

    expect(result.issueNumber).toBe(42);
    expect(result.title).toBe("Test Issue");
    expect(result.body).toBe("Short body");
    expect(result.tailComments.length).toBeGreaterThan(0);
    expect(result.totalChars).toBeGreaterThan(0);
  });

  test("handles issue with no comments", async () => {
    const store = createMockIssueStore({
      getCommentsByIssue: async () => [],
    });

    const result = await assembleIssueThread({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      issueNumber: 42,
      queryEmbedding: mockEmbedding,
      charBudget: 5000,
      logger: mockLogger,
    });

    expect(result.tailComments).toEqual([]);
    expect(result.semanticComments).toEqual([]);
    expect(result.body).toBe("Short body");
  });

  test("handles issue with body exceeding 500 chars", async () => {
    const longBody = "A".repeat(600);
    const store = createMockIssueStore({
      getByNumber: async () => ({
        id: 1, createdAt: "2025-01-01", repo: "owner/repo", owner: "owner",
        issueNumber: 42, title: "Test", body: longBody, state: "closed",
        authorLogin: "alice", authorAssociation: "NONE", labelNames: [],
        templateSlug: null, commentCount: 0, assignees: [], milestone: null,
        reactionCount: 0, isPullRequest: false, locked: false,
        embedding: null, embeddingModel: null,
        githubCreatedAt: "2025-01-01", githubUpdatedAt: null, closedAt: null,
      }),
      getCommentsByIssue: async () => [],
    });

    const result = await assembleIssueThread({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      issueNumber: 42,
      queryEmbedding: mockEmbedding,
      charBudget: 5000,
      logger: mockLogger,
    });

    expect(result.body.length).toBeLessThan(600);
  });

  test("respects character budget", async () => {
    const store = createMockIssueStore();
    const result = await assembleIssueThread({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      issueNumber: 42,
      queryEmbedding: mockEmbedding,
      charBudget: 5000,
      logger: mockLogger,
    });

    expect(result.totalChars).toBeLessThanOrEqual(5000);
  });
});
