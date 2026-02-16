import { describe, expect, test } from "bun:test";
import {
  buildSearchCacheKey,
  createSearchCache,
  type KeyValueStore,
} from "./search-cache";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createThrowingStore<T>(message: string): KeyValueStore<T> {
  return {
    get() {
      throw new Error(`${message}:get`);
    },
    set() {
      throw new Error(`${message}:set`);
    },
    delete() {
      throw new Error(`${message}:delete`);
    },
    entries() {
      throw new Error(`${message}:entries`);
    },
  };
}

describe("buildSearchCacheKey", () => {
  test("normalizes equivalent semantic queries to the same key", () => {
    const keyA = buildSearchCacheKey({
      repo: "Acme/Widget",
      searchType: "Code",
      query: "  Find   TODO  comments ",
      extra: {
        path: "src",
        labels: ["bug", "ops"],
        filters: {
          language: "TypeScript",
          includeArchived: false,
        },
      },
    });

    const keyB = buildSearchCacheKey({
      repo: "acme/widget",
      searchType: "code",
      query: "find todo comments",
      extra: {
        filters: {
          includeArchived: false,
          language: "TypeScript",
        },
        labels: ["bug", "ops"],
        path: "src",
      },
    });

    expect(keyA).toBe(keyB);
  });

  test("isolates keys by repository", () => {
    const base = {
      searchType: "code",
      query: "cache invalidation",
      extra: { path: "src" },
    };

    const keyA = buildSearchCacheKey({ repo: "acme/service-a", ...base });
    const keyB = buildSearchCacheKey({ repo: "acme/service-b", ...base });

    expect(keyA).not.toBe(keyB);
  });
});

describe("createSearchCache", () => {
  test("returns values before TTL and misses after expiry", () => {
    let clock = 1_000;
    const cache = createSearchCache<string>({ ttlMs: 50, now: () => clock });
    const key = buildSearchCacheKey({
      repo: "acme/repo",
      searchType: "code",
      query: "retry scope",
    });

    cache.set(key, "hit");
    expect(cache.get(key)).toBe("hit");

    clock = 1_049;
    expect(cache.get(key)).toBe("hit");

    clock = 1_050;
    expect(cache.get(key)).toBeUndefined();
  });

  test("coalesces concurrent getOrLoad calls to one in-flight loader", async () => {
    const cache = createSearchCache<string>();
    const key = buildSearchCacheKey({
      repo: "acme/repo",
      searchType: "code",
      query: "concurrent dedupe",
    });

    const deferred = createDeferred<string>();
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls += 1;
      return deferred.promise;
    };

    const first = cache.getOrLoad(key, loader);
    const second = cache.getOrLoad(key, loader);

    expect(loaderCalls).toBe(1);
    expect(first).toBe(second);

    deferred.resolve("shared-result");

    await expect(first).resolves.toBe("shared-result");
    await expect(second).resolves.toBe("shared-result");
  });

  test("fails open when internal cache bookkeeping throws", async () => {
    const errors: string[] = [];
    const cache = createSearchCache<string>({
      store: createThrowingStore("store"),
      inFlightStore: createThrowingStore("inflight"),
      onError: (error) => errors.push(String(error)),
    });
    const key = buildSearchCacheKey({
      repo: "acme/repo",
      searchType: "code",
      query: "fail open",
    });

    let loaderCalls = 0;
    const result = await cache.getOrLoad(key, async () => {
      loaderCalls += 1;
      return "from-loader";
    });

    expect(result).toBe("from-loader");
    expect(loaderCalls).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  });
});
