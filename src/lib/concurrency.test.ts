import { describe, expect, test } from "bun:test";
import { mapWithConcurrency } from "./concurrency.ts";

describe("mapWithConcurrency", () => {
  test("preserves order while limiting active workers", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40]);
    expect(maxActive).toBe(2);
  });

  test("normalizes invalid concurrency to one worker", async () => {
    const seen: number[] = [];

    const results = await mapWithConcurrency([1, 2, 3], Number.NaN, async (item) => {
      seen.push(item);
      return item;
    });

    expect(results).toEqual([1, 2, 3]);
    expect(seen).toEqual([1, 2, 3]);
  });

  test("floors fractional concurrency and handles empty input", async () => {
    const empty = await mapWithConcurrency([], 2.8, async (item: number) => item);
    expect(empty).toEqual([]);

    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency([1, 2, 3], 2.8, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return item;
    });

    expect(maxActive).toBe(2);
  });

  test("propagates worker failures", async () => {
    await expect(mapWithConcurrency([1, 2], 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    })).rejects.toThrow("boom");
  });
});
