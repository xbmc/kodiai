import { describe, expect, test } from "bun:test";
import {
  createNamedRateLimiters,
  createSlidingWindowRateLimiter,
  requestSourceKey,
} from "./sliding-window-rate-limiter.ts";

describe("createSlidingWindowRateLimiter", () => {
  test("limits per key within a sliding window", () => {
    const limiter = createSlidingWindowRateLimiter(
      { max: 2, windowMs: 60_000, maxKeys: 10 },
      { max: 10, windowMs: 60_000, maxKeys: 10 },
    );

    expect(limiter.isLimited("a")).toBe(false);
    expect(limiter.isLimited("a")).toBe(false);
    expect(limiter.isLimited("a")).toBe(true);
    expect(limiter.isLimited("b")).toBe(false);
  });

  test("releases a key after the injected clock leaves the window", () => {
    let now = 1_000;
    const limiter = createSlidingWindowRateLimiter(
      { max: 1, windowMs: 100, maxKeys: 10, now: () => now },
      { max: 10, windowMs: 60_000, maxKeys: 10 },
    );

    expect(limiter.isLimited("a")).toBe(false);
    expect(limiter.isLimited("a")).toBe(true);

    now = 1_101;
    expect(limiter.isLimited("a")).toBe(false);
  });

  test("normalizes invalid window options to defaults", () => {
    const limiter = createSlidingWindowRateLimiter(
      { max: Number.NaN, windowMs: 0, maxKeys: -1 },
      { max: 2, windowMs: 60_000, maxKeys: 10 },
    );

    expect(limiter.isLimited("a")).toBe(false);
    expect(limiter.isLimited("a")).toBe(false);
    expect(limiter.isLimited("a")).toBe(true);
  });

  test("prunes stale keys before falling back to oldest-key eviction", () => {
    let now = 1_000;
    const limiter = createSlidingWindowRateLimiter(
      { max: 1, windowMs: 100, maxKeys: 2, now: () => now },
      { max: 10, windowMs: 60_000, maxKeys: 10 },
    );

    expect(limiter.isLimited("expired")).toBe(false);

    now = 1_101;
    expect(limiter.isLimited("fresh-a")).toBe(false);
    expect(limiter.isLimited("fresh-b")).toBe(false);

    expect(limiter.isLimited("fresh-a")).toBe(true);
    expect(limiter.isLimited("fresh-b")).toBe(true);
  });
});

describe("createNamedRateLimiters", () => {
  test("creates independent named limiter windows", () => {
    const limiters = createNamedRateLimiters<"preBody" | "verified" | "channel">(
      {
        channel: { max: 1 },
      },
      {
        preBody: { max: 2, windowMs: 60_000, maxKeys: 10 },
        verified: { max: 2, windowMs: 60_000, maxKeys: 10 },
        channel: { max: 5, windowMs: 60_000, maxKeys: 10 },
      },
    );

    expect(limiters.preBody.isLimited("source")).toBe(false);
    expect(limiters.preBody.isLimited("source")).toBe(false);
    expect(limiters.preBody.isLimited("source")).toBe(true);

    expect(limiters.channel.isLimited("channel")).toBe(false);
    expect(limiters.channel.isLimited("channel")).toBe(true);
  });
});

describe("requestSourceKey", () => {
  test("uses proxy/client headers instead of collapsing all callers into one key", () => {
    const key = requestSourceKey((name) => ({
      "x-forwarded-for": "203.0.113.9, 10.0.0.5",
    })[name]);

    expect(key).toBe("203.0.113.9");
    expect(requestSourceKey((name) => ({ "x-real-ip": "198.51.100.7" })[name])).toBe("198.51.100.7");
    expect(requestSourceKey((name) => ({ "cf-connecting-ip": "192.0.2.4" })[name])).toBe("192.0.2.4");
  });
});
