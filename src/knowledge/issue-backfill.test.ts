import { describe, expect, it, mock, beforeEach } from "bun:test";
import { backfillIssues, backfillIssueComments, getIssueSyncState, updateIssueSyncState } from "./issue-backfill.ts";
import type { IssueBackfillOptions } from "./issue-backfill.ts";
import type { EmbeddingProvider } from "./types.ts";

// ── Mock factories ──────────────────────────────────────────────────────────

function createMockOctokit(issuePages: Record<string, unknown>[][], commentPages: Record<string, unknown>[][] = []) {
  let issuePage = 0;
  let commentPage = 0;

  return {
    rest: {
      issues: {
        listForRepo: mock(async () => {
          const data = issuePages[issuePage] ?? [];
          issuePage++;
          return {
            data,
            headers: {
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-limit": "5000",
            },
          };
        }),
        listCommentsForRepo: mock(async () => {
          const data = commentPages[commentPage] ?? [];
          commentPage++;
          return {
            data,
            headers: {
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-limit": "5000",
            },
          };
        }),
      },
    },
  } as unknown as import("@octokit/rest").Octokit;
}

function createMockStore() {
  return {
    upsert: mock(async () => {}),
    upsertComment: mock(async () => {}),
    getByNumber: mock(async (_repo: string, _issueNumber: number) => ({
      title: "Cached Issue Title",
    })),
    delete: mock(async () => {}),
    searchByEmbedding: mock(async () => []),
    searchByFullText: mock(async () => []),
    findSimilar: mock(async () => []),
    countByRepo: mock(async () => 0),
    deleteComment: mock(async () => {}),
    getCommentsByIssue: mock(async () => []),
    searchCommentsByEmbedding: mock(async () => []),
  };
}

function createMockEmbeddingProvider(shouldFail = false): EmbeddingProvider {
  return {
    generate: mock(async () => {
      if (shouldFail) return null;
      return {
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        model: "voyage-code-3",
        dimensions: 3,
      };
    }),
    get model() { return "voyage-code-3"; },
    get dimensions() { return 3; },
  };
}

function createMockSql() {
  const syncStates = new Map<string, Record<string, unknown>>();

  const sqlFn = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");

    if (query.includes("SELECT") && query.includes("issue_sync_state")) {
      const repo = values[0] as string;
      const state = syncStates.get(repo);
      return state ? [state] : [];
    }

    if (query.includes("INSERT INTO issue_sync_state")) {
      const repo = values[0] as string;
      syncStates.set(repo, {
        repo,
        last_synced_at: values[1],
        last_page_cursor: values[2],
        total_issues_synced: values[3],
        total_comments_synced: values[4],
        backfill_complete: values[5],
      });
      return [];
    }

    return [];
  });

  // Expose for test inspection
  (sqlFn as Record<string, unknown>)._syncStates = syncStates;
  return sqlFn;
}

function makeIssueItem(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Test issue",
    body: "Issue body",
    state: "open",
    user: { login: "octocat", id: 1 },
    author_association: "CONTRIBUTOR",
    labels: [{ name: "bug" }],
    assignees: [{ id: 1, login: "octocat" }],
    milestone: null,
    reactions: { total_count: 0 },
    locked: false,
    comments: 2,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    closed_at: null,
    pull_request: undefined,
    ...overrides,
  };
}

function makeCommentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    body: "This is a comment",
    user: { login: "octocat" },
    author_association: "CONTRIBUTOR",
    issue_url: "https://api.github.com/repos/xbmc/xbmc/issues/42",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as import("pino").Logger;

describe("backfillIssues", () => {
  it("filters out pull requests", async () => {
    const items = [
      makeIssueItem({ number: 1 }),
      makeIssueItem({ number: 2, pull_request: { url: "https://..." } }),
      makeIssueItem({ number: 3 }),
    ];

    const octokit = createMockOctokit([items]);
    const store = createMockStore();
    const sql = createMockSql();

    const result = await backfillIssues({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    // Should only upsert issues 1 and 3, not the PR
    expect(store.upsert).toHaveBeenCalledTimes(2);
    expect(result.totalIssues).toBe(2);
  });

  it("persists sync state after each page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeIssueItem({ number: i + 1 }));
    const page2 = [makeIssueItem({ number: 101 })];

    const octokit = createMockOctokit([page1, page2]);
    const store = createMockStore();
    const sql = createMockSql();

    await backfillIssues({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    // sql should be called for sync state: page 1, page 2, and final complete
    const syncCalls = sql.mock.calls.filter((call: unknown[]) => {
      const tpl = call[0] as TemplateStringsArray;
      return tpl.join("?").includes("INSERT INTO issue_sync_state");
    });
    expect(syncCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("resumes from existing sync state", async () => {
    const octokit = createMockOctokit([[makeIssueItem({ number: 50 })]]);
    const store = createMockStore();
    const sql = createMockSql();

    // Pre-populate sync state
    const syncStates = (sql as Record<string, unknown>)._syncStates as Map<string, Record<string, unknown>>;
    syncStates.set("xbmc/xbmc", {
      repo: "xbmc/xbmc",
      last_synced_at: new Date("2024-06-01T00:00:00Z"),
      last_page_cursor: "5",
      total_issues_synced: 100,
      total_comments_synced: 50,
      backfill_complete: false,
    });

    const result = await backfillIssues({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    expect(result.resumed).toBe(true);
    // Should pass `since` to the API (verified by the octokit mock receiving it)
    const listCall = octokit.rest.issues.listForRepo.mock.calls[0]![0] as Record<string, unknown>;
    expect(listCall.since).toBe("2024-06-01T00:00:00.000Z");
  });

  it("handles embedding failures (fail-open)", async () => {
    const items = [makeIssueItem({ number: 1 }), makeIssueItem({ number: 2 })];
    const octokit = createMockOctokit([items]);
    const store = createMockStore();
    const sql = createMockSql();

    const result = await backfillIssues({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(true), // fail-open
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    // Should still upsert both issues even with failed embeddings
    expect(store.upsert).toHaveBeenCalledTimes(2);
    expect(result.failedEmbeddings).toBe(2);
    expect(result.totalEmbeddings).toBe(0);
  });
});

describe("backfillIssueComments", () => {
  it("skips bot comments", async () => {
    const comments = [
      makeCommentItem({ id: 1, user: { login: "octocat" } }),
      makeCommentItem({ id: 2, user: { login: "kodi-butler" } }),
      makeCommentItem({ id: 3, user: { login: "stale" } }),
      makeCommentItem({ id: 4, user: { login: "dependabot[bot]" } }),
      makeCommentItem({ id: 5, user: { login: "human-dev" } }),
    ];

    const octokit = createMockOctokit([], [comments]);
    const store = createMockStore();
    const sql = createMockSql();

    // Need sync state for the since param
    const syncStates = (sql as Record<string, unknown>)._syncStates as Map<string, Record<string, unknown>>;
    syncStates.set("xbmc/xbmc", {
      repo: "xbmc/xbmc",
      last_synced_at: null,
      last_page_cursor: null,
      total_issues_synced: 0,
      total_comments_synced: 0,
      backfill_complete: false,
    });

    const result = await backfillIssueComments({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    // Only octocat and human-dev should be processed
    expect(result.totalComments).toBe(2);
    expect(store.upsertComment).toHaveBeenCalledTimes(2);
  });

  it("extracts issue number from issue_url", async () => {
    const comments = [
      makeCommentItem({
        id: 1,
        issue_url: "https://api.github.com/repos/xbmc/xbmc/issues/12345",
      }),
    ];

    const octokit = createMockOctokit([], [comments]);
    const store = createMockStore();
    const sql = createMockSql();

    await backfillIssueComments({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    // The upsertComment call should have issueNumber 12345
    const call = store.upsertComment.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.issueNumber).toBe(12345);
  });

  it("looks up issue title for embedding context", async () => {
    const comments = [makeCommentItem({ id: 1 })];
    const octokit = createMockOctokit([], [comments]);
    const store = createMockStore();
    const sql = createMockSql();

    await backfillIssueComments({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    // Should have called getByNumber to look up the title
    expect(store.getByNumber).toHaveBeenCalledTimes(1);
  });
});

describe("adaptiveRateDelay", () => {
  it("respects low remaining budget by not crashing", async () => {
    // This is implicitly tested through the backfill functions
    // The rate delay is internal but we verify the overall flow works
    const items = [makeIssueItem({ number: 1 })];
    const octokit = createMockOctokit([items]);
    (octokit.rest.issues.listForRepo as ReturnType<typeof mock>).mockImplementation(async () => ({
      data: items,
      headers: {
        "x-ratelimit-remaining": "50",
        "x-ratelimit-limit": "5000",
      },
    }));

    const store = createMockStore();
    const sql = createMockSql();

    // Should complete without errors
    const result = await backfillIssues({
      octokit,
      store: store as unknown as import("./issue-types.ts").IssueStore,
      sql: sql as unknown as import("../db/client.ts").Sql,
      embeddingProvider: createMockEmbeddingProvider(),
      repo: "xbmc/xbmc",
      logger: mockLogger,
    });

    expect(result.totalIssues).toBe(1);
  });
});
