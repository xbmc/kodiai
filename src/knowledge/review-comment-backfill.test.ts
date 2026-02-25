import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  backfillReviewComments,
  syncSinglePR,
  groupCommentsIntoThreads,
  type BackfillOptions,
} from "./review-comment-backfill.ts";
import type { ReviewCommentChunk, ReviewCommentStore, SyncState } from "./review-comment-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { Logger } from "pino";

// ── Mock helpers ────────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  } as unknown as Logger;
}

function createMockEmbeddingProvider(opts?: { shouldFail?: boolean }): EmbeddingProvider {
  return {
    async generate(_text: string, _inputType: "document" | "query") {
      if (opts?.shouldFail) return null;
      return {
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        model: "voyage-code-3",
        dimensions: 1024,
      };
    },
    get model() {
      return "voyage-code-3";
    },
    get dimensions() {
      return 1024;
    },
  };
}

function createMockStore(overrides?: Partial<ReviewCommentStore>): ReviewCommentStore & {
  writtenChunks: ReviewCommentChunk[];
  syncStates: SyncState[];
} {
  const writtenChunks: ReviewCommentChunk[] = [];
  const syncStates: SyncState[] = [];

  return {
    writtenChunks,
    syncStates,
    writeChunks: mock(async (chunks: ReviewCommentChunk[]) => {
      writtenChunks.push(...chunks);
    }),
    softDelete: mock(async () => {}),
    updateChunks: mock(async () => {}),
    searchByEmbedding: mock(async () => []),
    getThreadComments: mock(async () => []),
    getSyncState: mock(async () => null),
    updateSyncState: mock(async (state: SyncState) => {
      syncStates.push(state);
    }),
    getLatestCommentDate: mock(async () => null),
    countByRepo: mock(async () => 0),
    ...overrides,
  };
}

function makeGitHubComment(opts: {
  id: number;
  body: string;
  login?: string;
  userType?: string;
  pullRequestUrl?: string;
  path?: string;
  inReplyToId?: number;
  pullRequestReviewId?: number | null;
  createdAt?: string;
}) {
  return {
    id: opts.id,
    pull_request_review_id: opts.pullRequestReviewId ?? null,
    in_reply_to_id: opts.inReplyToId,
    diff_hunk: "@@ -1,5 +1,5 @@",
    path: opts.path ?? "src/main.ts",
    original_position: 1,
    position: 1,
    body: opts.body,
    created_at: opts.createdAt ?? "2025-06-15T10:00:00Z",
    updated_at: opts.createdAt ?? "2025-06-15T10:00:00Z",
    user: {
      login: opts.login ?? "reviewer1",
      type: opts.userType ?? "User",
    },
    author_association: "MEMBER",
    pull_request_url: opts.pullRequestUrl ?? "https://api.github.com/repos/xbmc/xbmc/pulls/100",
  };
}

function createMockOctokit(pages: Record<number, ReturnType<typeof makeGitHubComment>[]>) {
  return {
    rest: {
      pulls: {
        listReviewCommentsForRepo: mock(async (params: { page: number }) => {
          const data = pages[params.page] ?? [];
          return {
            data,
            headers: {
              "x-ratelimit-remaining": "4500",
              "x-ratelimit-limit": "5000",
            },
          };
        }),
        listReviewComments: mock(async (params: { page: number }) => {
          const data = pages[params.page] ?? [];
          return {
            data,
            headers: {
              "x-ratelimit-remaining": "4500",
              "x-ratelimit-limit": "5000",
            },
          };
        }),
      },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("groupCommentsIntoThreads", () => {
  const botLogins = new Set(["dependabot", "kodiai"]);

  it("groups standalone comments as single-comment threads", () => {
    const comments = [
      makeGitHubComment({ id: 1, body: "Good refactor", login: "alice" }),
      makeGitHubComment({ id: 2, body: "Needs test", login: "bob", path: "src/other.ts" }),
    ];

    const threads = groupCommentsIntoThreads(comments as any, "xbmc/xbmc", botLogins);
    expect(threads.length).toBe(2);
    expect(threads[0]!.length).toBe(1);
    expect(threads[1]!.length).toBe(1);
  });

  it("groups reply chains together", () => {
    const comments = [
      makeGitHubComment({ id: 10, body: "This is wrong" }),
      makeGitHubComment({ id: 11, body: "I agree", inReplyToId: 10 }),
      makeGitHubComment({ id: 12, body: "Fixed", inReplyToId: 10 }),
    ];

    const threads = groupCommentsIntoThreads(comments as any, "xbmc/xbmc", botLogins);
    expect(threads.length).toBe(1);
    expect(threads[0]!.length).toBe(3);
  });

  it("filters out bot comments", () => {
    const comments = [
      makeGitHubComment({ id: 1, body: "Human review", login: "alice" }),
      makeGitHubComment({ id: 2, body: "Bot comment", login: "dependabot", userType: "Bot" }),
      makeGitHubComment({ id: 3, body: "Another bot", login: "someapp[bot]" }),
    ];

    const threads = groupCommentsIntoThreads(comments as any, "xbmc/xbmc", botLogins);
    expect(threads.length).toBe(1);
    expect(threads[0]![0]!.authorLogin).toBe("alice");
  });

  it("extracts PR number from pull_request_url", () => {
    const comments = [
      makeGitHubComment({
        id: 1,
        body: "Review",
        pullRequestUrl: "https://api.github.com/repos/xbmc/xbmc/pulls/42",
      }),
    ];

    const threads = groupCommentsIntoThreads(comments as any, "xbmc/xbmc", new Set());
    expect(threads[0]![0]!.prNumber).toBe(42);
  });
});

describe("backfillReviewComments", () => {
  let logger: Logger;
  let store: ReturnType<typeof createMockStore>;
  let embeddingProvider: EmbeddingProvider;

  beforeEach(() => {
    logger = createMockLogger();
    store = createMockStore();
    embeddingProvider = createMockEmbeddingProvider();
  });

  it("processes pages of comments and stores chunks", async () => {
    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({ id: 1, body: "Looks good to me" }),
        makeGitHubComment({ id: 2, body: "Please add tests" }),
      ],
    });

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.pagesProcessed).toBe(1);
    expect(result.totalComments).toBeGreaterThan(0);
    expect(result.totalChunks).toBeGreaterThan(0);
    expect(store.writtenChunks.length).toBeGreaterThan(0);
  });

  it("resumes from sync state", async () => {
    const resumeStore = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-09-01T00:00:00Z"),
        lastPageCursor: "5",
        totalCommentsSynced: 200,
        backfillComplete: false,
        updatedAt: "2025-09-01",
      })),
    });

    const octokit = createMockOctokit({
      1: [makeGitHubComment({ id: 100, body: "New comment" })],
    });

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store: resumeStore,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.resumed).toBe(true);
    // totalComments should include the resumed count
    expect(result.totalComments).toBeGreaterThanOrEqual(200);
  });

  it("skips if backfill already complete", async () => {
    const completeStore = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-09-01T00:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-09-01",
      })),
    });

    const octokit = createMockOctokit({});

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store: completeStore,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.resumed).toBe(true);
    expect(result.pagesProcessed).toBe(0);
  });

  it("skips bot comments during backfill", async () => {
    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({ id: 1, body: "Human review", login: "alice" }),
        makeGitHubComment({ id: 2, body: "Bot auto-merge", login: "dependabot", userType: "Bot" }),
        makeGitHubComment({ id: 3, body: "Coverage report", login: "codecov[bot]" }),
      ],
    });

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    // Only the human comment should produce chunks
    expect(store.writtenChunks.length).toBe(1);
    expect(store.writtenChunks[0]!.authorLogin).toBe("alice");
  });

  it("handles rate limit headers with delay", async () => {
    const octokit = {
      rest: {
        pulls: {
          listReviewCommentsForRepo: mock(async () => ({
            data: [makeGitHubComment({ id: 1, body: "Test" })],
            headers: {
              "x-ratelimit-remaining": "100",
              "x-ratelimit-limit": "5000",
            },
          })),
        },
      },
    };

    // This should add delay due to low rate limit, but still complete
    const result = await backfillReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.pagesProcessed).toBe(1);
    // The warn log should have been called about low rate limit
    expect(logger.warn).toHaveBeenCalled();
  });

  it("handles empty pages (end of pagination)", async () => {
    const octokit = createMockOctokit({
      1: [], // empty first page
    });

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.pagesProcessed).toBe(1);
    expect(result.totalChunks).toBe(0);
  });

  it("handles embedding failures with fail-open", async () => {
    const failProvider = createMockEmbeddingProvider({ shouldFail: true });

    const octokit = createMockOctokit({
      1: [makeGitHubComment({ id: 1, body: "Review comment" })],
    });

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider: failProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    // Chunks should still be stored even though embeddings failed
    expect(store.writtenChunks.length).toBe(1);
    expect(result.totalEmbeddings).toBe(0);
  });

  it("does not write chunks in dry-run mode", async () => {
    const octokit = createMockOctokit({
      1: [makeGitHubComment({ id: 1, body: "Review" })],
    });

    const result = await backfillReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
      dryRun: true,
    });

    expect(result.totalChunks).toBeGreaterThan(0);
    expect(store.writtenChunks.length).toBe(0);
  });
});

describe("syncSinglePR", () => {
  it("fetches and processes one PR's comments", async () => {
    const logger = createMockLogger();
    const store = createMockStore();
    const embeddingProvider = createMockEmbeddingProvider();

    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({
          id: 1,
          body: "Great work on this PR",
          pullRequestUrl: "https://api.github.com/repos/xbmc/xbmc/pulls/42",
        }),
        makeGitHubComment({
          id: 2,
          body: "I agree, well done",
          inReplyToId: 1,
          pullRequestUrl: "https://api.github.com/repos/xbmc/xbmc/pulls/42",
        }),
      ],
    });

    const result = await syncSinglePR({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      prNumber: 42,
      logger,
    });

    expect(result.chunksWritten).toBeGreaterThan(0);
    expect(store.writtenChunks.length).toBeGreaterThan(0);
  });

  it("handles PR with no comments", async () => {
    const logger = createMockLogger();
    const store = createMockStore();
    const embeddingProvider = createMockEmbeddingProvider();

    const octokit = createMockOctokit({ 1: [] });

    const result = await syncSinglePR({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      prNumber: 99,
      logger,
    });

    expect(result.chunksWritten).toBe(0);
  });
});
