import { describe, expect, test } from "bun:test";
import {
  cosineSimilarity,
  meanEmbedding,
  parsePgVectorEmbedding,
} from "./embedding-vector.ts";

describe("embedding-vector helpers", () => {
  test("parses pgvector strings and rejects malformed values", () => {
    expect(Array.from(parsePgVectorEmbedding("[1, 2, 3]") ?? [])).toEqual([1, 2, 3]);
    expect(parsePgVectorEmbedding("not-a-vector")).toBeNull();
    expect(parsePgVectorEmbedding("[1, nope]")).toBeNull();
    expect(parsePgVectorEmbedding(null)).toBeNull();
  });

  test("cosineSimilarity treats mismatched dimensions as no match", () => {
    expect(cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0]))).toBe(0);
  });

  test("meanEmbedding rejects mixed dimensions instead of producing NaN", () => {
    expect(meanEmbedding([
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5]),
    ])).toBeNull();
  });

  test("meanEmbedding computes a centroid for consistent dimensions", () => {
    const centroid = meanEmbedding([
      new Float32Array([1, 3]),
      new Float32Array([3, 5]),
    ]);

    expect(Array.from(centroid ?? [])).toEqual([2, 4]);
  });
});
