import { describe, test, expect } from "vitest";
import {
  crossCorpusRRF,
  type UnifiedRetrievalChunk,
  type RankedSourceList,
} from "./cross-corpus-rrf.ts";

function makeChunk(
  overrides: Partial<UnifiedRetrievalChunk> & { id: string },
): UnifiedRetrievalChunk {
  return {
    text: `chunk ${overrides.id}`,
    source: "code",
    sourceLabel: `[code: ${overrides.id}]`,
    sourceUrl: null,
    vectorDistance: null,
    rrfScore: 0,
    createdAt: null,
    metadata: {},
    ...overrides,
  };
}

describe("crossCorpusRRF", () => {
  test("empty source lists return empty", () => {
    expect(crossCorpusRRF({ sourceLists: [] })).toEqual([]);
  });

  test("single source list produces RRF scores based on rank position", () => {
    const list: RankedSourceList = {
      source: "code",
      items: [
        makeChunk({ id: "a" }),
        makeChunk({ id: "b" }),
      ],
    };

    const result = crossCorpusRRF({ sourceLists: [list], k: 60 });

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("a");
    expect(result[0]!.rrfScore).toBeCloseTo(1 / 60, 8);
    expect(result[1]!.id).toBe("b");
    expect(result[1]!.rrfScore).toBeCloseTo(1 / 61, 8);
  });

  test("two source lists — items in both get summed RRF scores", () => {
    const codeList: RankedSourceList = {
      source: "code",
      items: [
        makeChunk({ id: "shared", source: "code" }),
        makeChunk({ id: "code-only", source: "code" }),
      ],
    };
    const reviewList: RankedSourceList = {
      source: "review_comment",
      items: [
        makeChunk({ id: "review-only", source: "review_comment" }),
        makeChunk({ id: "shared", source: "code" }), // same id at rank 1
      ],
    };

    const result = crossCorpusRRF({
      sourceLists: [codeList, reviewList],
      k: 60,
    });

    expect(result).toHaveLength(3);

    const shared = result.find((r) => r.id === "shared")!;
    // code rank 0 + review rank 1 = 1/60 + 1/61
    expect(shared.rrfScore).toBeCloseTo(1 / 60 + 1 / 61, 8);

    // shared should be first (highest combined score)
    expect(result[0]!.id).toBe("shared");
  });

  test("three source lists merge correctly", () => {
    const codeList: RankedSourceList = {
      source: "code",
      items: [makeChunk({ id: "a", source: "code" })],
    };
    const reviewList: RankedSourceList = {
      source: "review_comment",
      items: [makeChunk({ id: "a", source: "review_comment" })],
    };
    const wikiList: RankedSourceList = {
      source: "wiki",
      items: [makeChunk({ id: "a", source: "wiki" })],
    };

    const result = crossCorpusRRF({
      sourceLists: [codeList, reviewList, wikiList],
      k: 60,
    });

    expect(result).toHaveLength(1);
    // rank 0 in all three: 3 * 1/60
    expect(result[0]!.rrfScore).toBeCloseTo(3 / 60, 8);
  });

  test("topK limit respected", () => {
    const list: RankedSourceList = {
      source: "code",
      items: Array.from({ length: 10 }, (_, i) =>
        makeChunk({ id: `item-${i}` }),
      ),
    };

    const result = crossCorpusRRF({
      sourceLists: [list],
      topK: 3,
    });

    expect(result).toHaveLength(3);
  });

  test("items sorted by total RRF score descending", () => {
    const codeList: RankedSourceList = {
      source: "code",
      items: [
        makeChunk({ id: "a", source: "code" }), // rank 0
        makeChunk({ id: "b", source: "code" }), // rank 1
      ],
    };
    const reviewList: RankedSourceList = {
      source: "review_comment",
      items: [
        makeChunk({ id: "b", source: "review_comment" }), // rank 0
        makeChunk({ id: "c", source: "review_comment" }), // rank 1
      ],
    };

    const result = crossCorpusRRF({
      sourceLists: [codeList, reviewList],
      k: 60,
    });

    // b: code rank 1 + review rank 0 = 1/61 + 1/60
    // a: code rank 0 = 1/60
    // c: review rank 1 = 1/61
    expect(result[0]!.id).toBe("b"); // highest
    expect(result[1]!.id).toBe("a");
    expect(result[2]!.id).toBe("c"); // lowest
  });

  test("source labels preserved on each chunk", () => {
    const list: RankedSourceList = {
      source: "wiki",
      items: [
        makeChunk({
          id: "w1",
          source: "wiki",
          sourceLabel: "[wiki: Kodi Architecture]",
          sourceUrl: "https://kodi.wiki/view/Kodi_Architecture",
        }),
      ],
    };

    const result = crossCorpusRRF({ sourceLists: [list] });

    expect(result[0]!.sourceLabel).toBe("[wiki: Kodi Architecture]");
    expect(result[0]!.sourceUrl).toBe(
      "https://kodi.wiki/view/Kodi_Architecture",
    );
    expect(result[0]!.source).toBe("wiki");
  });

  test("recency boost: chunks within window get score multiplier", () => {
    const now = new Date("2026-02-24T00:00:00Z");

    const recentChunk = makeChunk({
      id: "recent",
      createdAt: "2026-02-20T00:00:00Z", // 4 days ago
    });
    const oldChunk = makeChunk({
      id: "old",
      createdAt: "2025-01-01T00:00:00Z", // over a year ago
    });

    const list: RankedSourceList = {
      source: "code",
      items: [oldChunk, recentChunk], // old is rank 0, recent is rank 1
    };

    const result = crossCorpusRRF({
      sourceLists: [list],
      k: 60,
      recencyBoostDays: 30,
      recencyBoostFactor: 0.15,
      now,
    });

    // old: rank 0, no boost = 1/60
    // recent: rank 1, with 15% boost = (1/61) * 1.15
    const oldScore = 1 / 60;
    const recentScore = (1 / 61) * 1.15;

    const oldResult = result.find((r) => r.id === "old")!;
    const recentResult = result.find((r) => r.id === "recent")!;

    expect(oldResult.rrfScore).toBeCloseTo(oldScore, 8);
    expect(recentResult.rrfScore).toBeCloseTo(recentScore, 8);
  });

  test("recency boost does not apply to items without createdAt", () => {
    const list: RankedSourceList = {
      source: "code",
      items: [makeChunk({ id: "no-date", createdAt: null })],
    };

    const result = crossCorpusRRF({
      sourceLists: [list],
      k: 60,
      recencyBoostFactor: 0.15,
    });

    // No boost applied — straight 1/60
    expect(result[0]!.rrfScore).toBeCloseTo(1 / 60, 8);
  });
});
