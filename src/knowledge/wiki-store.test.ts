import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createWikiPageStore } from "./wiki-store.ts";
import { createDbClient, type Sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import type { WikiPageStore, WikiPageChunk } from "./wiki-types.ts";

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

function makeChunk(overrides: Partial<WikiPageChunk> = {}): WikiPageChunk {
  return {
    pageId: 100,
    pageTitle: "Test Page",
    namespace: "Main",
    pageUrl: "https://kodi.wiki/view/Test_Page",
    sectionHeading: "Introduction",
    sectionAnchor: "Introduction",
    sectionLevel: 2,
    chunkIndex: 0,
    chunkText: "Test Page > Introduction: This is the introduction section.",
    rawText: "This is the introduction section.",
    tokenCount: 6,
    lastModified: new Date("2024-06-15"),
    revisionId: 42,
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

describe("WikiPageStore (pgvector)", () => {
  let sql: Sql;
  let store: WikiPageStore;
  let close: () => Promise<void>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn("Skipping WikiPageStore tests: DATABASE_URL not set");
      return;
    }
    const db = createDbClient({ logger: mockLogger });
    sql = db.sql;
    close = db.close;
    await runMigrations(sql);
    store = createWikiPageStore({ sql, logger: mockLogger });
  });

  afterAll(async () => {
    if (close) await close();
  });

  beforeEach(async () => {
    if (!sql) return;
    await sql`TRUNCATE wiki_pages CASCADE`;
    await sql`TRUNCATE wiki_sync_state CASCADE`;
  });

  test("writeChunks stores and retrieves by page ID", async () => {
    if (!store) return;
    const chunk = makeChunk({ embedding: makeEmbedding(1) });
    await store.writeChunks([chunk]);

    const result = await store.getPageChunks(100);
    expect(result.length).toBe(1);
    expect(result[0]!.pageTitle).toBe("Test Page");
    expect(result[0]!.sectionHeading).toBe("Introduction");
    expect(result[0]!.chunkText).toContain("introduction section");
  });

  test("writeChunks is idempotent (re-run does not duplicate)", async () => {
    if (!store) return;
    const chunk = makeChunk({ embedding: makeEmbedding(2) });
    await store.writeChunks([chunk]);
    await store.writeChunks([chunk]); // second write

    const result = await store.getPageChunks(100);
    expect(result.length).toBe(1);
  });

  test("deletePageChunks removes all chunks for a page", async () => {
    if (!store) return;
    await store.writeChunks([
      makeChunk({ chunkIndex: 0, sectionAnchor: "Intro", embedding: makeEmbedding(3) }),
      makeChunk({ chunkIndex: 1, sectionAnchor: "Intro", embedding: makeEmbedding(4) }),
    ]);

    await store.deletePageChunks(100);
    const result = await store.getPageChunks(100);
    expect(result.length).toBe(0);
  });

  test("replacePageChunks atomically replaces chunks", async () => {
    if (!store) return;
    // Write initial chunk
    await store.writeChunks([makeChunk({ chunkIndex: 0, embedding: makeEmbedding(5) })]);

    // Replace with two new chunks
    await store.replacePageChunks(100, [
      makeChunk({ chunkIndex: 0, rawText: "Updated text A", chunkText: "Test Page > Introduction: Updated text A", embedding: makeEmbedding(6) }),
      makeChunk({ chunkIndex: 1, rawText: "Updated text B", chunkText: "Test Page > Introduction: Updated text B", embedding: makeEmbedding(7) }),
    ]);

    const result = await store.getPageChunks(100);
    expect(result.length).toBe(2);
    expect(result[0]!.rawText).toBe("Updated text A");
    expect(result[1]!.rawText).toBe("Updated text B");
  });

  test("softDeletePage marks all page chunks as deleted", async () => {
    if (!store) return;
    await store.writeChunks([makeChunk({ embedding: makeEmbedding(8) })]);

    await store.softDeletePage(100);
    const result = await store.getPageChunks(100); // getPageChunks filters deleted
    expect(result.length).toBe(0);
  });

  test("searchByEmbedding returns results sorted by distance", async () => {
    if (!store) return;
    const emb1 = makeEmbedding(10);
    const emb2 = makeEmbedding(20);

    await store.writeChunks([
      makeChunk({ pageId: 101, sectionAnchor: "A", embedding: emb1 }),
      makeChunk({ pageId: 102, sectionAnchor: "B", embedding: emb2 }),
    ]);

    const results = await store.searchByEmbedding({
      queryEmbedding: emb1,
      topK: 5,
    });

    expect(results.length).toBe(2);
    // First result should be closest to emb1 (itself)
    expect(results[0]!.record.pageId).toBe(101);
    expect(results[0]!.distance).toBeLessThan(results[1]!.distance);
  });

  test("searchByEmbedding filters by namespace when provided", async () => {
    if (!store) return;
    await store.writeChunks([
      makeChunk({ pageId: 201, namespace: "Main", sectionAnchor: "A", embedding: makeEmbedding(30) }),
      makeChunk({ pageId: 202, namespace: "Add-ons", sectionAnchor: "B", embedding: makeEmbedding(31) }),
    ]);

    const results = await store.searchByEmbedding({
      queryEmbedding: makeEmbedding(30),
      topK: 10,
      namespace: "Main",
    });

    expect(results.length).toBe(1);
    expect(results[0]!.record.namespace).toBe("Main");
  });

  test("getSyncState/updateSyncState round-trips", async () => {
    if (!store) return;
    await store.updateSyncState({
      source: "kodi.wiki",
      lastSyncedAt: new Date("2024-06-01"),
      lastContinueToken: "abc123",
      totalPagesSynced: 500,
      backfillComplete: false,
    });

    const state = await store.getSyncState("kodi.wiki");
    expect(state).not.toBeNull();
    expect(state!.source).toBe("kodi.wiki");
    expect(state!.lastContinueToken).toBe("abc123");
    expect(state!.totalPagesSynced).toBe(500);
    expect(state!.backfillComplete).toBe(false);

    // Update again (upsert)
    await store.updateSyncState({
      source: "kodi.wiki",
      lastSyncedAt: new Date("2024-07-01"),
      lastContinueToken: "def456",
      totalPagesSynced: 1000,
      backfillComplete: true,
    });

    const updated = await store.getSyncState("kodi.wiki");
    expect(updated!.totalPagesSynced).toBe(1000);
    expect(updated!.backfillComplete).toBe(true);
  });

  test("countBySource returns correct count", async () => {
    if (!store) return;
    await store.writeChunks([
      makeChunk({ pageId: 301, sectionAnchor: "A", embedding: makeEmbedding(40) }),
      makeChunk({ pageId: 302, sectionAnchor: "B", embedding: makeEmbedding(41) }),
    ]);

    const count = await store.countBySource();
    expect(count).toBe(2);
  });

  test("getPageRevision returns latest revision for page", async () => {
    if (!store) return;
    await store.writeChunks([
      makeChunk({ pageId: 401, revisionId: 99, embedding: makeEmbedding(50) }),
    ]);

    const rev = await store.getPageRevision(401);
    expect(rev).toBe(99);
  });

  test("getPageRevision returns null for nonexistent page", async () => {
    if (!store) return;
    const rev = await store.getPageRevision(999);
    expect(rev).toBeNull();
  });

  test("getSyncState returns null for unknown source", async () => {
    if (!store) return;
    const state = await store.getSyncState("unknown.wiki");
    expect(state).toBeNull();
  });
});
