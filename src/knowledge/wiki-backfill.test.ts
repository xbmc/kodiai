import { describe, test, expect, mock, beforeEach } from "bun:test";
import { backfillWikiPages } from "./wiki-backfill.ts";
import type { WikiPageStore, WikiSyncState, WikiPageChunk, WikiPageRecord, WikiPageSearchResult } from "./wiki-types.ts";
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

function makeEmbedding(seed: number = 42): Float32Array {
  const arr = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) arr[i] = seed * 0.001 + i * 0.0001;
  return arr;
}

function createMockStore(): WikiPageStore & {
  writtenChunks: WikiPageChunk[][];
  replacedPages: Array<{ pageId: number; chunks: WikiPageChunk[] }>;
  syncStates: WikiSyncState[];
  _revisions: Map<number, number>;
  _syncState: WikiSyncState | null;
} {
  const writtenChunks: WikiPageChunk[][] = [];
  const replacedPages: Array<{ pageId: number; chunks: WikiPageChunk[] }> = [];
  const syncStates: WikiSyncState[] = [];
  const _revisions = new Map<number, number>();

  const obj = {
    writtenChunks,
    replacedPages,
    syncStates,
    _revisions,
    _syncState: null as WikiSyncState | null,
    async writeChunks(chunks: WikiPageChunk[]) { writtenChunks.push(chunks); },
    async deletePageChunks() {},
    async replacePageChunks(pageId: number, chunks: WikiPageChunk[]) {
      replacedPages.push({ pageId, chunks });
    },
    async softDeletePage() {},
    async searchByEmbedding(): Promise<WikiPageSearchResult[]> { return []; },
    async getPageChunks(): Promise<WikiPageRecord[]> { return []; },
    async getSyncState(_source: string): Promise<WikiSyncState | null> { return obj._syncState; },
    async updateSyncState(state: WikiSyncState) {
      syncStates.push({ ...state });
      obj._syncState = { ...state };
    },
    async countBySource() { return 0; },
    async getPageRevision(pageId: number) { return _revisions.get(pageId) ?? null; },
  };

  return obj;
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    async generate(text: string, _inputType: "document" | "query") {
      return {
        embedding: makeEmbedding(text.length),
        model: "voyage-code-3",
        dimensions: 1024,
      };
    },
    get model() { return "voyage-code-3"; },
    get dimensions() { return 1024; },
  };
}

// Create a page HTML that will pass the 500-char minimum
const LONG_CONTENT = "<p>" + "This is meaningful wiki content about Kodi architecture. ".repeat(15) + "</p>";

function createMockFetch(pages: Array<{ pageid: number; ns: number; title: string }>, continueToken?: string) {
  let callCount = 0;
  return async (url: string | URL | Request): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    if (urlStr.includes("list=allpages")) {
      callCount++;
      // First call returns pages with optional continue
      if (callCount === 1 && continueToken) {
        return new Response(JSON.stringify({
          continue: { apcontinue: continueToken, continue: "-||" },
          query: { allpages: pages.slice(0, 1) },
        }));
      }
      // Second call (or first without continue) returns remaining pages
      return new Response(JSON.stringify({
        query: { allpages: continueToken && callCount === 1 ? pages.slice(0, 1) : (callCount > 1 ? pages.slice(1) : pages) },
      }));
    }

    if (urlStr.includes("action=parse")) {
      const match = urlStr.match(/pageid=(\d+)/);
      const pageId = match ? parseInt(match[1]!, 10) : 1;
      const page = pages.find((p) => p.pageid === pageId);
      return new Response(JSON.stringify({
        parse: {
          title: page?.title ?? "Unknown",
          pageid: pageId,
          revid: pageId * 10, // deterministic revision
          text: { "*": LONG_CONTENT },
          categories: [],
        },
      }));
    }

    return new Response("Not found", { status: 404 });
  };
}

describe("backfillWikiPages", () => {
  test("fetches pages and stores chunks", async () => {
    const store = createMockStore();
    const mockFetch = createMockFetch([
      { pageid: 1, ns: 0, title: "Settings" },
      { pageid: 2, ns: 0, title: "Audio" },
    ]);

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    expect(result.totalPages).toBe(2);
    expect(result.totalChunks).toBeGreaterThan(0);
    expect(store.replacedPages.length).toBe(2);
  });

  test("skips pages with matching revision", async () => {
    const store = createMockStore();
    store._revisions.set(1, 10); // revision 10 matches what mock fetch returns

    const mockFetch = createMockFetch([
      { pageid: 1, ns: 0, title: "Settings" },
    ]);

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    // Page was skipped because revision matched
    expect(store.replacedPages.length).toBe(0);
  });

  test("resumes from continue token in sync state", async () => {
    const store = createMockStore();
    store._syncState = {
      source: "test.wiki",
      lastSyncedAt: new Date(),
      lastContinueToken: "page2",
      totalPagesSynced: 1,
      backfillComplete: false,
    };

    // fetchFn will receive the continue token
    let receivedContinueToken = false;
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("apcontinue=page2")) {
        receivedContinueToken = true;
      }
      if (urlStr.includes("list=allpages")) {
        return new Response(JSON.stringify({
          query: { allpages: [{ pageid: 2, ns: 0, title: "Page 2" }] },
        }));
      }
      if (urlStr.includes("action=parse")) {
        return new Response(JSON.stringify({
          parse: { title: "Page 2", pageid: 2, revid: 20, text: { "*": LONG_CONTENT }, categories: [] },
        }));
      }
      return new Response("Not found", { status: 404 });
    };

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    expect(result.resumed).toBe(true);
    expect(receivedContinueToken).toBe(true);
  });

  test("handles API errors gracefully", async () => {
    const store = createMockStore();
    let callCount = 0;
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("list=allpages")) {
        return new Response(JSON.stringify({
          query: { allpages: [{ pageid: 1, ns: 0, title: "Page 1" }] },
        }));
      }
      if (urlStr.includes("action=parse")) {
        callCount++;
        return new Response("Server error", { status: 500 });
      }
      return new Response("Not found", { status: 404 });
    };

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    // Page was skipped due to error
    expect(result.skippedPages).toBe(1);
    expect(store.replacedPages.length).toBe(0);
  });

  test("dry run fetches but does not store", async () => {
    const store = createMockStore();
    const mockFetch = createMockFetch([
      { pageid: 1, ns: 0, title: "Settings" },
    ]);

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      dryRun: true,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    expect(result.totalPages).toBe(1);
    expect(store.replacedPages.length).toBe(0);
    expect(store.syncStates.length).toBe(0);
  });

  test("marks backfill complete when finished", async () => {
    const store = createMockStore();
    const mockFetch = createMockFetch([
      { pageid: 1, ns: 0, title: "Settings" },
    ]);

    await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    // Last sync state update should mark complete
    const lastState = store.syncStates[store.syncStates.length - 1]!;
    expect(lastState.backfillComplete).toBe(true);
  });

  test("skips when backfill already complete", async () => {
    const store = createMockStore();
    store._syncState = {
      source: "test.wiki",
      lastSyncedAt: new Date(),
      lastContinueToken: null,
      totalPagesSynced: 100,
      backfillComplete: true,
    };

    const mockFetch = createMockFetch([]);

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    expect(result.totalPages).toBe(0);
  });

  test("embeds chunks before storage", async () => {
    const store = createMockStore();
    const mockFetch = createMockFetch([
      { pageid: 1, ns: 0, title: "Settings" },
    ]);

    await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    expect(store.replacedPages.length).toBe(1);
    // All chunks should have embeddings
    for (const { chunks } of store.replacedPages) {
      for (const chunk of chunks) {
        expect(chunk.embedding).toBeTruthy();
        expect(chunk.embedding!.length).toBe(1024);
      }
    }
  });

  test("handles pagination with continue token", async () => {
    const store = createMockStore();
    let allPagesCallCount = 0;

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("list=allpages")) {
        allPagesCallCount++;
        if (allPagesCallCount === 1) {
          return new Response(JSON.stringify({
            continue: { apcontinue: "Page_B", continue: "-||" },
            query: { allpages: [{ pageid: 1, ns: 0, title: "Page A" }] },
          }));
        }
        return new Response(JSON.stringify({
          query: { allpages: [{ pageid: 2, ns: 0, title: "Page B" }] },
        }));
      }
      if (urlStr.includes("action=parse")) {
        const match = urlStr.match(/pageid=(\d+)/);
        const pageId = match ? parseInt(match[1]!, 10) : 1;
        return new Response(JSON.stringify({
          parse: { title: `Page ${pageId}`, pageid: pageId, revid: pageId * 10, text: { "*": LONG_CONTENT }, categories: [] },
        }));
      }
      return new Response("Not found", { status: 404 });
    };

    const result = await backfillWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "test.wiki",
      baseUrl: "https://test.wiki",
      logger: mockLogger,
      delayMs: 0,
      fetchFn: mockFetch as typeof globalThis.fetch,
    });

    expect(allPagesCallCount).toBe(2);
    expect(result.totalPages).toBe(2);
  });
});
