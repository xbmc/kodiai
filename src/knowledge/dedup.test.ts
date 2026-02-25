import { describe, test, expect } from "vitest";
import { deduplicateChunks, jaccardSimilarity } from "./dedup.ts";
import type { UnifiedRetrievalChunk } from "./cross-corpus-rrf.ts";

function makeChunk(
  overrides: Partial<UnifiedRetrievalChunk> & { id: string },
): UnifiedRetrievalChunk {
  return {
    text: `unique text for ${overrides.id}`,
    source: "code",
    sourceLabel: `[code: ${overrides.id}]`,
    sourceUrl: null,
    vectorDistance: null,
    rrfScore: 1.0,
    createdAt: null,
    metadata: {},
    ...overrides,
  };
}

describe("jaccardSimilarity", () => {
  test("identical texts return 1.0", () => {
    expect(jaccardSimilarity("hello world", "hello world")).toBe(1.0);
  });

  test("completely different texts return 0.0", () => {
    expect(jaccardSimilarity("hello world", "foo bar baz")).toBe(0.0);
  });

  test("partial overlap returns intermediate value", () => {
    // "hello world" tokens: {hello, world}
    // "hello there" tokens: {hello, there}
    // intersection: 1, union: 3
    expect(jaccardSimilarity("hello world", "hello there")).toBeCloseTo(
      1 / 3,
      8,
    );
  });

  test("empty texts return 1.0 (both empty = same)", () => {
    expect(jaccardSimilarity("", "")).toBe(1.0);
  });

  test("one empty returns 0.0", () => {
    expect(jaccardSimilarity("hello", "")).toBe(0.0);
  });

  test("case insensitive comparison", () => {
    expect(jaccardSimilarity("Hello World", "hello world")).toBe(1.0);
  });
});

describe("deduplicateChunks", () => {
  test("empty input returns empty output", () => {
    const result = deduplicateChunks({
      chunks: [],
      mode: "cross-corpus",
    });
    expect(result).toEqual([]);
  });

  test("single item returns unchanged", () => {
    const chunk = makeChunk({ id: "a" });
    const result = deduplicateChunks({
      chunks: [chunk],
      mode: "cross-corpus",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
  });

  test("very different texts kept as separate", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({ id: "a", text: "the quick brown fox jumps over the lazy dog", rrfScore: 2 }),
        makeChunk({ id: "b", text: "completely different text about something else entirely new", rrfScore: 1 }),
      ],
      mode: "cross-corpus",
    });
    expect(result).toHaveLength(2);
  });

  test("near-duplicate above threshold: lower-ranked removed, higher-ranked survives", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({
          id: "a",
          text: "the parser handles buffer overflow errors in the main loop",
          rrfScore: 2,
          sourceLabel: "[code: parser.ts]",
        }),
        makeChunk({
          id: "b",
          text: "the parser handles buffer overflow errors in the main loop section",
          rrfScore: 1,
          sourceLabel: "[review: PR #42]",
        }),
      ],
      similarityThreshold: 0.8,
      mode: "cross-corpus",
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a"); // higher score survives
  });

  test("surviving chunk gets alternateSources annotation", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({
          id: "a",
          text: "the parser handles buffer overflow errors in the main loop",
          rrfScore: 2,
          sourceLabel: "[code: parser.ts]",
        }),
        makeChunk({
          id: "b",
          text: "the parser handles buffer overflow errors in the main loop section",
          rrfScore: 1,
          sourceLabel: "[review: PR #42]",
        }),
      ],
      similarityThreshold: 0.8,
      mode: "cross-corpus",
    });

    expect(result[0]!.alternateSources).toEqual(["[review: PR #42]"]);
  });

  test("within-corpus mode prevents duplicates within same source", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({
          id: "a",
          text: "buffer overflow handling in parser module",
          rrfScore: 2,
          source: "code",
        }),
        makeChunk({
          id: "b",
          text: "buffer overflow handling in parser module code",
          rrfScore: 1,
          source: "code",
        }),
        makeChunk({
          id: "c",
          text: "completely different wiki content",
          rrfScore: 1.5,
          source: "wiki",
        }),
      ],
      similarityThreshold: 0.8,
      mode: "within-corpus",
    });

    // a and b are deduped (same source), c kept (different source)
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.id === "a")).toBeTruthy();
    expect(result.find((r) => r.id === "c")).toBeTruthy();
  });

  test("cross-corpus dedup: same chunk in wiki and review — keep highest ranked", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({
          id: "wiki-1",
          text: "kodi architecture uses event-driven patterns for addon communication",
          rrfScore: 1.5,
          source: "wiki",
          sourceLabel: "[wiki: Architecture]",
        }),
        makeChunk({
          id: "review-1",
          text: "kodi architecture uses event-driven patterns for addon communication",
          rrfScore: 1.0,
          source: "review_comment",
          sourceLabel: "[review: PR #100]",
        }),
      ],
      mode: "cross-corpus",
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("wiki-1"); // higher score
    expect(result[0]!.alternateSources).toEqual(["[review: PR #100]"]);
  });

  test("threshold 0.90 catches identical text with minor variation", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({
          id: "a",
          text: "the function parseXML takes an input string and returns a parsed document tree with error handling",
          rrfScore: 2,
        }),
        makeChunk({
          id: "b",
          // Same but one word added — high Jaccard
          text: "the function parseXML takes an input string and returns a parsed document tree with improved error handling",
          rrfScore: 1,
        }),
      ],
      similarityThreshold: 0.9,
      mode: "cross-corpus",
    });

    expect(result).toHaveLength(1);
  });

  test("threshold 0.90 keeps conceptually similar but textually different content", () => {
    const result = deduplicateChunks({
      chunks: [
        makeChunk({
          id: "a",
          text: "the XML parser validates input documents against schema definitions before processing",
          rrfScore: 2,
        }),
        makeChunk({
          id: "b",
          text: "error handling in the document processing pipeline catches malformed XML and reports to the user",
          rrfScore: 1,
        }),
      ],
      similarityThreshold: 0.9,
      mode: "cross-corpus",
    });

    // Textually very different, should NOT be deduped
    expect(result).toHaveLength(2);
  });
});
