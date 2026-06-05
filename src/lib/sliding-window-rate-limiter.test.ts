import { describe, expect, test } from "bun:test";
import { createNamedRateLimiters, createSlidingWindowRateLimiter } from "./sliding-window-rate-limiter.ts";

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
