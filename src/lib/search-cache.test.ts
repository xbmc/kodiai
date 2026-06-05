import { describe, expect, test } from "bun:test";
import {
  buildSearchCacheKey,
  createSearchCache,
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

  test("isolates review-derived prompt keys by bounded safety extras", () => {
    const base = {
      repo: "acme/repo",
      searchType: "review-derived-prompt",
      query: "initial:101:abcdef1234567890",
      extra: {
        fingerprintVersion: "review-prompt-v1",
        fingerprint: "bounded-fingerprint-a",
      },
    };

    expect(buildSearchCacheKey(base)).toBe(buildSearchCacheKey({
      ...base,
      extra: {
        fingerprint: "bounded-fingerprint-a",
        fingerprintVersion: "review-prompt-v1",
      },
    }));
    expect(buildSearchCacheKey(base)).not.toBe(buildSearchCacheKey({
      ...base,
      query: "initial:101:fedcba0987654321",
    }));
    expect(buildSearchCacheKey(base)).not.toBe(buildSearchCacheKey({
      ...base,
      extra: {
        fingerprintVersion: "review-prompt-v1",
        fingerprint: "bounded-fingerprint-b",
      },
    }));
  });

  test("isolates retrieval embedding keys by retrieval fingerprint extras", () => {
    const base = {
      repo: "acme/repo",
      searchType: "retrieval-query-embedding",
      query: "semantic review context",
      extra: {
        fingerprintVersion: "retrieval-query-embedding-v1",
        retrievalFindingHash: "finding-hash-a",
      },
    };

    expect(buildSearchCacheKey(base)).not.toBe(buildSearchCacheKey({
      ...base,
      extra: {
        fingerprintVersion: "retrieval-query-embedding-v1",
        retrievalFindingHash: "finding-hash-b",
      },
    }));
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

  test("uses per-entry TTL overrides", () => {
    let clock = 1_000;
    const cache = createSearchCache<string>({ ttlMs: 1_000, now: () => clock });
    const key = buildSearchCacheKey({
      repo: "acme/repo",
      searchType: "code",
      query: "ttl override",
    });

    cache.set(key, "short", 10);

    clock = 1_009;
    expect(cache.get(key)).toBe("short");

    clock = 1_010;
    expect(cache.get(key)).toBeUndefined();
  });

  test("evicts the oldest entries when maxSize is exceeded", () => {
    const cache = createSearchCache<string>({ maxSize: 2 });

    cache.set("a", "first");
    cache.set("b", "second");
    cache.set("c", "third");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("second");
    expect(cache.get("c")).toBe("third");
  });

  test("normalizes invalid maxSize and cleanup bounds to defaults", () => {
    const cache = createSearchCache<string>({
      maxSize: Number.NaN,
    });

    for (let i = 0; i < 501; i++) {
      cache.set(`key-${i}`, `value-${i}`);
    }

    expect(cache.get("key-0")).toBeUndefined();
    expect(cache.get("key-500")).toBe("value-500");
  });

  test("cleans up expired entries during later writes", () => {
    let clock = 1_000;
    const cache = createSearchCache<string>({
      ttlMs: 10,
      now: () => clock,
    });

    cache.set("expired-a", "a");
    cache.set("expired-b", "b");

    clock = 1_010;
    const purged = cache.purgeExpired();

    expect(purged).toBe(2);
    expect(cache.get("expired-a")).toBeUndefined();
    expect(cache.get("expired-b")).toBeUndefined();
  });
});
