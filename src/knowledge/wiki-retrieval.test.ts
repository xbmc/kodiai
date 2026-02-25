import { describe, test, expect, mock } from "bun:test";
import { searchWikiPages } from "./wiki-retrieval.ts";
import type { WikiPageStore, WikiPageRecord, WikiPageSearchResult } from "./wiki-types.ts";
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

function createMockRecord(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    id: 1,
    createdAt: "2025-01-01T00:00:00Z",
    pageId: 100,
    pageTitle: "VideoPlayer",
    namespace: "Main",
    pageUrl: "https://kodi.wiki/view/VideoPlayer",
    sectionHeading: "Pipeline",
    sectionAnchor: "Pipeline",
    sectionLevel: 2,
    chunkIndex: 0,
    chunkText: "VideoPlayer > Pipeline: The video player pipeline consists of demuxer, decoder, and renderer stages.",
    rawText: "The video player pipeline consists of demuxer, decoder, and renderer stages.",
    tokenCount: 15,
    embedding: null,
    embeddingModel: "voyage-code-3",
    stale: false,
    lastModified: "2025-01-15T12:00:00Z",
    revisionId: 42,
    deleted: false,
    ...overrides,
  };
}

function createMockEmbeddingProvider(shouldReturnNull = false): EmbeddingProvider {
  return {
    generate: mock(async () =>
      shouldReturnNull ? null : { embedding: new Float32Array([0.1, 0.2, 0.3]), tokenCount: 5 },
    ),
    model: "voyage-code-3",
    dimensions: 1024,
  };
}

function createMockStore(results: WikiPageSearchResult[] = []): WikiPageStore {
  return {
    writeChunks: mock(async () => {}),
    deletePageChunks: mock(async () => {}),
    replacePageChunks: mock(async () => {}),
    softDeletePage: mock(async () => {}),
    searchByEmbedding: mock(async () => results),
    getPageChunks: mock(async () => []),
    getSyncState: mock(async () => null),
    updateSyncState: mock(async () => {}),
    countBySource: mock(async () => 0),
    getPageRevision: mock(async () => null),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("searchWikiPages", () => {
  test("returns matches sorted by distance", async () => {
    const record1 = createMockRecord({ pageId: 1, pageTitle: "Page A" });
    const record2 = createMockRecord({ pageId: 2, pageTitle: "Page B" });
    const store = createMockStore([
      { record: record1, distance: 0.3 },
      { record: record2, distance: 0.2 },
    ]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "video player pipeline",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results).toHaveLength(2);
    // Store returns pre-sorted, we pass through
    expect(results[0]!.distance).toBe(0.3);
    expect(results[1]!.distance).toBe(0.2);
  });

  test("filters by distance threshold", async () => {
    const record1 = createMockRecord({ pageId: 1 });
    const record2 = createMockRecord({ pageId: 2 });
    const store = createMockStore([
      { record: record1, distance: 0.5 },
      { record: record2, distance: 0.9 }, // Above default threshold of 0.7
    ]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "video player",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.distance).toBe(0.5);
  });

  test("respects custom distance threshold", async () => {
    const record = createMockRecord();
    const store = createMockStore([
      { record, distance: 0.4 },
    ]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "test",
      topK: 5,
      distanceThreshold: 0.3, // Tighter threshold
      logger: createMockLogger(),
    });

    expect(results).toHaveLength(0);
  });

  test("returns empty array when embedding fails (fail-open)", async () => {
    const store = createMockStore([
      { record: createMockRecord(), distance: 0.3 },
    ]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(true), // Returns null
      query: "test",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results).toHaveLength(0);
    // Store should not be called
    expect(store.searchByEmbedding).not.toHaveBeenCalled();
  });

  test("returns empty array when store has no results", async () => {
    const store = createMockStore([]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "nonexistent topic",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results).toHaveLength(0);
  });

  test("passes namespace filter to store", async () => {
    const store = createMockStore([]);

    await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "test",
      topK: 5,
      namespace: "Help",
      logger: createMockLogger(),
    });

    expect(store.searchByEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "Help" }),
    );
  });

  test("source attribution is always 'wiki'", async () => {
    const record = createMockRecord();
    const store = createMockStore([{ record, distance: 0.3 }]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "test",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results[0]!.source).toBe("wiki");
  });

  test("URL includes section anchor for deep linking", async () => {
    const record = createMockRecord({
      pageUrl: "https://kodi.wiki/view/VideoPlayer",
      sectionAnchor: "Pipeline",
    });
    const store = createMockStore([{ record, distance: 0.3 }]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "test",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results[0]!.pageUrl).toBe("https://kodi.wiki/view/VideoPlayer#Pipeline");
  });

  test("URL has no anchor when sectionAnchor is null", async () => {
    const record = createMockRecord({
      pageUrl: "https://kodi.wiki/view/VideoPlayer",
      sectionAnchor: null,
    });
    const store = createMockStore([{ record, distance: 0.3 }]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "test",
      topK: 5,
      logger: createMockLogger(),
    });

    expect(results[0]!.pageUrl).toBe("https://kodi.wiki/view/VideoPlayer");
  });

  test("preserves all metadata fields from record", async () => {
    const record = createMockRecord({
      pageId: 42,
      pageTitle: "Settings",
      namespace: "Help",
      sectionHeading: "Audio",
      lastModified: "2024-06-15T10:00:00Z",
    });
    const store = createMockStore([{ record, distance: 0.25 }]);

    const results = await searchWikiPages({
      store,
      embeddingProvider: createMockEmbeddingProvider(),
      query: "audio settings",
      topK: 5,
      logger: createMockLogger(),
    });

    const match = results[0]!;
    expect(match.pageId).toBe(42);
    expect(match.pageTitle).toBe("Settings");
    expect(match.namespace).toBe("Help");
    expect(match.sectionHeading).toBe("Audio");
    expect(match.lastModified).toBe("2024-06-15T10:00:00Z");
    expect(match.rawText).toBeTruthy();
    expect(match.chunkText).toBeTruthy();
  });
});
