import { describe, it, expect, beforeEach, mock } from "bun:test";
import { catchUpReviewComments, type CatchUpSyncOptions, type CatchUpSyncResult } from "./review-comment-catchup.ts";
import type { ReviewCommentChunk, ReviewCommentRecord, ReviewCommentStore, SyncState } from "./review-comment-types.ts";
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
  updatedChunks: ReviewCommentChunk[];
  syncStates: SyncState[];
} {
  const writtenChunks: ReviewCommentChunk[] = [];
  const updatedChunks: ReviewCommentChunk[] = [];
  const syncStates: SyncState[] = [];

  return {
    writtenChunks,
    updatedChunks,
    syncStates,
    writeChunks: mock(async (chunks: ReviewCommentChunk[]) => {
      writtenChunks.push(...chunks);
    }),
    softDelete: mock(async () => {}),
    updateChunks: mock(async (chunks: ReviewCommentChunk[]) => {
      updatedChunks.push(...chunks);
    }),
    searchByEmbedding: mock(async () => []),
    searchByFullText: mock(async () => []),
    getThreadComments: mock(async () => []),
    getSyncState: mock(async () => null),
    updateSyncState: mock(async (state: SyncState) => {
      syncStates.push(state);
    }),
    getLatestCommentDate: mock(async () => null),
    countByRepo: mock(async () => 0),
    getNullEmbeddingChunks: mock(async () => []),
    updateEmbedding: mock(async () => {}),
    countNullEmbeddings: mock(async () => 0),
    getByGithubId: mock(async () => null),
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
  updatedAt?: string;
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
    updated_at: opts.updatedAt ?? opts.createdAt ?? "2025-06-15T10:00:00Z",
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
      },
    },
  };
}

function makeExistingRecord(opts: {
  commentGithubId: number;
  githubUpdatedAt: string | null;
}): ReviewCommentRecord {
  return {
    id: opts.commentGithubId * 10,
    createdAt: "2025-06-15T10:00:00Z",
    repo: "xbmc/xbmc",
    owner: "xbmc",
    prNumber: 100,
    prTitle: null,
    commentGithubId: opts.commentGithubId,
    threadId: `xbmc/xbmc:100:src/main.ts:1`,
    inReplyToId: null,
    filePath: "src/main.ts",
    startLine: null,
    endLine: null,
    diffHunk: "@@ -1,5 +1,5 @@",
    authorLogin: "reviewer1",
    authorAssociation: "MEMBER",
    body: "original body",
    chunkIndex: 0,
    chunkText: "original chunk text",
    tokenCount: 5,
    embedding: null,
    embeddingModel: null,
    stale: false,
    githubCreatedAt: "2025-06-15T10:00:00Z",
    githubUpdatedAt: opts.githubUpdatedAt,
    deleted: false,
    backfillBatch: null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("catchUpReviewComments", () => {
  let logger: Logger;
  let embeddingProvider: EmbeddingProvider;

  beforeEach(() => {
    logger = createMockLogger();
    embeddingProvider = createMockEmbeddingProvider();
  });

  it("returns early with zeroed result when backfillComplete is false", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "5",
        totalCommentsSynced: 100,
        backfillComplete: false,
        updatedAt: "2025-06-15",
      })),
    });

    const octokit = createMockOctokit({});

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.newComments).toBe(0);
    expect(result.updatedComments).toBe(0);
    expect(result.chunksWritten).toBe(0);
    expect(result.pagesProcessed).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // Should NOT have called the API
    expect(octokit.rest.pulls.listReviewCommentsForRepo).not.toHaveBeenCalled();
  });

  it("returns early with zeroed result when no sync state exists", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => null),
    });

    const octokit = createMockOctokit({});

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.newComments).toBe(0);
    expect(result.pagesProcessed).toBe(0);
    expect(octokit.rest.pulls.listReviewCommentsForRepo).not.toHaveBeenCalled();
  });

  it("fetches comments since lastSyncedAt and writes new ones via writeChunks", async () => {
    const lastSyncedAt = new Date("2025-06-15T10:00:00Z");
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt,
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      // All comments are new (not found in store)
      getByGithubId: mock(async () => null),
    });

    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({ id: 1001, body: "New review comment", createdAt: "2025-06-16T10:00:00Z", updatedAt: "2025-06-16T10:00:00Z" }),
        makeGitHubComment({ id: 1002, body: "Another new comment", createdAt: "2025-06-16T11:00:00Z", updatedAt: "2025-06-16T11:00:00Z", path: "src/other.ts" }),
      ],
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.newComments).toBe(2);
    expect(result.updatedComments).toBe(0);
    expect(result.chunksWritten).toBeGreaterThan(0);
    expect(result.pagesProcessed).toBe(1);
    expect(store.writtenChunks.length).toBeGreaterThan(0);
    // Verify the API was called with the since parameter
    const apiCall = (octokit.rest.pulls.listReviewCommentsForRepo as ReturnType<typeof mock>).mock.calls[0]![0] as Record<string, unknown>;
    expect(apiCall.since).toBe(lastSyncedAt.toISOString());
    expect(apiCall.sort).toBe("updated");
    expect(apiCall.direction).toBe("asc");
  });

  it("detects edited comments (github_updated_at differs) and calls updateChunks", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      // Comment exists but with older updated_at
      getByGithubId: mock(async (_repo: string, commentGithubId: number) => {
        if (commentGithubId === 2001) {
          return makeExistingRecord({
            commentGithubId: 2001,
            githubUpdatedAt: "2025-06-15T10:00:00Z",
          });
        }
        return null;
      }),
    });

    const octokit = createMockOctokit({
      1: [
        // This comment was edited (updated_at is newer than stored)
        makeGitHubComment({
          id: 2001,
          body: "Updated body after edit",
          createdAt: "2025-06-14T10:00:00Z",
          updatedAt: "2025-06-16T10:00:00Z",
        }),
      ],
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.updatedComments).toBe(1);
    expect(result.newComments).toBe(0);
    expect(store.updatedChunks.length).toBeGreaterThan(0);
    // writeChunks should NOT have been called for this comment
    expect(store.writtenChunks.length).toBe(0);
  });

  it("skips comments already stored with same github_updated_at", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      // Comment exists with SAME updated_at
      getByGithubId: mock(async () => {
        return makeExistingRecord({
          commentGithubId: 3001,
          githubUpdatedAt: "2025-06-15T10:00:00Z",
        });
      }),
    });

    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({
          id: 3001,
          body: "Unchanged comment",
          createdAt: "2025-06-14T10:00:00Z",
          updatedAt: "2025-06-15T10:00:00Z",
        }),
      ],
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.newComments).toBe(0);
    expect(result.updatedComments).toBe(0);
    expect(result.chunksWritten).toBe(0);
    // Neither writeChunks nor updateChunks should be called
    expect(store.writtenChunks.length).toBe(0);
    expect(store.updatedChunks.length).toBe(0);
  });

  it("updates sync state with latest comment date on completion", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      getByGithubId: mock(async () => null),
    });

    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({ id: 4001, body: "First", createdAt: "2025-06-16T10:00:00Z", updatedAt: "2025-06-16T10:00:00Z" }),
        makeGitHubComment({ id: 4002, body: "Second", createdAt: "2025-06-17T10:00:00Z", updatedAt: "2025-06-17T12:00:00Z", path: "src/other.ts" }),
      ],
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.newComments).toBe(2);
    // Sync state should be updated
    expect(store.syncStates.length).toBeGreaterThan(0);
    const lastState = store.syncStates[store.syncStates.length - 1]!;
    expect(lastState.backfillComplete).toBe(true);
    // lastSyncedAt should be the latest updated_at from comments
    expect(lastState.lastSyncedAt).toBeInstanceOf(Date);
    expect(lastState.lastSyncedAt!.toISOString()).toBe("2025-06-17T12:00:00.000Z");
  });

  it("uses withRetry for the API call", async () => {
    let apiCallCount = 0;
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      getByGithubId: mock(async () => null),
    });

    // Octokit that fails first call then succeeds
    const octokit = {
      rest: {
        pulls: {
          listReviewCommentsForRepo: mock(async () => {
            apiCallCount++;
            if (apiCallCount === 1) throw new Error("Rate limit exceeded");
            // Second call: return data, third call: return empty
            if (apiCallCount === 2) {
              return {
                data: [makeGitHubComment({ id: 5001, body: "After retry" })],
                headers: { "x-ratelimit-remaining": "4500", "x-ratelimit-limit": "5000" },
              };
            }
            return {
              data: [],
              headers: { "x-ratelimit-remaining": "4500", "x-ratelimit-limit": "5000" },
            };
          }),
        },
      },
    };

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    // The retry should have recovered
    expect(result.newComments).toBe(1);
    // API should have been called at least twice (initial fail + retry success)
    expect(apiCallCount).toBeGreaterThanOrEqual(2);
    // Logger should have warned about retry
    expect(logger.warn).toHaveBeenCalled();
  });

  it("isolates per-thread errors and continues processing", async () => {
    let writeCallCount = 0;
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      getByGithubId: mock(async () => null),
      writeChunks: mock(async () => {
        writeCallCount++;
        if (writeCallCount === 1) throw new Error("DB connection lost");
      }),
    });

    // Two comments on different files = two threads
    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({ id: 6001, body: "First thread", login: "alice", path: "src/a.ts" }),
        makeGitHubComment({ id: 6002, body: "Second thread", login: "bob", path: "src/b.ts" }),
      ],
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    // Both threads attempted
    expect(writeCallCount).toBe(2);
    // One thread failed, one succeeded
    expect(result.newComments).toBe(1); // only successful thread counted
    // Error should have been logged
    expect(logger.error).toHaveBeenCalled();
  });

  it("paginates through multiple pages and stops on empty page", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      getByGithubId: mock(async () => null),
    });

    // Generate 100 comments for page 1 so pagination continues
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeGitHubComment({ id: 7000 + i, body: `Page 1 comment ${i}`, path: `src/p1-${i}.ts` }),
    );
    const page2 = [makeGitHubComment({ id: 7200, body: "Page 2 comment", path: "src/other.ts" })];

    const octokit = createMockOctokit({
      1: page1,
      2: page2,
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    expect(result.pagesProcessed).toBe(2); // page 1 (100 items, continues) + page 2 (< 100 items, stops)
    expect(result.newComments).toBe(101);
  });

  it("uses 24 hours ago as default when lastSyncedAt is null", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: null,
        lastPageCursor: null,
        totalCommentsSynced: 0,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      getByGithubId: mock(async () => null),
    });

    const octokit = createMockOctokit({
      1: [],
    });

    await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
    });

    // API should have been called with a since date roughly 24h ago
    const apiCall = (octokit.rest.pulls.listReviewCommentsForRepo as ReturnType<typeof mock>).mock.calls[0]![0] as Record<string, unknown>;
    const sinceDate = new Date(apiCall.since as string);
    const now = new Date();
    const diffHours = (now.getTime() - sinceDate.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(23);
    expect(diffHours).toBeLessThan(25);
  });

  it("does not write or update in dry-run mode", async () => {
    const store = createMockStore({
      getSyncState: mock(async () => ({
        id: 1,
        repo: "xbmc/xbmc",
        lastSyncedAt: new Date("2025-06-15T10:00:00Z"),
        lastPageCursor: "10",
        totalCommentsSynced: 500,
        backfillComplete: true,
        updatedAt: "2025-06-15",
      })),
      getByGithubId: mock(async () => null),
    });

    const octokit = createMockOctokit({
      1: [
        makeGitHubComment({ id: 8001, body: "New comment in dry run" }),
      ],
    });

    const result = await catchUpReviewComments({
      octokit: octokit as any,
      store,
      embeddingProvider,
      repo: "xbmc/xbmc",
      logger,
      dryRun: true,
    });

    expect(result.newComments).toBe(1);
    // Nothing should be persisted
    expect(store.writtenChunks.length).toBe(0);
    expect(store.updatedChunks.length).toBe(0);
    expect(store.syncStates.length).toBe(0);
  });
});
