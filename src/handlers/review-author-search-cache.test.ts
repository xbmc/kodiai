import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { SearchCache } from "../lib/search-cache.ts";
import { resolveReviewAuthorPrCountSearchCache } from "./review-author-search-cache.ts";

function makeLogger() {
  const entries: Array<{ data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ data, message });
      },
    } as unknown as Pick<Logger, "warn">,
  };
}

function makeCache(): SearchCache<number> {
  return {
    get: () => undefined,
    set: () => {},
    getOrLoad: async (_key, loader) => loader(),
    purgeExpired: () => 0,
  };
}

describe("resolveReviewAuthorPrCountSearchCache", () => {
  test("prefers the injected cache over the factory", () => {
    const { logger, entries } = makeLogger();
    const injectedCache = makeCache();
    let factoryCalls = 0;

    const cache = resolveReviewAuthorPrCountSearchCache({
      injectedSearchCache: injectedCache,
      searchCacheFactory: () => {
        factoryCalls += 1;
        return makeCache();
      },
      logger,
    });

    expect(cache).toBe(injectedCache);
    expect(factoryCalls).toBe(0);
    expect(entries).toEqual([]);
  });

  test("creates a factory cache when no cache is injected", () => {
    const { logger, entries } = makeLogger();
    const factoryCache = makeCache();

    const cache = resolveReviewAuthorPrCountSearchCache({
      injectedSearchCache: undefined,
      searchCacheFactory: () => factoryCache,
      logger,
    });

    expect(cache).toBe(factoryCache);
    expect(entries).toEqual([]);
  });

  test("creates a default cache when no cache or factory is provided", () => {
    const { logger, entries } = makeLogger();

    const cache = resolveReviewAuthorPrCountSearchCache({
      injectedSearchCache: undefined,
      searchCacheFactory: undefined,
      logger,
    });

    expect(cache).toBeDefined();
    cache?.set("author:alice", 7);
    expect(cache?.get("author:alice")).toBe(7);
    expect(entries).toEqual([]);
  });

  test("fails open when cache construction throws", () => {
    const { logger, entries } = makeLogger();
    const err = new Error("cache init failed");

    const cache = resolveReviewAuthorPrCountSearchCache({
      injectedSearchCache: undefined,
      searchCacheFactory: () => {
        throw err;
      },
      logger,
    });

    expect(cache).toBeUndefined();
    expect(entries).toEqual([
      {
        data: { err },
        message: "Search cache initialization failed (fail-open, continuing without search cache)",
      },
    ]);
  });
});
