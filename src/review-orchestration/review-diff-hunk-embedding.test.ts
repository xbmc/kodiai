import { describe, expect, mock, test } from "bun:test";
import { embedReviewDiffHunks } from "./review-diff-hunk-embedding.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";

function createLogger() {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: () => createLogger(),
  } as unknown as import("pino").Logger;
}

function createStore(existingHashes: Set<string> = new Set()): CodeSnippetStore {
  return {
    hasSnippet: mock(async (contentHash: string) => existingHashes.has(contentHash)),
    writeSnippet: mock(async () => {}),
    writeOccurrence: mock(async () => {}),
    searchByEmbedding: mock(async () => []),
    close: mock(() => {}),
  } as unknown as CodeSnippetStore;
}

describe("embedReviewDiffHunks", () => {
  test("skips embedding generation for hunks whose content hash already exists", async () => {
    const existingHashes = new Set<string>();
    const store = createStore(existingHashes);
    const embeddingProvider: EmbeddingProvider = {
      generate: mock(async () => ({
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        model: "test-model",
        dimensions: 3,
      })),
      get model() { return "test-model"; },
      get dimensions() { return 3; },
    };

    await embedReviewDiffHunks({
      diffFiles: [{
        filename: "src/example.ts",
        patch: [
          "@@ -1,2 +1,2 @@",
          " export function example() {",
          "-  return 1;",
          "+  return 2;",
          " }",
        ].join("\n"),
      }],
      repo: "owner/repo",
      owner: "owner",
      prNumber: 123,
      prTitle: "Change example",
      codeSnippetStore: store,
      embeddingProvider,
      config: {
        enabled: true,
        maxHunksPerPr: 10,
        minChangedLines: 1,
        excludePatterns: [],
      },
      logger: createLogger(),
    });

    const contentHash = (store.writeSnippet as ReturnType<typeof mock>).mock.calls[0]?.[0]?.contentHash;
    expect(typeof contentHash).toBe("string");
    existingHashes.add(String(contentHash));
    (embeddingProvider.generate as ReturnType<typeof mock>).mockClear();
    (store.writeSnippet as ReturnType<typeof mock>).mockClear();
    (store.writeOccurrence as ReturnType<typeof mock>).mockClear();

    await embedReviewDiffHunks({
      diffFiles: [{
        filename: "src/example.ts",
        patch: [
          "@@ -1,2 +1,2 @@",
          " export function example() {",
          "-  return 1;",
          "+  return 2;",
          " }",
        ].join("\n"),
      }],
      repo: "owner/repo",
      owner: "owner",
      prNumber: 124,
      prTitle: "Change example",
      codeSnippetStore: store,
      embeddingProvider,
      config: {
        enabled: true,
        maxHunksPerPr: 10,
        minChangedLines: 1,
        excludePatterns: [],
      },
      logger: createLogger(),
    });

    expect(embeddingProvider.generate).toHaveBeenCalledTimes(0);
    expect(store.writeSnippet).toHaveBeenCalledTimes(0);
    expect(store.writeOccurrence).toHaveBeenCalledTimes(1);
  });
});
