import { describe, expect, it, mock } from "bun:test";
import { ingestCanonicalCodeSnapshot } from "./canonical-code-ingest.ts";
import type { CanonicalChunkWriteInput } from "./canonical-code-types.ts";
import type { EmbeddingProvider } from "./types.ts";

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as const;
}

function createEmbeddingProvider(): Pick<EmbeddingProvider, "generate"> {
  return {
    async generate(text: string) {
      return {
        embedding: new Float32Array([text.length, text.length / 10]),
        model: "voyage-test",
        dimensions: 2,
      };
    },
  };
}

function createStoreHarness() {
  const deleteCalls: Array<{ repo: string; owner: string; canonicalRef: string; filePath: string }> = [];
  const upsertCalls: CanonicalChunkWriteInput[] = [];
  const state = new Map<string, { contentHash: string; deleted: boolean }>();

  function chunkIdentity(input: CanonicalChunkWriteInput): string {
    return [
      input.repo,
      input.owner,
      input.canonicalRef,
      input.filePath,
      input.chunkType,
      input.symbolName ?? "",
    ].join("|");
  }

  return {
    deleteCalls,
    upsertCalls,
    store: {
      async deleteChunksForFile(params: {
        repo: string;
        owner: string;
        canonicalRef: string;
        filePath: string;
      }) {
        deleteCalls.push(params);
        let deleted = 0;
        for (const [identity, row] of state.entries()) {
          if (!identity.startsWith(`${params.repo}|${params.owner}|${params.canonicalRef}|${params.filePath}|`)) {
            continue;
          }
          if (!row.deleted) {
            row.deleted = true;
            deleted += 1;
          }
        }
        return deleted;
      },
      async upsertChunk(input: CanonicalChunkWriteInput, _embedding: Float32Array) {
        upsertCalls.push(input);
        const identity = chunkIdentity(input);
        const existing = state.get(identity);
        if (!existing) {
          state.set(identity, { contentHash: input.contentHash, deleted: false });
          return "inserted" as const;
        }
        if (existing.contentHash === input.contentHash) {
          existing.deleted = false;
          return "dedup" as const;
        }
        existing.contentHash = input.contentHash;
        existing.deleted = false;
        return "replaced" as const;
      },
    },
    state,
  };
}

describe("ingestCanonicalCodeSnapshot", () => {
  it("ingests fixture files into canonical rows with per-file outcome counts", async () => {
    const harness = createStoreHarness();
    const logger = createMockLogger();

    const result = await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        files: [
          {
            filePath: "src/player.ts",
            fileContent: [
              "export const config = { enabled: true };",
              "",
              "export function boot() {",
              "  return config.enabled;",
              "}",
            ].join("\n"),
          },
        ],
      },
    });

    expect(result.filesTotal).toBe(1);
    expect(result.filesProcessed).toBe(1);
    expect(result.filesExcluded).toBe(0);
    expect(result.chunksAttempted).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.replaced).toBe(0);
    expect(result.dedup).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.fileResults[0]?.boundaryDecisions).toEqual(["module", "function"]);
    expect(result.fileResults[0]?.inserted).toBe(2);
    expect(harness.deleteCalls).toEqual([
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        filePath: "src/player.ts",
      },
    ]);
    expect(harness.upsertCalls).toHaveLength(2);
    expect(harness.upsertCalls.every((call) => call.repo === "kodi")).toBe(true);
    expect(harness.upsertCalls.every((call) => call.canonicalRef === "main")).toBe(true);
  });

  it("is idempotent on repeated ingest and reports dedup outcomes after file replacement soft-delete", async () => {
    const harness = createStoreHarness();
    const logger = createMockLogger();
    const request = {
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      commitSha: "abc123",
      files: [
        {
          filePath: "src/player.ts",
          fileContent: [
            "export const config = { enabled: true };",
            "",
            "export function boot() {",
            "  return config.enabled;",
            "}",
          ].join("\n"),
        },
      ],
    };

    const first = await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request,
    });
    const second = await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request,
    });

    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.replaced).toBe(0);
    expect(second.dedup).toBe(2);
    expect(second.deleted).toBe(2);
    expect(second.fileResults[0]?.deletedCount).toBe(2);
    expect(second.fileResults[0]?.dedup).toBe(2);
  });

  it("replaces changed canonical chunks using stable chunk identity and new content hash", async () => {
    const harness = createStoreHarness();
    const logger = createMockLogger();

    await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        files: [
          {
            filePath: "src/player.ts",
            fileContent: [
              "export const config = { enabled: true };",
              "",
              "export function boot() {",
              "  return config.enabled;",
              "}",
            ].join("\n"),
          },
        ],
      },
    });

    const changed = await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "def456",
        files: [
          {
            filePath: "src/player.ts",
            fileContent: [
              "export const config = { enabled: false };",
              "",
              "export function boot() {",
              "  return !config.enabled;",
              "}",
            ].join("\n"),
          },
        ],
      },
    });

    expect(changed.inserted).toBe(0);
    expect(changed.replaced).toBe(2);
    expect(changed.dedup).toBe(0);
    expect(changed.deleted).toBe(2);
    expect(changed.fileResults[0]?.replaced).toBe(2);

    const latestFunctionUpsert = harness.upsertCalls.filter((call) => call.symbolName === "boot").at(-1);
    expect(latestFunctionUpsert?.commitSha).toBe("def456");
    expect(latestFunctionUpsert?.chunkText).toContain("return !config.enabled;");
  });

  it("skips excluded files and surfaces exclusion observability without store writes", async () => {
    const harness = createStoreHarness();
    const logger = createMockLogger();

    const result = await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        files: [
          {
            filePath: "vendor/lib/generated.ts",
            fileContent: "export const ignored = true;\n",
          },
        ],
      },
    });

    expect(result.filesProcessed).toBe(0);
    expect(result.filesExcluded).toBe(1);
    expect(result.chunksAttempted).toBe(0);
    expect(result.inserted).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.fileResults[0]).toEqual({
      filePath: "vendor/lib/generated.ts",
      excluded: true,
      exclusionReason: "vendored",
      boundaryDecisions: [],
      chunkCount: 0,
      deletedCount: 0,
      inserted: 0,
      replaced: 0,
      dedup: 0,
    });
    expect(harness.deleteCalls).toHaveLength(0);
    expect(harness.upsertCalls).toHaveLength(0);
  });

  it("never writes to historical diff-hunk tables or store APIs", async () => {
    const harness = createStoreHarness();
    const logger = createMockLogger();

    await ingestCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: logger as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        files: [
          {
            filePath: "src/player.ts",
            fileContent: "export function boot() {\n  return true;\n}\n",
          },
        ],
      },
    });

    expect(harness.upsertCalls.every((call) => !("prNumber" in (call as unknown as Record<string, unknown>)))).toBe(true);
    expect(harness.upsertCalls.every((call) => !("prTitle" in (call as unknown as Record<string, unknown>)))).toBe(true);
    expect(harness.upsertCalls.every((call) => !("functionContext" in (call as unknown as Record<string, unknown>)))).toBe(true);
    expect(harness.deleteCalls).toHaveLength(1);
  });

  it("fails fast when embeddings are unavailable", async () => {
    const harness = createStoreHarness();
    const logger = createMockLogger();

    await expect(
      ingestCanonicalCodeSnapshot({
        store: harness.store,
        embeddingProvider: {
          async generate() {
            return null;
          },
        },
        logger: logger as never,
        request: {
          repo: "kodi",
          owner: "xbmc",
          canonicalRef: "main",
          commitSha: "abc123",
          files: [
            {
              filePath: "src/player.ts",
              fileContent: "export function boot() {\n  return true;\n}\n",
            },
          ],
        },
      }),
    ).rejects.toThrow("Embedding unavailable for canonical chunk src/player.ts:1-3");
  });
});
