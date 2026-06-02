import { describe, expect, test } from "bun:test";
import { generateDocumentEmbeddingResultsBatch } from "./embedding-batch.ts";
import type { EmbeddingProvider } from "./types.ts";

describe("generateDocumentEmbeddingResultsBatch", () => {
  test("preserves order, limits active provider calls, and returns fail-open statuses", async () => {
    const thrownError = new Error("provider unavailable");
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
        if (text === "throws") throw thrownError;
        return {
          embedding: new Float32Array([text.length]),
          model: "test-model",
          dimensions: 1,
        };
      },
    };

    const results = await generateDocumentEmbeddingResultsBatch({
      texts: ["one", "returns-null", "throws", "four", "five"],
      embeddingProvider: provider,
      batchSize: 2,
    });

    expect(seenTexts).toEqual(["one", "returns-null", "throws", "four", "five"]);
    expect(maxActive).toBe(2);
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
    expect(results[3]).toEqual({
      status: "success",
      embedding: new Float32Array([4]),
      model: "test-model",
    });
    expect(results[4]).toEqual({
      status: "success",
      embedding: new Float32Array([4]),
      model: "test-model",
    });
  });
});
