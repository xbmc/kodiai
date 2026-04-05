import { describe, expect, test } from "bun:test";
import type { StructuralImpactPayload } from "./types.ts";
import {
  buildStructuralImpactCacheKey,
  createStructuralImpactCache,
  type StructuralImpactCache,
} from "./cache.ts";

function makePayload(status: StructuralImpactPayload["status"]): StructuralImpactPayload {
  return {
    status,
    changedFiles: ["src/service.cpp"],
    seedSymbols: [],
    impactedFiles: [],
    probableCallers: [],
    likelyTests: [],
    canonicalEvidence: [],
    graphStats: null,
    degradations:
      status === "partial"
        ? [{ source: "graph", reason: "timed out after 50ms" }]
        : [],
  };
}

describe("createStructuralImpactCache", () => {
  test("stores and retrieves by canonical repo/base/head cache key", () => {
    const cache = createStructuralImpactCache();
    const key = buildStructuralImpactCacheKey({
      repo: "Acme/Repo",
      baseSha: "base1",
      headSha: "head1",
    });
    const payload = makePayload("ok");

    cache.set(key, payload);

    expect(cache.get(key)).toEqual(payload);
    expect(
      cache.get(
        buildStructuralImpactCacheKey({
          repo: "acme/repo",
          baseSha: "base1",
          headSha: "head1",
        }),
      ),
    ).toEqual(payload);
  });

  test("expires entries after ttl", () => {
    let now = 1_000;
    const cache = createStructuralImpactCache({ ttlMs: 50, now: () => now });
    const key = buildStructuralImpactCacheKey({
      repo: "acme/repo",
      baseSha: "base2",
      headSha: "head2",
    });

    cache.set(key, makePayload("ok"));
    expect(cache.get(key)?.status).toBe("ok");

    now += 51;
    expect(cache.get(key)).toBeUndefined();
  });

  test("evicts oldest entries once max size is exceeded", () => {
    let now = 1_000;
    const cache = createStructuralImpactCache({ maxSize: 2, ttlMs: 1_000, now: () => now });
    const key1 = buildStructuralImpactCacheKey({ repo: "acme/repo", baseSha: "b1", headSha: "h1" });
    const key2 = buildStructuralImpactCacheKey({ repo: "acme/repo", baseSha: "b2", headSha: "h2" });
    const key3 = buildStructuralImpactCacheKey({ repo: "acme/repo", baseSha: "b3", headSha: "h3" });

    cache.set(key1, makePayload("ok"));
    now += 1;
    cache.set(key2, makePayload("partial"));
    now += 1;
    cache.set(key3, makePayload("unavailable"));

    expect(cache.get(key1)).toBeUndefined();
    expect(cache.get(key2)?.status).toBe("partial");
    expect(cache.get(key3)?.status).toBe("unavailable");
  });

  test("preserves partial payloads for truthful repeated degradation", () => {
    const cache: StructuralImpactCache = createStructuralImpactCache();
    const key = buildStructuralImpactCacheKey({
      repo: "acme/repo",
      baseSha: "base3",
      headSha: "head3",
    });

    cache.set(key, makePayload("partial"));

    const cached = cache.get(key);
    expect(cached?.status).toBe("partial");
    expect(cached?.degradations).toEqual([
      { source: "graph", reason: "timed out after 50ms" },
    ]);
  });
});
