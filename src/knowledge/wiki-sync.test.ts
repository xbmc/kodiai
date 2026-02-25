import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { createWikiSyncScheduler } from "./wiki-sync.ts";
import type { WikiPageStore, WikiSyncState } from "./wiki-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { Logger } from "pino";

// ── Test helpers ────────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  } as unknown as Logger;
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    generate: mock(async () => ({
      embedding: new Float32Array([0.1, 0.2, 0.3]),
      tokenCount: 5,
    })),
    model: "voyage-code-3",
    dimensions: 1024,
  };
}

type MockStore = WikiPageStore & { _syncState: WikiSyncState | null };

function createMockStore(): MockStore {
  const obj: MockStore = {
    _syncState: null,
    writeChunks: mock(async () => {}),
    deletePageChunks: mock(async () => {}),
    replacePageChunks: mock(async () => {}),
    softDeletePage: mock(async () => {}),
    searchByEmbedding: mock(async () => []),
    getPageChunks: mock(async () => []),
    getSyncState: mock(async () => obj._syncState),
    updateSyncState: mock(async (state: WikiSyncState) => {
      obj._syncState = state;
    }),
    countBySource: mock(async () => 0),
    getPageRevision: mock(async () => null),
  };
  return obj;
}

// Helper to build a RecentChanges API response
function buildRCResponse(changes: Array<{
  pageid: number;
  title: string;
  ns?: number;
  revid?: number;
  timestamp?: string;
}>, continueToken?: string) {
  const result: Record<string, unknown> = {
    query: {
      recentchanges: changes.map((c) => ({
        type: "edit",
        ns: c.ns ?? 0,
        title: c.title,
        pageid: c.pageid,
        revid: c.revid ?? 100,
        old_revid: (c.revid ?? 100) - 1,
        timestamp: c.timestamp ?? "2025-02-01T00:00:00Z",
      })),
    },
  };
  if (continueToken) {
    result.continue = { rccontinue: continueToken, continue: "-||" };
  }
  return result;
}

// Helper to build a Parse API response
function buildParseResponse(pageid: number, title: string, html: string, revid = 100) {
  return {
    parse: {
      title,
      pageid,
      revid,
      text: { "*": html },
    },
  };
}

// Large enough HTML content to not be skipped as a stub
const WIKI_HTML = `<h2>Overview</h2><p>${"This is a detailed section about the topic with enough content to pass the stub filter. ".repeat(10)}</p>`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createWikiSyncScheduler", () => {
  test("syncNow fetches recent changes and updates pages", async () => {
    const store = createMockStore();
    let callIndex = 0;

    const fetchFn = mock(async (url: string) => {
      if (url.includes("list=recentchanges")) {
        return new Response(JSON.stringify(buildRCResponse([
          { pageid: 1, title: "TestPage", revid: 200 },
        ])));
      }
      if (url.includes("action=parse")) {
        return new Response(JSON.stringify(
          buildParseResponse(1, "TestPage", WIKI_HTML, 200),
        ));
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      baseUrl: "https://kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    const result = await scheduler.syncNow();

    expect(result.pagesChecked).toBe(1);
    expect(result.pagesUpdated).toBe(1);
    expect(result.pagesDeleted).toBe(0);
    expect(store.replacePageChunks).toHaveBeenCalled();
    expect(store.updateSyncState).toHaveBeenCalled();
  });

  test("soft-deletes pages that become redirects", async () => {
    const store = createMockStore();
    // Page existed before (has a revision)
    (store.getPageRevision as ReturnType<typeof mock>).mockImplementation(async () => 100);

    const redirectHtml = '<div class="redirectMsg"><p>Redirect to <a href="/view/RealPage">RealPage</a></p></div>';

    const fetchFn = mock(async (url: string) => {
      if (url.includes("list=recentchanges")) {
        return new Response(JSON.stringify(buildRCResponse([
          { pageid: 1, title: "OldPage", revid: 200 },
        ])));
      }
      if (url.includes("action=parse")) {
        // Returns redirect content (will be skipped by chunker -> empty chunks)
        return new Response(JSON.stringify(
          buildParseResponse(1, "OldPage", `<p>#REDIRECT RealPage</p>`, 200),
        ));
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    const result = await scheduler.syncNow();

    expect(result.pagesDeleted).toBe(1);
    expect(store.softDeletePage).toHaveBeenCalledWith(1);
  });

  test("skips pages with unchanged revision", async () => {
    const store = createMockStore();
    // Page already has revision 100
    (store.getPageRevision as ReturnType<typeof mock>).mockImplementation(async () => 100);

    const fetchFn = mock(async (url: string) => {
      if (url.includes("list=recentchanges")) {
        return new Response(JSON.stringify(buildRCResponse([
          { pageid: 1, title: "UnchangedPage", revid: 100 }, // Same revision
        ])));
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    const result = await scheduler.syncNow();

    expect(result.pagesChecked).toBe(1);
    expect(result.pagesUpdated).toBe(0);
    // parse should NOT have been called since revision matched
    const parseCalls = (fetchFn as ReturnType<typeof mock>).mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes("action=parse"),
    );
    expect(parseCalls.length).toBe(0);
  });

  test("updates sync state timestamp after sync", async () => {
    const store = createMockStore();

    const fetchFn = mock(async (url: string) => {
      if (url.includes("list=recentchanges")) {
        return new Response(JSON.stringify(buildRCResponse([])));
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    await scheduler.syncNow();

    expect(store.updateSyncState).toHaveBeenCalled();
    const lastCall = (store.updateSyncState as ReturnType<typeof mock>).mock.calls.at(-1)!;
    const state = lastCall[0] as WikiSyncState;
    expect(state.source).toBe("kodi.wiki");
    expect(state.lastSyncedAt).toBeInstanceOf(Date);
  });

  test("start() and stop() manage interval correctly", async () => {
    const store = createMockStore();
    const fetchFn = mock(async () =>
      new Response(JSON.stringify(buildRCResponse([]))),
    ) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      intervalMs: 100_000, // Long interval so it doesn't fire
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    scheduler.start();
    // Immediately stop before startup delay fires
    scheduler.stop();

    // Give a short moment to ensure no sync happened
    await new Promise((r) => setTimeout(r, 50));

    // No fetch calls should have been made (stopped before startup delay)
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("deduplicates pages appearing multiple times in recent changes", async () => {
    const store = createMockStore();
    let parseCallCount = 0;

    const fetchFn = mock(async (url: string) => {
      if (url.includes("list=recentchanges")) {
        return new Response(JSON.stringify(buildRCResponse([
          { pageid: 1, title: "EditedPage", revid: 200, timestamp: "2025-02-01T12:00:00Z" },
          { pageid: 1, title: "EditedPage", revid: 201, timestamp: "2025-02-01T13:00:00Z" }, // Same page, different edit
        ])));
      }
      if (url.includes("action=parse")) {
        parseCallCount++;
        return new Response(JSON.stringify(
          buildParseResponse(1, "EditedPage", WIKI_HTML, 201),
        ));
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    const result = await scheduler.syncNow();

    // Should only process page once despite appearing twice
    expect(result.pagesChecked).toBe(1);
    expect(parseCallCount).toBe(1);
  });

  test("handles RC API failure gracefully", async () => {
    const store = createMockStore();

    const fetchFn = mock(async () =>
      new Response("Internal Server Error", { status: 500 }),
    ) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    const result = await scheduler.syncNow();

    // Should complete without throwing
    expect(result.pagesChecked).toBe(0);
    expect(result.pagesUpdated).toBe(0);
    // Still updates sync state even on failure
    expect(store.updateSyncState).toHaveBeenCalled();
  });

  test("paginates through multiple RC pages", async () => {
    const store = createMockStore();
    let rcCallCount = 0;

    const fetchFn = mock(async (url: string) => {
      if (url.includes("list=recentchanges")) {
        rcCallCount++;
        if (rcCallCount === 1) {
          return new Response(JSON.stringify(buildRCResponse(
            [{ pageid: 1, title: "Page1", revid: 200 }],
            "20250201|100", // Continue token
          )));
        }
        return new Response(JSON.stringify(buildRCResponse(
          [{ pageid: 2, title: "Page2", revid: 300 }],
        )));
      }
      if (url.includes("action=parse")) {
        const pidMatch = url.match(/pageid=(\d+)/);
        const pid = pidMatch ? Number(pidMatch[1]) : 1;
        return new Response(JSON.stringify(
          buildParseResponse(pid, pid === 1 ? "Page1" : "Page2", WIKI_HTML, pid === 1 ? 200 : 300),
        ));
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    const scheduler = createWikiSyncScheduler({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      source: "kodi.wiki",
      delayMs: 0,
      logger: createMockLogger(),
      fetchFn,
    });

    const result = await scheduler.syncNow();

    expect(rcCallCount).toBe(2); // Two RC API calls
    expect(result.pagesChecked).toBe(2);
    expect(result.pagesUpdated).toBe(2);
  });
});
