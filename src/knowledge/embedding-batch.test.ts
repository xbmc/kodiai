import { describe, expect, test } from "bun:test";
import { generateDocumentEmbeddingsBatch } from "./embedding-batch.ts";
import type { EmbeddingProvider } from "./types.ts";

describe("generateDocumentEmbeddingsBatch", () => {
  test("preserves order, limits active provider calls, and returns null fail-open", async () => {
    let active = 0;
    let maxActive = 0;
    const seenTexts: string[] = [];
    const provider: Pick<EmbeddingProvider, "generate"> = {
      async generate(text: string) {
        seenTexts.push(text);
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;

        if (text === "returns-null") return null;
        if (text === "throws") throw new Error("provider unavailable");
        return {
          embedding: new Float32Array([text.length]),
          model: "test-model",
          dimensions: 1,
        };
      },
    };

    const embeddings = await generateDocumentEmbeddingsBatch({
      texts: ["one", "returns-null", "throws", "four", "five"],
      embeddingProvider: provider,
      batchSize: 2,
    });

    expect(seenTexts).toEqual(["one", "returns-null", "throws", "four", "five"]);
    expect(maxActive).toBe(2);
    expect(Array.from(embeddings[0]!)).toEqual([3]);
    expect(embeddings[1]).toBeNull();
    expect(embeddings[2]).toBeNull();
    expect(Array.from(embeddings[3]!)).toEqual([4]);
    expect(Array.from(embeddings[4]!)).toEqual([4]);
  });

  test("can return per-item status metadata for fail-open callers", async () => {
    const thrownError = new Error("provider unavailable");
    const provider: Pick<EmbeddingProvider, "generate"> = {
      async generate(text: string) {
        if (text === "returns-null") return null;
        if (text === "throws") throw thrownError;
        return {
          embedding: new Float32Array([text.length]),
          model: "test-model",
          dimensions: 1,
        };
      },
    };

    const results = await generateDocumentEmbeddingsBatch({
      texts: ["one", "returns-null", "throws"],
      embeddingProvider: provider,
      includeResults: true,
    });

    expect(results[0]).toEqual({
      status: "success",
      embedding: new Float32Array([3]),
      model: "test-model",
    });
    expect(results[1]).toEqual({
      status: "unavailable",
      embedding: null,
    });
    expect(results[2]).toEqual({
      status: "failed",
      embedding: null,
      err: thrownError,
    });
  });
});
