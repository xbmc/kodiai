import { describe, expect, it, mock } from "bun:test";
import { updateCanonicalCodeSnapshot } from "./canonical-code-update.ts";
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

function createEmbeddingProvider(config?: {
  nullFor?: string[];
  throwFor?: string[];
}): Pick<EmbeddingProvider, "generate"> {
  return {
    async generate(text: string) {
      if (config?.throwFor?.some((needle) => text.includes(needle))) {
        throw new Error(`embedding exploded for ${text}`);
      }
      if (config?.nullFor?.some((needle) => text.includes(needle))) {
        return null;
      }
      return {
        embedding: new Float32Array([text.length, text.length / 10]),
        model: "voyage-test",
        dimensions: 2,
      };
    },
  };
}

type RowState = {
  contentHash: string;
  deleted: boolean;
};

function createStoreHarness(initialRows: CanonicalChunkWriteInput[] = []) {
  const listCalls: Array<{ repo: string; owner: string; canonicalRef: string; filePath: string }> = [];
  const deleteCalls: Array<{ repo: string; owner: string; canonicalRef: string; filePath: string }> = [];
  const upsertCalls: CanonicalChunkWriteInput[] = [];
  const state = new Map<string, RowState>();

  function chunkIdentity(input: Pick<CanonicalChunkWriteInput, "repo" | "owner" | "canonicalRef" | "filePath" | "chunkType" | "symbolName">): string {
    return [
      input.repo,
      input.owner,
      input.canonicalRef,
      input.filePath,
      input.chunkType,
      input.symbolName ?? "",
    ].join("|");
  }

  for (const row of initialRows) {
    state.set(chunkIdentity(row), { contentHash: row.contentHash, deleted: false });
  }

  return {
    listCalls,
    deleteCalls,
    upsertCalls,
    state,
    store: {
      async listChunksForFile(params: {
        repo: string;
        owner: string;
        canonicalRef: string;
        filePath: string;
      }) {
        listCalls.push(params);
        let id = 1n;
        return [...state.entries()]
          .filter(([identity, row]) => {
            return !row.deleted && identity.startsWith(`${params.repo}|${params.owner}|${params.canonicalRef}|${params.filePath}|`);
          })
          .map(([identity, row]) => {
            const parts = identity.split("|");
            const filePath = parts[3] ?? params.filePath;
            const chunkType = (parts[4] ?? "block") as CanonicalChunkWriteInput["chunkType"];
            const symbolName = parts[5] ?? "";
            const result = {
              id,
              filePath,
              chunkType,
              symbolName: symbolName ? symbolName : null,
              contentHash: row.contentHash,
            };
            id += 1n;
            return result;
          });
      },
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
  };
}

const MODULE_HASH = "2cf70c8516307f5fefd094fb9f66300c9be2900212b9a56d28cd4f34d3e21465";
const FUNCTION_HASH = "5493b6cb5745787ae27cf11456fdfa17e597d683c59544f0ddd9247cd9b0a213";

describe("updateCanonicalCodeSnapshot", () => {
  it("skips unchanged chunks without rewriting live rows", async () => {
    const existingRows: CanonicalChunkWriteInput[] = [
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 1,
        endLine: 1,
        chunkType: "module",
        symbolName: null,
        chunkText: "export const config = { enabled: true };",
        contentHash: MODULE_HASH,
        embeddingModel: "voyage-test",
      },
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 3,
        endLine: 5,
        chunkType: "function",
        symbolName: "boot",
        chunkText: "export function boot() {\n  return config.enabled;\n}",
        contentHash: FUNCTION_HASH,
        embeddingModel: "voyage-test",
      },
    ];
    const harness = createStoreHarness(existingRows);

    const result = await updateCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: createMockLogger() as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "def456",
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

    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.failed).toBe(0);
    expect(harness.deleteCalls).toHaveLength(0);
    expect(harness.upsertCalls).toHaveLength(0);
  });

  it("updates only changed chunks while preserving unchanged siblings", async () => {
    const existingRows: CanonicalChunkWriteInput[] = [
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 1,
        endLine: 1,
        chunkType: "module",
        symbolName: null,
        chunkText: "export const config = { enabled: true };",
        contentHash: MODULE_HASH,
        embeddingModel: "voyage-test",
      },
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 3,
        endLine: 5,
        chunkType: "function",
        symbolName: "boot",
        chunkText: "export function boot() {\n  return config.enabled;\n}",
        contentHash: FUNCTION_HASH,
        embeddingModel: "voyage-test",
      },
    ];
    const harness = createStoreHarness(existingRows);

    const result = await updateCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: createMockLogger() as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "def456",
        files: [
          {
            filePath: "src/player.ts",
            fileContent: [
              "export const config = { enabled: true };",
              "",
              "export function boot() {",
              "  return !config.enabled;",
              "}",
            ].join("\n"),
          },
        ],
      },
    });

    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.removed).toBe(0);
    expect(harness.deleteCalls).toHaveLength(0);
    expect(harness.upsertCalls).toHaveLength(1);
    expect(harness.upsertCalls[0]?.symbolName).toBe("boot");
    expect(harness.upsertCalls[0]?.commitSha).toBe("def456");
    expect(harness.upsertCalls[0]?.chunkText).toContain("return !config.enabled;");
  });

  it("removes stale identities when a changed file drops a chunk", async () => {
    const existingRows: CanonicalChunkWriteInput[] = [
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 1,
        endLine: 1,
        chunkType: "module",
        symbolName: null,
        chunkText: "export const config = { enabled: true };",
        contentHash: MODULE_HASH,
        embeddingModel: "voyage-test",
      },
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 3,
        endLine: 5,
        chunkType: "function",
        symbolName: "boot",
        chunkText: "export function boot() {\n  return config.enabled;\n}",
        contentHash: FUNCTION_HASH,
        embeddingModel: "voyage-test",
      },
    ];
    const harness = createStoreHarness(existingRows);

    const result = await updateCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: createMockLogger() as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "def456",
        files: [
          {
            filePath: "src/player.ts",
            fileContent: "export const config = { enabled: true };\n",
          },
        ],
      },
    });

    expect(result.removed).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(harness.deleteCalls).toEqual([
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        filePath: "src/player.ts",
      },
    ]);
    expect(harness.upsertCalls).toHaveLength(1);
    expect(harness.upsertCalls[0]?.chunkType).toBe("block");
  });

  it("skips excluded files without inspecting or rewriting store rows", async () => {
    const harness = createStoreHarness();

    const result = await updateCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider(),
      logger: createMockLogger() as never,
      request: {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "def456",
        files: [
          {
            filePath: "vendor/generated.ts",
            fileContent: "export const ignored = true;\n",
          },
        ],
      },
    });

    expect(result.filesProcessed).toBe(0);
    expect(result.filesExcluded).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(harness.listCalls).toHaveLength(0);
    expect(harness.deleteCalls).toHaveLength(0);
    expect(harness.upsertCalls).toHaveLength(0);
  });

  it("fails open when embeddings are unavailable for a changed chunk", async () => {
    const existingRows: CanonicalChunkWriteInput[] = [
      {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        commitSha: "abc123",
        filePath: "src/player.ts",
        language: "TypeScript",
        startLine: 3,
        endLine: 5,
        chunkType: "function",
        symbolName: "boot",
        chunkText: "export function boot() {\n  return config.enabled;\n}",
        contentHash: FUNCTION_HASH,
        embeddingModel: "voyage-test",
      },
    ];
    const harness = createStoreHarness(existingRows);
    const logger = createMockLogger();

    const result = await updateCanonicalCodeSnapshot({
      store: harness.store,
      embeddingProvider: createEmbeddingProvider({ nullFor: ["!config.enabled"] }),
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
              "export function boot() {",
              "  return !config.enabled;",
              "}",
            ].join("\n"),
          },
        ],
      },
    });

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(harness.upsertCalls).toHaveLength(0);
    expect((logger.warn as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });
});
