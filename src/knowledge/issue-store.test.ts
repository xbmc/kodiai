import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createIssueStore } from "./issue-store.ts";
import { createDbClient, type Sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import type { IssueStore, IssueInput, IssueCommentInput } from "./issue-types.ts";

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

function makeIssue(overrides: Partial<IssueInput> = {}): IssueInput {
  return {
    repo: "xbmc/xbmc",
    owner: "xbmc",
    issueNumber: 100,
    title: "Playback crashes on HDR content",
    body: "When playing HDR content on Android TV, the app crashes immediately.",
    state: "open",
    authorLogin: "alice",
    authorAssociation: "NONE",
    labelNames: ["bug", "playback"],
    templateSlug: "bug_report",
    commentCount: 2,
    assignees: [{ id: 1, login: "bob" }],
    milestone: "v21.0",
    reactionCount: 5,
    isPullRequest: false,
    locked: false,
    githubCreatedAt: new Date("2025-01-15T10:00:00Z"),
    githubUpdatedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function makeComment(overrides: Partial<IssueCommentInput> = {}): IssueCommentInput {
  return {
    repo: "xbmc/xbmc",
    issueNumber: 100,
    commentGithubId: 5000,
    authorLogin: "bob",
    authorAssociation: "MEMBER",
    body: "I can reproduce this on Android 14.",
    githubCreatedAt: new Date("2025-01-16T10:00:00Z"),
    githubUpdatedAt: null,
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

describe("IssueStore (pgvector)", () => {
  let sql: Sql;
  let store: IssueStore;
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
    await sql`DELETE FROM issue_comments`;
    await sql`DELETE FROM issues`;
  });

  beforeAll(() => {
    store = createIssueStore({ sql, logger: mockLogger });
  });

  // ---- Issue CRUD ----

  test("upsert creates a new issue", async () => {
    const issue = makeIssue({ embedding: makeEmbedding(42) });
    await store.upsert(issue);

    const record = await store.getByNumber("xbmc/xbmc", 100);
    expect(record).not.toBeNull();
    expect(record!.title).toBe("Playback crashes on HDR content");
    expect(record!.state).toBe("open");
    expect(record!.authorLogin).toBe("alice");
    expect(record!.labelNames).toEqual(["bug", "playback"]);
    expect(record!.templateSlug).toBe("bug_report");
    expect(record!.commentCount).toBe(2);
    expect(record!.assignees).toEqual([{ id: 1, login: "bob" }]);
    expect(record!.milestone).toBe("v21.0");
    expect(record!.reactionCount).toBe(5);
    expect(record!.isPullRequest).toBe(false);
    expect(record!.locked).toBe(false);
    expect(record!.embeddingModel).toBe("voyage-code-3");
  });

  test("upsert updates existing issue on conflict", async () => {
    await store.upsert(makeIssue());

    await store.upsert(makeIssue({
      title: "Playback crashes on HDR content (updated)",
      state: "closed",
      closedAt: new Date("2025-02-01T10:00:00Z"),
    }));

    const record = await store.getByNumber("xbmc/xbmc", 100);
    expect(record).not.toBeNull();
    expect(record!.title).toBe("Playback crashes on HDR content (updated)");
    expect(record!.state).toBe("closed");
    expect(record!.closedAt).not.toBeNull();
  });

  test("delete removes issue", async () => {
    await store.upsert(makeIssue());
    await store.delete("xbmc/xbmc", 100);

    const record = await store.getByNumber("xbmc/xbmc", 100);
    expect(record).toBeNull();
  });

  test("getByNumber returns null for missing issue", async () => {
    const record = await store.getByNumber("xbmc/xbmc", 999);
    expect(record).toBeNull();
  });

  test("countByRepo returns correct count", async () => {
    await store.upsert(makeIssue({ issueNumber: 100 }));
    await store.upsert(makeIssue({ issueNumber: 101 }));

    const count = await store.countByRepo("xbmc/xbmc");
    expect(count).toBe(2);
  });

  // ---- Issue search ----

  test("searchByEmbedding returns closest vectors", async () => {
    const emb42 = makeEmbedding(42);
    const emb99 = makeEmbedding(99);

    await store.upsert(makeIssue({ issueNumber: 100, title: "Issue A", embedding: emb42 }));
    await store.upsert(makeIssue({ issueNumber: 101, title: "Issue B", embedding: emb99 }));

    const results = await store.searchByEmbedding({
      queryEmbedding: emb42,
      repo: "xbmc/xbmc",
      topK: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.record.issueNumber).toBe(100);
  });

  test("searchByFullText finds issues by title and body", async () => {
    await store.upsert(makeIssue({
      issueNumber: 100,
      title: "Playback crashes on HDR content",
      body: "When playing HDR content on Android TV, the app crashes.",
    }));

    const results = await store.searchByFullText({
      query: "HDR crash",
      repo: "xbmc/xbmc",
      topK: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.record.issueNumber).toBe(100);
  });

  test("searchByFullText finds issues by label names", async () => {
    await store.upsert(makeIssue({
      issueNumber: 100,
      labelNames: ["bug", "playback"],
      title: "Some issue",
      body: "Some body text",
    }));

    const results = await store.searchByFullText({
      query: "playback",
      repo: "xbmc/xbmc",
      topK: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.record.issueNumber).toBe(100);
  });

  test("findSimilar finds related issues excluding self", async () => {
    const emb42 = makeEmbedding(42);
    const emb43 = makeEmbedding(43);
    const emb99 = makeEmbedding(99);

    await store.upsert(makeIssue({ issueNumber: 100, embedding: emb42 }));
    await store.upsert(makeIssue({ issueNumber: 101, embedding: emb43 }));
    await store.upsert(makeIssue({ issueNumber: 102, embedding: emb99 }));

    const results = await store.findSimilar("xbmc/xbmc", 100, 1.0);

    // Self (issue 100) should not appear
    const issueNumbers = results.map((r) => r.record.issueNumber);
    expect(issueNumbers).not.toContain(100);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Comment CRUD ----

  test("upsertComment creates a new comment", async () => {
    await store.upsert(makeIssue());
    await store.upsertComment(makeComment({ embedding: makeEmbedding(50) }));

    const comments = await store.getCommentsByIssue("xbmc/xbmc", 100);
    expect(comments.length).toBe(1);
    expect(comments[0]!.body).toBe("I can reproduce this on Android 14.");
    expect(comments[0]!.authorLogin).toBe("bob");
    expect(comments[0]!.embeddingModel).toBe("voyage-code-3");
  });

  test("upsertComment updates on conflict", async () => {
    await store.upsert(makeIssue());
    await store.upsertComment(makeComment());

    await store.upsertComment(makeComment({
      body: "Updated: can reproduce on Android 15 too.",
    }));

    const comments = await store.getCommentsByIssue("xbmc/xbmc", 100);
    expect(comments.length).toBe(1);
    expect(comments[0]!.body).toBe("Updated: can reproduce on Android 15 too.");
  });

  test("deleteComment removes comment", async () => {
    await store.upsert(makeIssue());
    await store.upsertComment(makeComment());
    await store.deleteComment("xbmc/xbmc", 5000);

    const comments = await store.getCommentsByIssue("xbmc/xbmc", 100);
    expect(comments.length).toBe(0);
  });

  test("getCommentsByIssue returns comments ordered by creation time", async () => {
    await store.upsert(makeIssue());

    await store.upsertComment(makeComment({
      commentGithubId: 5001,
      body: "First comment",
      githubCreatedAt: new Date("2025-01-16T10:00:00Z"),
    }));
    await store.upsertComment(makeComment({
      commentGithubId: 5003,
      body: "Third comment",
      githubCreatedAt: new Date("2025-01-18T10:00:00Z"),
    }));
    await store.upsertComment(makeComment({
      commentGithubId: 5002,
      body: "Second comment",
      githubCreatedAt: new Date("2025-01-17T10:00:00Z"),
    }));

    const comments = await store.getCommentsByIssue("xbmc/xbmc", 100);
    expect(comments.length).toBe(3);
    expect(comments[0]!.body).toBe("First comment");
    expect(comments[1]!.body).toBe("Second comment");
    expect(comments[2]!.body).toBe("Third comment");
  });

  // ---- Comment search ----

  test("searchCommentsByEmbedding returns closest vectors", async () => {
    await store.upsert(makeIssue());

    const emb50 = makeEmbedding(50);
    await store.upsertComment(makeComment({
      commentGithubId: 5000,
      body: "Comment with embedding",
      embedding: emb50,
    }));

    const results = await store.searchCommentsByEmbedding({
      queryEmbedding: emb50,
      repo: "xbmc/xbmc",
      topK: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.record.commentGithubId).toBe(5000);
  });

  // ---- Delete cascades to comments ----

  test("delete removes issue and its comments", async () => {
    await store.upsert(makeIssue());
    await store.upsertComment(makeComment());

    await store.delete("xbmc/xbmc", 100);

    const issue = await store.getByNumber("xbmc/xbmc", 100);
    expect(issue).toBeNull();

    const comments = await store.getCommentsByIssue("xbmc/xbmc", 100);
    expect(comments.length).toBe(0);
  });
});
