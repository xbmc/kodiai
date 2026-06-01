import { describe, expect, test } from "bun:test";
import {
  createConversationTurnStore,
  createTriageCooldownStore,
  createWriteRateLimitStore,
} from "./mention-state-stores.ts";

describe("mention state stores", () => {
  test("write rate limit store records writes and expires old entries", () => {
    let now = 1_000;
    const store = createWriteRateLimitStore({
      maxSize: 2,
      ttlMs: 100,
      now: () => now,
    });

    store.recordWrite("repo-a");

    expect(store.getLastWriteAt("repo-a")).toBe(1_000);

    now = 1_101;

    expect(store.getLastWriteAt("repo-a")).toBeUndefined();
  });

  test("write rate limit store caps oldest entries", () => {
    let now = 1_000;
    const store = createWriteRateLimitStore({
      maxSize: 2,
      ttlMs: 10_000,
      now: () => now,
    });

    store.recordWrite("oldest");
    now += 1;
    store.recordWrite("middle");
    now += 1;
    store.recordWrite("newest");

    expect(store.getLastWriteAt("oldest")).toBeUndefined();
    expect(store.getLastWriteAt("middle")).toBe(1_001);
    expect(store.getLastWriteAt("newest")).toBe(1_002);
  });

  test("conversation turn store counts successful turns and expires inactive threads", () => {
    let now = 1_000;
    const store = createConversationTurnStore({
      maxSize: 10,
      ttlMs: 100,
      now: () => now,
    });

    expect(store.getTurns("thread")).toBe(0);
    expect(store.recordSuccessfulTurn("thread")).toBe(1);
    expect(store.recordSuccessfulTurn("thread")).toBe(2);
    expect(store.getTurns("thread")).toBe(2);

    now = 1_101;

    expect(store.getTurns("thread")).toBe(0);
  });

  test("triage cooldown store keeps body hash metadata behind cache policy", () => {
    let now = 1_000;
    const store = createTriageCooldownStore({
      maxSize: 1,
      ttlMs: 100,
      now: () => now,
    });

    store.set("issue", { lastTriagedAt: now, bodyHash: "abc" });

    expect(store.get("issue")).toEqual({ lastTriagedAt: 1_000, bodyHash: "abc" });

    now = 1_101;

    expect(store.get("issue")).toBeUndefined();
  });
});
