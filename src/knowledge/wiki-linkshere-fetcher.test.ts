import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import type { Logger } from "pino";
import {
  fetchAllLinkshereCounts,
} from "./wiki-linkshere-fetcher.ts";
import {
  LINKSHERE_BATCH_SIZE,
  LINKSHERE_MAX_PER_PAGE,
  LINKSHERE_RATE_LIMIT_MS,
} from "./wiki-popularity-config.ts";

function createMockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  } as unknown as Logger;
}

function makeJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchAllLinkshereCounts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mock.restore();
  });

  it("returns an empty map without fetching when no page IDs are provided", async () => {
    const fetchFn = mock(async () => makeJsonResponse({})) as unknown as typeof globalThis.fetch;

    const counts = await fetchAllLinkshereCounts({
      baseUrl: "https://kodi.wiki",
      pageIds: [],
      fetchFn,
      logger: createMockLogger(),
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect([...counts.entries()]).toEqual([]);
  });

  it("batches page IDs, follows pagination, and preserves zero-count pages", async () => {
    const batchOneIds = Array.from({ length: LINKSHERE_BATCH_SIZE }, (_, i) => i + 1);
    const batchTwoIds = [LINKSHERE_BATCH_SIZE + 1, LINKSHERE_BATCH_SIZE + 2];

    const fetchFn = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const pageIds = url.searchParams.get("pageids")?.split("|").map(Number) ?? [];
      const lhcontinue = url.searchParams.get("lhcontinue");

      expect((init?.headers as Record<string, string> | undefined)?.["User-Agent"]).toContain("Kodiai/1.0");

      if (pageIds[0] === 1 && !lhcontinue) {
        return makeJsonResponse({
          continue: { lhcontinue: "next-page", continue: "-||" },
          query: {
            pages: {
              "1": {
                pageid: 1,
                title: "Page 1",
                linkshere: [{ pageid: 10, ns: 0, title: "A" }],
              },
              "2": {
                pageid: 2,
                title: "Page 2",
                linkshere: [
                  { pageid: 11, ns: 0, title: "B" },
                  { pageid: 12, ns: 0, title: "C" },
                ],
              },
            },
          },
        });
      }

      if (pageIds[0] === 1 && lhcontinue === "next-page") {
        return makeJsonResponse({
          query: {
            pages: {
              "1": {
                pageid: 1,
                title: "Page 1",
                linkshere: [
                  { pageid: 13, ns: 0, title: "D" },
                  { pageid: 14, ns: 0, title: "E" },
                ],
              },
              "2": {
                pageid: 2,
                title: "Page 2",
              },
            },
          },
        });
      }

      if (pageIds[0] === LINKSHERE_BATCH_SIZE + 1) {
        return makeJsonResponse({
          query: {
            pages: {
              [String(LINKSHERE_BATCH_SIZE + 1)]: {
                pageid: LINKSHERE_BATCH_SIZE + 1,
                title: "Page 51",
                linkshere: [{ pageid: 99, ns: 0, title: "Z" }],
              },
              [String(LINKSHERE_BATCH_SIZE + 2)]: {
                pageid: LINKSHERE_BATCH_SIZE + 2,
                title: "Page 52",
                linkshere: [],
              },
            },
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    }) as unknown as typeof globalThis.fetch;

    const promise = fetchAllLinkshereCounts({
      baseUrl: "https://kodi.wiki",
      pageIds: [...batchOneIds, ...batchTwoIds],
      fetchFn,
      logger: createMockLogger(),
    });

    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(LINKSHERE_RATE_LIMIT_MS);
    await Promise.resolve();
    vi.advanceTimersByTime(LINKSHERE_RATE_LIMIT_MS);
    const counts = await promise;

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(counts.get(1)).toBe(3);
    expect(counts.get(2)).toBe(2);
    expect(counts.get(LINKSHERE_BATCH_SIZE + 1)).toBe(1);
    expect(counts.get(LINKSHERE_BATCH_SIZE + 2)).toBe(0);
  });

  it("caps per-page accumulation at the configured maximum", async () => {
    const overCap = LINKSHERE_MAX_PER_PAGE - 1;
    let callCount = 0;
    const fetchFn = mock(async (_input: string | URL | Request) => {
      callCount += 1;
      if (callCount === 1) {
        return makeJsonResponse({
          continue: { lhcontinue: "next-page", continue: "-||" },
          query: {
            pages: {
              "42": {
                pageid: 42,
                title: "Very Popular",
                linkshere: Array.from({ length: overCap }, (_, i) => ({
                  pageid: i + 1,
                  ns: 0,
                  title: `Ref ${i + 1}`,
                })),
              },
            },
          },
        });
      }

      return makeJsonResponse({
        query: {
          pages: {
            "42": {
              pageid: 42,
              title: "Very Popular",
              linkshere: [{ pageid: 999999, ns: 0, title: "Overflow" }],
            },
          },
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const logger = createMockLogger();
    const promise = fetchAllLinkshereCounts({
      baseUrl: "https://kodi.wiki",
      pageIds: [42],
      fetchFn,
      logger,
    });

    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(LINKSHERE_RATE_LIMIT_MS);
    const counts = await promise;

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(counts.get(42)).toBe(LINKSHERE_MAX_PER_PAGE);
    expect(logger.debug).toHaveBeenCalledWith(
      { pageId: 42, title: "Very Popular" },
      "Linkshere count capped at maximum",
    );
  });

  it("logs a warning for a failed batch and continues with later batches", async () => {
    const pageIds = Array.from({ length: LINKSHERE_BATCH_SIZE + 1 }, (_, i) => i + 1);
    const logger = createMockLogger();
    const fetchFn = mock(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const firstPageId = Number(url.searchParams.get("pageids")?.split("|")[0]);
      if (firstPageId === 1) {
        throw new Error("first batch exploded");
      }
      return makeJsonResponse({
        query: {
          pages: {
            [String(LINKSHERE_BATCH_SIZE + 1)]: {
              pageid: LINKSHERE_BATCH_SIZE + 1,
              title: "Recovered page",
              linkshere: [{ pageid: 7, ns: 0, title: "Still counted" }],
            },
          },
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const promise = fetchAllLinkshereCounts({
      baseUrl: "https://kodi.wiki",
      pageIds,
      fetchFn,
      logger,
    });

    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(LINKSHERE_RATE_LIMIT_MS);
    await Promise.resolve();
    const counts = await promise;

    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: expect.any(Error),
        batchIdx: 0,
        batchSize: LINKSHERE_BATCH_SIZE,
      },
      "Linkshere batch failed, continuing with remaining batches",
    );
    expect(counts.get(1)).toBe(0);
    expect(counts.get(LINKSHERE_BATCH_SIZE + 1)).toBe(1);
  });
});
