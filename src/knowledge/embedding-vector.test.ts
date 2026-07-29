import { describe, expect, test } from "bun:test";
import {
  cosineSimilarity,
  meanEmbedding,
  parsePgVectorEmbedding,
  weightedMeanEmbedding,
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

  test("weightedMeanEmbedding weights an existing centroid by its prior sample count", () => {
    // A mature centroid at 0 backed by 97 samples should barely move when merging
    // 3 new samples at 10 -- not collapse toward their unweighted average.
    const centroid = weightedMeanEmbedding([
      { embedding: new Float32Array([0]), weight: 97 },
      { embedding: new Float32Array([10]), weight: 1 },
      { embedding: new Float32Array([10]), weight: 1 },
      { embedding: new Float32Array([10]), weight: 1 },
    ]);

    expect(centroid?.[0]).toBeCloseTo(0.3, 5);
  });

  test("weightedMeanEmbedding with all equal weights matches meanEmbedding", () => {
    const embeddings = [new Float32Array([1, 3]), new Float32Array([3, 5])];
    const weighted = weightedMeanEmbedding(embeddings.map((embedding) => ({ embedding, weight: 1 })));
    const unweighted = meanEmbedding(embeddings);

    expect(Array.from(weighted ?? [])).toEqual(Array.from(unweighted ?? []));
  });

  test("weightedMeanEmbedding rejects mixed dimensions", () => {
    expect(weightedMeanEmbedding([
      { embedding: new Float32Array([1, 2, 3]), weight: 1 },
      { embedding: new Float32Array([4, 5]), weight: 1 },
    ])).toBeNull();
  });
});
