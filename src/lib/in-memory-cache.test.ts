import { describe, expect, test } from "bun:test";
import { createInMemoryCache } from "./in-memory-cache.ts";

describe("createInMemoryCache", () => {
  function makeClock(start = 0) {
    let now = start;
    return {
      now: () => now,
      advance: (ms: number) => { now += ms; },
    };
  }

  test("basic get/set/has/delete operations", () => {
    const cache = createInMemoryCache<string, number>({ maxSize: 10, ttlMs: 60_000 });

    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("b")).toBeUndefined();

    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.delete("a")).toBe(false);
  });

  test("TTL expiry: get returns undefined after TTL", () => {
    const clock = makeClock(1000);
    const cache = createInMemoryCache<string, string>({
      maxSize: 10,
      ttlMs: 5000,
      now: clock.now,
    });

    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    clock.advance(4999);
    expect(cache.get("key")).toBe("value");

    clock.advance(1);
    expect(cache.get("key")).toBeUndefined();
  });

  test("has returns false for expired entries", () => {
    const clock = makeClock(0);
    const cache = createInMemoryCache<string, boolean>({
      maxSize: 10,
      ttlMs: 100,
      now: clock.now,
    });

    cache.set("x", true);
    expect(cache.has("x")).toBe(true);

    clock.advance(100);
    expect(cache.has("x")).toBe(false);
  });

  test("maxSize eviction: oldest entry evicted when over limit", () => {
    const cache = createInMemoryCache<string, number>({
      maxSize: 3,
      ttlMs: 60_000,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4); // should evict "a"

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  test("expired entries are evicted before counting toward maxSize", () => {
    const clock = makeClock(0);
    const cache = createInMemoryCache<string, number>({
      maxSize: 2,
      ttlMs: 100,
      now: clock.now,
    });

    cache.set("old1", 1);
    cache.set("old2", 2);

    clock.advance(100); // both entries now expired

    // Should not evict "new1" because expired entries are cleaned first
    cache.set("new1", 10);
    cache.set("new2", 20);

    expect(cache.get("old1")).toBeUndefined();
    expect(cache.get("old2")).toBeUndefined();
    expect(cache.get("new1")).toBe(10);
    expect(cache.get("new2")).toBe(20);
  });

  test("clear removes all entries", () => {
    const cache = createInMemoryCache<string, string>({
      maxSize: 10,
      ttlMs: 60_000,
    });

    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  test("size only counts non-expired entries", () => {
    const clock = makeClock(0);
    const cache = createInMemoryCache<string, number>({
      maxSize: 10,
      ttlMs: 100,
      now: clock.now,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size()).toBe(3);

    clock.advance(100);
    expect(cache.size()).toBe(0);
  });

  test("re-setting a key refreshes its TTL and position", () => {
    const clock = makeClock(0);
    const cache = createInMemoryCache<string, number>({
      maxSize: 3,
      ttlMs: 200,
      now: clock.now,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    clock.advance(100);
    cache.set("a", 10); // refresh "a", now "b" is oldest

    cache.set("d", 4); // should evict "b" (oldest)

    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });
});
