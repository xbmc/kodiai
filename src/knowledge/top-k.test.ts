import { describe, expect, test } from "bun:test";
import { takeTopByScore } from "./top-k.ts";

describe("takeTopByScore", () => {
  test("sorts the full iterable when no topK is provided", () => {
    const result = takeTopByScore(
      [{ id: "low", score: 1 }, { id: "high", score: 3 }, { id: "mid", score: 2 }],
      undefined,
      (item) => item.score,
    );

    expect(result.map((item) => item.id)).toEqual(["high", "mid", "low"]);
  });

  test("keeps only the highest scoring items when topK is provided", () => {
    const result = takeTopByScore(
      [{ id: "one", score: 1 }, { id: "four", score: 4 }, { id: "two", score: 2 }, { id: "three", score: 3 }],
      2,
      (item) => item.score,
    );

    expect(result.map((item) => item.id)).toEqual(["four", "three"]);
  });

  test("preserves input order for equal scores", () => {
    const result = takeTopByScore(
      [{ id: "a", score: 2 }, { id: "b", score: 2 }, { id: "c", score: 1 }],
      2,
      (item) => item.score,
    );

    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("returns empty results for non-positive topK", () => {
    expect(takeTopByScore([{ score: 1 }], 0, (item) => item.score)).toEqual([]);
    expect(takeTopByScore([{ score: 1 }], -1, (item) => item.score)).toEqual([]);
  });
});
