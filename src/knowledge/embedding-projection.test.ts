import { describe, expect, test } from "bun:test";
import { projectEmbeddingByFeatureHash } from "./embedding-projection.ts";

describe("projectEmbeddingByFeatureHash", () => {
  test("returns the original embedding when it is already within the dimension cap", () => {
    const embedding = new Float32Array([1, 2, 3]);

    expect(projectEmbeddingByFeatureHash(embedding, 4)).toBe(embedding);
  });

  test("projects high-dimensional embeddings into a stable bounded vector", () => {
    const projected = projectEmbeddingByFeatureHash(new Float32Array([1, 2, 3, 4]), 2);

    expect(projected).toBeInstanceOf(Float32Array);
    expect(projected.length).toBe(2);
    expect(projected[0]!).toBeCloseTo((1 - 3) / Math.sqrt(2), 6);
    expect(projected[1]!).toBeCloseTo((2 - 4) / Math.sqrt(2), 6);
  });
});
