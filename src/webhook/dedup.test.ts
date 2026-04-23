import { describe, expect, test } from "bun:test";
import { createDeduplicator } from "./dedup.ts";

function createClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createDeduplicator", () => {
  test("treats the first delivery ID as new and the second as duplicate", () => {
    const deduplicator = createDeduplicator();

    expect(deduplicator.isDuplicate("delivery-1")).toBe(false);
    expect(deduplicator.isDuplicate("delivery-1")).toBe(true);
  });

  test("expires cached delivery IDs exactly at the TTL boundary using the injected clock", () => {
    const clock = createClock(1_000);
    const deduplicator = createDeduplicator({ ttlMs: 5_000, now: clock.now });

    expect(deduplicator.isDuplicate("delivery-ttl")).toBe(false);

    clock.advance(4_999);
    expect(deduplicator.isDuplicate("delivery-ttl")).toBe(true);

    clock.advance(1);
    expect(deduplicator.isDuplicate("delivery-ttl")).toBe(false);
    expect(deduplicator.isDuplicate("delivery-ttl")).toBe(true);
  });

  test("caches unexpected delivery ID strings as first-seen values without throwing", () => {
    const deduplicator = createDeduplicator();
    const malformedDeliveryId = "  delivery:\u0000odd\nvalue  ";

    expect(deduplicator.isDuplicate(malformedDeliveryId)).toBe(false);
    expect(deduplicator.isDuplicate(malformedDeliveryId)).toBe(true);
  });
});
