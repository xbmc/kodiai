import { describe, test, expect } from "vitest";
import { hybridSearchMerge, type HybridSearchResult } from "./hybrid-search.ts";

type TestItem = { id: string; text: string };

const getKey = (item: TestItem) => item.id;

describe("hybridSearchMerge", () => {
  test("empty inputs return empty output", () => {
    const result = hybridSearchMerge<TestItem>({
      vectorResults: [],
      bm25Results: [],
      getKey,
    });
    expect(result).toEqual([]);
  });

  test("vector-only results produce vector-only scores", () => {
    const items: TestItem[] = [
      { id: "a", text: "first" },
      { id: "b", text: "second" },
    ];
    const result = hybridSearchMerge<TestItem>({
      vectorResults: items,
      bm25Results: [],
      getKey,
    });

    expect(result).toHaveLength(2);
    // First item at rank 0: score = 1/(60+0) = 1/60
    expect(result[0]!.item.id).toBe("a");
    expect(result[0]!.vectorRank).toBe(0);
    expect(result[0]!.bm25Rank).toBeNull();
    expect(result[0]!.hybridScore).toBeCloseTo(1 / 60, 8);
    // Second item at rank 1: score = 1/(60+1) = 1/61
    expect(result[1]!.item.id).toBe("b");
    expect(result[1]!.hybridScore).toBeCloseTo(1 / 61, 8);
  });

  test("bm25-only results produce bm25-only scores", () => {
    const items: TestItem[] = [
      { id: "x", text: "match" },
    ];
    const result = hybridSearchMerge<TestItem>({
      vectorResults: [],
      bm25Results: items,
      getKey,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.item.id).toBe("x");
    expect(result[0]!.vectorRank).toBeNull();
    expect(result[0]!.bm25Rank).toBe(0);
    expect(result[0]!.hybridScore).toBeCloseTo(1 / 60, 8);
  });

  test("items in both lists get summed RRF scores", () => {
    const vectorItems: TestItem[] = [
      { id: "a", text: "shared" },
      { id: "b", text: "vector-only" },
    ];
    const bm25Items: TestItem[] = [
      { id: "c", text: "bm25-only" },
      { id: "a", text: "shared" }, // same item at rank 1 in BM25
    ];
    const result = hybridSearchMerge<TestItem>({
      vectorResults: vectorItems,
      bm25Results: bm25Items,
      getKey,
    });

    expect(result).toHaveLength(3);

    // "a" appears in both: vector rank 0 + bm25 rank 1
    const itemA = result.find((r) => r.item.id === "a")!;
    expect(itemA.vectorRank).toBe(0);
    expect(itemA.bm25Rank).toBe(1);
    expect(itemA.hybridScore).toBeCloseTo(1 / 60 + 1 / 61, 8);

    // "a" should be first (highest score)
    expect(result[0]!.item.id).toBe("a");
  });

  test("deduplication: same item in both lists appears once", () => {
    const shared: TestItem = { id: "dup", text: "duplicate" };
    const result = hybridSearchMerge<TestItem>({
      vectorResults: [shared],
      bm25Results: [shared],
      getKey,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.item.id).toBe("dup");
    // Both lists rank 0: 1/60 + 1/60
    expect(result[0]!.hybridScore).toBeCloseTo(2 / 60, 8);
  });

  test("results sorted by hybridScore descending", () => {
    const vectorItems: TestItem[] = [
      { id: "a", text: "best-vector" },
      { id: "b", text: "second-vector" },
      { id: "c", text: "third-vector" },
    ];
    const bm25Items: TestItem[] = [
      { id: "c", text: "third-vector" }, // rank 0 in bm25 — boosted
      { id: "b", text: "second-vector" },
    ];

    const result = hybridSearchMerge<TestItem>({
      vectorResults: vectorItems,
      bm25Results: bm25Items,
      getKey,
    });

    // c: vector rank 2 + bm25 rank 0 = 1/62 + 1/60
    // b: vector rank 1 + bm25 rank 1 = 1/61 + 1/61
    // a: vector rank 0 only = 1/60
    const scoreC = 1 / 62 + 1 / 60;
    const scoreB = 1 / 61 + 1 / 61;
    const scoreA = 1 / 60;

    expect(result[0]!.item.id).toBe("c"); // highest combined score
    expect(result[0]!.hybridScore).toBeCloseTo(scoreC, 8);
    expect(result[1]!.item.id).toBe("b");
    expect(result[1]!.hybridScore).toBeCloseTo(scoreB, 8);
    expect(result[2]!.item.id).toBe("a");
    expect(result[2]!.hybridScore).toBeCloseTo(scoreA, 8);
  });

  test("topK limit respected", () => {
    const items: TestItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      text: `text ${i}`,
    }));

    const result = hybridSearchMerge<TestItem>({
      vectorResults: items,
      bm25Results: [],
      getKey,
      topK: 3,
    });

    expect(result).toHaveLength(3);
    expect(result[0]!.item.id).toBe("item-0");
  });

  test("custom k parameter changes RRF scoring", () => {
    const items: TestItem[] = [{ id: "a", text: "only" }];

    const resultK60 = hybridSearchMerge<TestItem>({
      vectorResults: items,
      bm25Results: [],
      getKey,
      k: 60,
    });

    const resultK10 = hybridSearchMerge<TestItem>({
      vectorResults: items,
      bm25Results: [],
      getKey,
      k: 10,
    });

    // k=60: score = 1/60, k=10: score = 1/10
    expect(resultK60[0]!.hybridScore).toBeCloseTo(1 / 60, 8);
    expect(resultK10[0]!.hybridScore).toBeCloseTo(1 / 10, 8);
  });
});
