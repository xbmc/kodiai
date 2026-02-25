import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createReviewCommentStore } from "./review-comment-store.ts";
import { createDbClient, type Sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import type { ReviewCommentStore, ReviewCommentChunk } from "./review-comment-types.ts";

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

function makeChunk(overrides: Partial<ReviewCommentChunk> = {}): ReviewCommentChunk {
  return {
    repo: "xbmc/xbmc",
    owner: "xbmc",
    prNumber: 42,
    prTitle: "Fix crash",
    commentGithubId: 1000,
    threadId: "xbmc/xbmc:42:src/main.cpp:10",
    inReplyToId: null,
    filePath: "src/main.cpp",
    startLine: 10,
    endLine: 15,
    diffHunk: "@@ -10,5 +10,8 @@",
    authorLogin: "alice",
    authorAssociation: "MEMBER",
    body: "This needs a null check.",
    chunkIndex: 0,
    chunkText: "@alice (2025-01-15): This needs a null check.",
    tokenCount: 8,
    githubCreatedAt: new Date("2025-01-15T10:00:00Z"),
    githubUpdatedAt: null,
    backfillBatch: null,
    ...overrides,
  };
}

function makeEmbedding(seed: number = 42): Float32Array {
  const arr = new Float32Array(1024);
  let val = seed;
  for (let i = 0; i < 1024; i++) {
    val = ((val * 1664525 + 1013904223) & 0xffffffff) >>> 0;
    arr[i] = (val / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < 1024; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1024; i++) arr[i] = arr[i]! / norm;
  return arr;
}

describe("ReviewCommentStore (pgvector)", () => {
  let sql: Sql;
  let store: ReviewCommentStore;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    const client = createDbClient({
      connectionString: "postgresql://kodiai:kodiai@localhost:5432/kodiai",
      logger: mockLogger,
    });
    sql = client.sql;
    closeDb = client.close;

    await runMigrations(sql);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await sql`DELETE FROM review_comments`;
    await sql`DELETE FROM review_comment_sync_state`;
    store = createReviewCommentStore({ sql, logger: mockLogger });
  });

  test("writeChunks stores and retrieves by thread", async () => {
    const chunk1 = makeChunk({ commentGithubId: 1, chunkIndex: 0 });
    const chunk2 = makeChunk({
      commentGithubId: 2,
      chunkIndex: 0,
      authorLogin: "bob",
      body: "Good point",
      chunkText: "@bob (2025-01-15): Good point",
      inReplyToId: 1,
    });

    await store.writeChunks([chunk1, chunk2]);

    const threadComments = await store.getThreadComments("xbmc/xbmc:42:src/main.cpp:10");
    expect(threadComments.length).toBe(2);
    expect(threadComments[0]!.authorLogin).toBe("alice");
    expect(threadComments[1]!.authorLogin).toBe("bob");
  });

  test("writeChunks is idempotent (re-run does not duplicate)", async () => {
    const chunk = makeChunk();

    await store.writeChunks([chunk]);
    await store.writeChunks([chunk]);

    const count = await store.countByRepo("xbmc/xbmc");
    expect(count).toBe(1);
  });

  test("softDelete marks comment as deleted", async () => {
    const chunk = makeChunk({ commentGithubId: 500 });
    await store.writeChunks([chunk]);

    let count = await store.countByRepo("xbmc/xbmc");
    expect(count).toBe(1);

    await store.softDelete("xbmc/xbmc", 500);

    count = await store.countByRepo("xbmc/xbmc");
    expect(count).toBe(0);

    // Record still exists in DB, just marked deleted
    const rows = await sql`
      SELECT deleted FROM review_comments WHERE comment_github_id = 500
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.deleted).toBe(true);
  });

  test("updateChunks replaces existing chunks", async () => {
    const original = makeChunk({
      commentGithubId: 600,
      chunkText: "Original text",
      tokenCount: 2,
    });
    await store.writeChunks([original]);

    const updated = makeChunk({
      commentGithubId: 600,
      chunkText: "Updated text with more content",
      tokenCount: 5,
    });
    await store.updateChunks([updated]);

    const threads = await store.getThreadComments("xbmc/xbmc:42:src/main.cpp:10");
    expect(threads.length).toBe(1);
    expect(threads[0]!.chunkText).toBe("Updated text with more content");
    expect(threads[0]!.tokenCount).toBe(5);
  });

  test("searchByEmbedding returns results sorted by distance", async () => {
    const embedding1 = makeEmbedding(100);
    const embedding2 = makeEmbedding(200);

    // Write chunks with embeddings via raw SQL (store.writeChunks doesn't set embeddings)
    const chunk1 = makeChunk({ commentGithubId: 700, chunkText: "First comment" });
    const chunk2 = makeChunk({ commentGithubId: 701, chunkText: "Second comment" });
    await store.writeChunks([chunk1, chunk2]);

    // Manually set embeddings
    const emb1Str = `[${Array.from(embedding1).join(",")}]`;
    const emb2Str = `[${Array.from(embedding2).join(",")}]`;
    await sql`UPDATE review_comments SET embedding = ${emb1Str}::vector, embedding_model = 'voyage-code-3' WHERE comment_github_id = 700`;
    await sql`UPDATE review_comments SET embedding = ${emb2Str}::vector, embedding_model = 'voyage-code-3' WHERE comment_github_id = 701`;

    const results = await store.searchByEmbedding({
      queryEmbedding: embedding1,
      repo: "xbmc/xbmc",
      topK: 10,
    });

    expect(results.length).toBe(2);
    // Exact match should be first
    expect(results[0]!.distance).toBeLessThan(0.01);
    expect(results[0]!.record.commentGithubId).toBe(700);
    // Results should be sorted by distance
    expect(results[0]!.distance).toBeLessThanOrEqual(results[1]!.distance);
  });

  test("getSyncState/updateSyncState round-trips", async () => {
    // Initially null
    let state = await store.getSyncState("xbmc/xbmc");
    expect(state).toBeNull();

    // Write state
    await store.updateSyncState({
      repo: "xbmc/xbmc",
      lastSyncedAt: new Date("2025-01-15T10:00:00Z"),
      lastPageCursor: "cursor123",
      totalCommentsSynced: 500,
      backfillComplete: false,
    });

    state = await store.getSyncState("xbmc/xbmc");
    expect(state).not.toBeNull();
    expect(state!.repo).toBe("xbmc/xbmc");
    expect(state!.lastPageCursor).toBe("cursor123");
    expect(state!.totalCommentsSynced).toBe(500);
    expect(state!.backfillComplete).toBe(false);

    // Update state
    await store.updateSyncState({
      repo: "xbmc/xbmc",
      lastSyncedAt: new Date("2025-01-16T10:00:00Z"),
      lastPageCursor: "cursor456",
      totalCommentsSynced: 1000,
      backfillComplete: true,
    });

    state = await store.getSyncState("xbmc/xbmc");
    expect(state!.lastPageCursor).toBe("cursor456");
    expect(state!.totalCommentsSynced).toBe(1000);
    expect(state!.backfillComplete).toBe(true);
  });

  test("countByRepo returns correct count", async () => {
    const chunks = [
      makeChunk({ commentGithubId: 800 }),
      makeChunk({ commentGithubId: 801 }),
      makeChunk({ commentGithubId: 802 }),
    ];
    await store.writeChunks(chunks);

    const count = await store.countByRepo("xbmc/xbmc");
    expect(count).toBe(3);

    // Different repo returns 0
    const otherCount = await store.countByRepo("other/repo");
    expect(otherCount).toBe(0);
  });

  test("getLatestCommentDate returns most recent date", async () => {
    const chunks = [
      makeChunk({
        commentGithubId: 900,
        githubCreatedAt: new Date("2025-01-10T10:00:00Z"),
      }),
      makeChunk({
        commentGithubId: 901,
        githubCreatedAt: new Date("2025-03-20T10:00:00Z"),
      }),
      makeChunk({
        commentGithubId: 902,
        githubCreatedAt: new Date("2025-02-15T10:00:00Z"),
      }),
    ];
    await store.writeChunks(chunks);

    const latest = await store.getLatestCommentDate("xbmc/xbmc");
    expect(latest).not.toBeNull();
    expect(latest!.toISOString()).toContain("2025-03-20");
  });

  test("getLatestCommentDate returns null for empty repo", async () => {
    const latest = await store.getLatestCommentDate("nonexistent/repo");
    expect(latest).toBeNull();
  });

  test("searchByEmbedding excludes deleted and stale records", async () => {
    const embedding = makeEmbedding(300);
    const embStr = `[${Array.from(embedding).join(",")}]`;

    // Insert a normal record, a deleted record, and a stale record
    const normal = makeChunk({ commentGithubId: 1100 });
    const deleted = makeChunk({ commentGithubId: 1101 });
    const staleChunk = makeChunk({ commentGithubId: 1102 });

    await store.writeChunks([normal, deleted, staleChunk]);

    // Set embeddings on all
    await sql`UPDATE review_comments SET embedding = ${embStr}::vector, embedding_model = 'voyage-code-3'`;

    // Mark one deleted, one stale
    await sql`UPDATE review_comments SET deleted = true WHERE comment_github_id = 1101`;
    await sql`UPDATE review_comments SET stale = true WHERE comment_github_id = 1102`;

    const results = await store.searchByEmbedding({
      queryEmbedding: embedding,
      repo: "xbmc/xbmc",
      topK: 10,
    });

    expect(results.length).toBe(1);
    expect(results[0]!.record.commentGithubId).toBe(1100);
  });
});
