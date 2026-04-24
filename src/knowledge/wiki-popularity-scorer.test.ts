import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime, vi } from "bun:test";
import type { Logger } from "pino";
import {
  CITATION_WINDOW_DAYS,
  computeCompositeScore,
} from "./wiki-popularity-config.ts";
import {
  createWikiPopularityScorer,
  type WikiPopularityScoringResult,
} from "./wiki-popularity-scorer.ts";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  } as unknown as Logger;
}

type DistinctPageRow = {
  page_id: number;
  title: string;
  last_modified: string | null;
};

function createSqlReturning(rows: DistinctPageRow[]) {
  return mock(async () => rows) as any;
}

function createPopularityStore(overrides: Partial<{
  getCitationCounts(windowDays: number): Promise<Map<number, number>>;
  cleanupOldCitations(windowDays: number): Promise<number>;
  upsertPopularity(records: Array<Record<string, unknown>>): Promise<void>;
}> = {}) {
  return {
    getCitationCounts: mock(async (_windowDays: number) => new Map<number, number>()),
    cleanupOldCitations: mock(async (_windowDays: number) => 0),
    upsertPopularity: mock(async (_records: Array<Record<string, unknown>>) => {}),
    ...overrides,
  };
}

describe("createWikiPopularityScorer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    mock.restore();
  });

  it("returns a skip result when there are no wiki pages to score", async () => {
    const logger = createMockLogger();
    const popularityStore = createPopularityStore();
    const fetchFn = mock(async () => {
      throw new Error("fetch should not run");
    }) as unknown as typeof globalThis.fetch;

    const scorer = createWikiPopularityScorer({
      sql: createSqlReturning([]),
      logger,
      wikiPageStore: {} as never,
      popularityStore: popularityStore as never,
      wikiBaseUrl: "https://kodi.wiki",
      fetchFn,
    });

    const result = await scorer.runNow();

    expect(result).toMatchObject({
      skipped: true,
      skipReason: "no_wiki_pages",
      pagesScored: 0,
      citationsAggregated: 0,
      citationsCleaned: 0,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(popularityStore.upsertPopularity).not.toHaveBeenCalled();
  });

  it("scores pages and upserts computed popularity records", async () => {
    const pages: DistinctPageRow[] = [
      { page_id: 11, title: "Alpha", last_modified: "2026-03-31T00:00:00.000Z" },
      { page_id: 22, title: "Beta", last_modified: null },
    ];
    const citationCounts = new Map<number, number>([[11, 4], [22, 1]]);
    const popularityStore = createPopularityStore({
      getCitationCounts: mock(async (windowDays: number) => {
        expect(windowDays).toBe(CITATION_WINDOW_DAYS);
        return citationCounts;
      }),
      cleanupOldCitations: mock(async (windowDays: number) => {
        expect(windowDays).toBe(CITATION_WINDOW_DAYS);
        return 3;
      }),
    });

    const fetchFn = mock(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const requested = url.searchParams.get("pageids")?.split("|").map(Number);
      expect(requested).toEqual([11, 22]);
      return new Response(JSON.stringify({
        query: {
          pages: {
            "11": {
              pageid: 11,
              title: "Alpha",
              linkshere: [
                { pageid: 1, ns: 0, title: "A" },
                { pageid: 2, ns: 0, title: "B" },
                { pageid: 3, ns: 0, title: "C" },
              ],
            },
            "22": {
              pageid: 22,
              title: "Beta",
              linkshere: [{ pageid: 4, ns: 0, title: "D" }],
            },
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;

    const logger = createMockLogger();
    const scorer = createWikiPopularityScorer({
      sql: createSqlReturning(pages),
      logger,
      wikiPageStore: {} as never,
      popularityStore: popularityStore as never,
      wikiBaseUrl: "https://kodi.wiki",
      fetchFn,
    });

    const result = await scorer.runNow();

    expect(result).toMatchObject({
      skipped: false,
      pagesScored: 2,
      citationsAggregated: 2,
      citationsCleaned: 3,
    });

    expect(popularityStore.upsertPopularity).toHaveBeenCalledTimes(1);
    const upserted = (popularityStore.upsertPopularity as ReturnType<typeof mock>).mock.calls[0]?.[0] as Array<{
      pageId: number;
      pageTitle: string;
      inboundLinks: number;
      citationCount: number;
      editRecencyScore: number;
      compositeScore: number;
    }>;

    const alphaExpected = computeCompositeScore({
      inboundLinks: 3,
      citationCount: 4,
      daysSinceEdit: 1,
      normalization: {
        maxInboundLinks: 3,
        minInboundLinks: 1,
        maxCitationCount: 4,
        minCitationCount: 1,
      },
    });
    const betaExpected = computeCompositeScore({
      inboundLinks: 1,
      citationCount: 1,
      daysSinceEdit: 365,
      normalization: {
        maxInboundLinks: 3,
        minInboundLinks: 1,
        maxCitationCount: 4,
        minCitationCount: 1,
      },
    });

    expect(upserted).toEqual([
      {
        pageId: 11,
        pageTitle: "Alpha",
        inboundLinks: 3,
        citationCount: 4,
        editRecencyScore: alphaExpected.editRecencyScore,
        compositeScore: alphaExpected.compositeScore,
      },
      {
        pageId: 22,
        pageTitle: "Beta",
        inboundLinks: 1,
        citationCount: 1,
        editRecencyScore: betaExpected.editRecencyScore,
        compositeScore: betaExpected.compositeScore,
      },
    ]);
  });

  it("returns already_running when an overlapping runNow call arrives", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const popularityStore = createPopularityStore({
      getCitationCounts: mock(async () => {
        await gate;
        return new Map<number, number>();
      }),
    });

    const scorer = createWikiPopularityScorer({
      sql: createSqlReturning([{ page_id: 11, title: "Alpha", last_modified: null }]),
      logger: createMockLogger(),
      wikiPageStore: {} as never,
      popularityStore: popularityStore as never,
      wikiBaseUrl: "https://kodi.wiki",
      fetchFn: mock(async () => new Response(JSON.stringify({
        query: { pages: { "11": { pageid: 11, title: "Alpha", linkshere: [] } } },
      }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof globalThis.fetch,
    });

    const firstRun = scorer.runNow();
    await Promise.resolve();

    const secondRun = await scorer.runNow();
    release();
    await firstRun;

    expect(secondRun).toEqual({
      pagesScored: 0,
      citationsAggregated: 0,
      citationsCleaned: 0,
      durationMs: 0,
      skipped: true,
      skipReason: "already_running",
    } satisfies WikiPopularityScoringResult);
  });

  it("fails open with a skip reason when scoring throws", async () => {
    const scorer = createWikiPopularityScorer({
      sql: createSqlReturning([{ page_id: 11, title: "Alpha", last_modified: null }]),
      logger: createMockLogger(),
      wikiPageStore: {} as never,
      popularityStore: createPopularityStore({
        getCitationCounts: mock(async () => {
          throw new Error("citation store unavailable");
        }),
      }) as never,
      wikiBaseUrl: "https://kodi.wiki",
      fetchFn: mock(async () => new Response(JSON.stringify({
        query: { pages: { "11": { pageid: 11, title: "Alpha", linkshere: [] } } },
      }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof globalThis.fetch,
    });

    const result = await scorer.runNow();

    expect(result).toEqual({
      pagesScored: 0,
      citationsAggregated: 0,
      citationsCleaned: 0,
      durationMs: 0,
      skipped: true,
      skipReason: "error: citation store unavailable",
    });
  });

  it("starts once, schedules recurring runs, and stops cleanly", async () => {
    const sql = createSqlReturning([]);
    const logger = createMockLogger();
    const scorer = createWikiPopularityScorer({
      sql,
      logger,
      wikiPageStore: {} as never,
      popularityStore: createPopularityStore() as never,
      wikiBaseUrl: "https://kodi.wiki",
      intervalMs: 100,
      startupDelayMs: 10,
    });

    scorer.start();
    scorer.start();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(10);
    await Promise.resolve();
    expect(sql).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(sql).toHaveBeenCalledTimes(2);

    scorer.stop();
    scorer.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
