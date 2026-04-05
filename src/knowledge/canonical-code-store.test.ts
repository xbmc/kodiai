/**
 * Tests for canonical-code-store.ts
 *
 * All tests use a mock SQL client — no live database required.
 * The mock tracks SQL calls by position and returns pre-configured responses.
 */

import { describe, it, expect, mock } from "bun:test";
import { createCanonicalCodeStore } from "./canonical-code-store.ts";
import type { CanonicalChunkWriteInput, CanonicalCorpusBackfillState } from "./canonical-code-types.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * A mock SQL client that returns queued responses in FIFO order.
 * Also records every call for assertion.
 */
function createMockSql(responses: unknown[][] = []) {
  const queue = [...responses];
  const calls: Array<{ template: string; values: unknown[] }> = [];

  function sqlFn(strings: TemplateStringsArray, ...values: unknown[]) {
    const template = strings.join("?");
    calls.push({ template, values });
    const response = queue.shift() ?? [];
    return Promise.resolve(response);
  }

  // Support sql.begin(callback) used by updateEmbeddingsBatch
  sqlFn.begin = async (callback: (tx: unknown) => Promise<void>) => {
    const unsafeCalls: unknown[] = [];
    const mockTx = {
      unsafe: (_query: string, _params: unknown[]) => {
        unsafeCalls.push({ _query, _params });
        return Promise.resolve();
      },
    };
    await callback(mockTx);
    calls.push({ template: "BEGIN/COMMIT", values: unsafeCalls });
  };

  return {
    sql: sqlFn as unknown as import("../db/client.ts").Sql,
    calls,
  };
}

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as unknown as import("pino").Logger;
}

function makeWriteInput(overrides: Partial<CanonicalChunkWriteInput> = {}): CanonicalChunkWriteInput {
  return {
    repo: "kodi",
    owner: "xbmc",
    canonicalRef: "main",
    commitSha: "abc123",
    filePath: "xbmc/Application.cpp",
    language: "cpp",
    startLine: 10,
    endLine: 40,
    chunkType: "function",
    symbolName: "CApplication::OnAppInit",
    chunkText: "void CApplication::OnAppInit() { /* ... */ }",
    contentHash: "sha256:aaaa",
    embeddingModel: "voyage-4",
    ...overrides,
  };
}

function makeEmbedding(): Float32Array {
  const arr = new Float32Array(1024);
  arr[0] = 0.1;
  arr[1] = 0.9;
  return arr;
}

// ── createCanonicalCodeStore ──────────────────────────────────────────────────

describe("createCanonicalCodeStore", () => {
  it("returns an object with all required methods", () => {
    const { sql } = createMockSql();
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    expect(store.upsertChunk).toBeDefined();
    expect(store.deleteChunksForFile).toBeDefined();
    expect(store.searchByEmbedding).toBeDefined();
    expect(store.searchByFullText).toBeDefined();
    expect(store.countChunks).toBeDefined();
    expect(store.listStaleChunks).toBeDefined();
    expect(store.markStale).toBeDefined();
    expect(store.updateEmbeddingsBatch).toBeDefined();
    expect(store.getBackfillState).toBeDefined();
    expect(store.saveBackfillState).toBeDefined();
    expect(store.close).toBeDefined();
  });
});

// ── upsertChunk ───────────────────────────────────────────────────────────────

describe("upsertChunk", () => {
  it("returns 'inserted' when no existing row", async () => {
    // First query (SELECT existing) returns empty; second (INSERT) returns empty.
    const { sql } = createMockSql([[], []]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const result = await store.upsertChunk(makeWriteInput(), makeEmbedding());
    expect(result).toBe("inserted");
  });

  it("returns 'dedup' when existing row has matching content_hash", async () => {
    const existingRow = [{ id: "1", content_hash: "sha256:aaaa" }];
    // SELECT returns existing row; no further query for dedup path.
    const { sql } = createMockSql([existingRow]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const result = await store.upsertChunk(makeWriteInput(), makeEmbedding());
    expect(result).toBe("dedup");
  });

  it("returns 'replaced' when existing row has different content_hash", async () => {
    const existingRow = [{ id: "1", content_hash: "sha256:OLD" }];
    // SELECT returns old row; UPDATE returns empty success.
    const { sql } = createMockSql([existingRow, []]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const result = await store.upsertChunk(makeWriteInput(), makeEmbedding());
    expect(result).toBe("replaced");
  });

  it("handles null symbolName (fallback block chunk)", async () => {
    const { sql } = createMockSql([[], []]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });
    const input = makeWriteInput({ symbolName: null, chunkType: "block" });

    const result = await store.upsertChunk(input, makeEmbedding());
    expect(result).toBe("inserted");
  });

  it("throws and logs on SQL error during insert", async () => {
    const sqlFn = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        // First call (SELECT) resolves empty; second (INSERT) rejects.
        if ((sqlFn as { callCount?: number }).callCount === 0) {
          (sqlFn as { callCount?: number }).callCount = 1;
          return Promise.resolve([]);
        }
        return Promise.reject(new Error("DB connection lost"));
      },
      { callCount: 0 },
    );

    const logger = createMockLogger();
    const store = createCanonicalCodeStore({
      sql: sqlFn as unknown as import("../db/client.ts").Sql,
      logger,
    });

    await expect(store.upsertChunk(makeWriteInput(), makeEmbedding())).rejects.toThrow(
      "DB connection lost",
    );
    expect((logger.error as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });
});

// ── deleteChunksForFile ───────────────────────────────────────────────────────

describe("deleteChunksForFile", () => {
  it("returns count of soft-deleted rows", async () => {
    // Mock UPDATE result with count property.
    const mockResult = Object.assign([], { count: 3 });
    const { sql } = createMockSql([mockResult]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const count = await store.deleteChunksForFile({
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      filePath: "xbmc/Application.cpp",
    });
    expect(count).toBe(3);
  });

  it("returns 0 when no rows matched", async () => {
    const mockResult = Object.assign([], { count: 0 });
    const { sql } = createMockSql([mockResult]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const count = await store.deleteChunksForFile({
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      filePath: "nonexistent/file.cpp",
    });
    expect(count).toBe(0);
  });

  it("throws and logs on SQL error", async () => {
    const sqlFn = (_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.reject(new Error("lock timeout"));
    const logger = createMockLogger();
    const store = createCanonicalCodeStore({
      sql: sqlFn as unknown as import("../db/client.ts").Sql,
      logger,
    });

    await expect(
      store.deleteChunksForFile({
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        filePath: "xbmc/Application.cpp",
      }),
    ).rejects.toThrow("lock timeout");
    expect((logger.error as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });
});

// ── searchByEmbedding ─────────────────────────────────────────────────────────

describe("searchByEmbedding", () => {
  const sampleRow = {
    id: "42",
    repo: "kodi",
    owner: "xbmc",
    canonical_ref: "main",
    commit_sha: "abc123",
    file_path: "xbmc/Application.cpp",
    language: "cpp",
    start_line: "10",
    end_line: "40",
    chunk_type: "function",
    symbol_name: "CApplication::OnAppInit",
    chunk_text: "void CApplication::OnAppInit() {}",
    content_hash: "sha256:aaaa",
    embedding_model: "voyage-4",
    distance: "0.23",
    stale: false,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("returns mapped search results", async () => {
    const { sql } = createMockSql([[sampleRow]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const results = await store.searchByEmbedding({
      queryEmbedding: makeEmbedding(),
      repo: "kodi",
      canonicalRef: "main",
      topK: 5,
    });

    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.id).toBe(BigInt(42));
    expect(r.repo).toBe("kodi");
    expect(r.filePath).toBe("xbmc/Application.cpp");
    expect(r.language).toBe("cpp");
    expect(r.chunkType).toBe("function");
    expect(r.symbolName).toBe("CApplication::OnAppInit");
    expect(r.distance).toBeCloseTo(0.23);
  });

  it("returns empty array when no rows match", async () => {
    const { sql } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const results = await store.searchByEmbedding({
      queryEmbedding: makeEmbedding(),
      repo: "kodi",
      canonicalRef: "main",
      topK: 5,
    });
    expect(results).toHaveLength(0);
  });

  it("applies language filter when provided", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.searchByEmbedding({
      queryEmbedding: makeEmbedding(),
      repo: "kodi",
      canonicalRef: "main",
      topK: 5,
      language: "cpp",
    });

    // The first call should contain a language filter in its SQL template values.
    expect(calls[0]!.values).toContain("cpp");
  });
});

// ── searchByFullText ──────────────────────────────────────────────────────────

describe("searchByFullText", () => {
  it("returns empty array for blank query", async () => {
    const { sql } = createMockSql([]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const results = await store.searchByFullText({
      query: "   ",
      repo: "kodi",
      canonicalRef: "main",
      topK: 5,
    });
    expect(results).toHaveLength(0);
  });

  it("returns mapped results for non-empty query", async () => {
    const row = {
      id: "7",
      repo: "kodi",
      owner: "xbmc",
      canonical_ref: "main",
      commit_sha: "def456",
      file_path: "xbmc/Util.cpp",
      language: "cpp",
      start_line: "1",
      end_line: "20",
      chunk_type: "function",
      symbol_name: null,
      chunk_text: "helper function text",
      content_hash: "sha256:bbbb",
      embedding_model: "voyage-4",
      distance: "0.5",
      stale: false,
      deleted_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const { sql } = createMockSql([[row]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const results = await store.searchByFullText({
      query: "helper function",
      repo: "kodi",
      canonicalRef: "main",
      topK: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBeNull();
  });

  it("applies language filter when provided", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.searchByFullText({
      query: "parse",
      repo: "kodi",
      canonicalRef: "main",
      topK: 5,
      language: "python",
    });
    expect(calls[0]!.values).toContain("python");
  });
});

// ── countChunks ───────────────────────────────────────────────────────────────

describe("countChunks", () => {
  it("returns total from DB", async () => {
    const { sql } = createMockSql([[{ total: 42 }]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const count = await store.countChunks({ repo: "kodi", canonicalRef: "main" });
    expect(count).toBe(42);
  });

  it("returns 0 when no rows", async () => {
    const { sql } = createMockSql([[{ total: 0 }]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const count = await store.countChunks({ repo: "kodi", canonicalRef: "main" });
    expect(count).toBe(0);
  });

  it("returns 0 when query returns empty array", async () => {
    const { sql } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const count = await store.countChunks({ repo: "kodi", canonicalRef: "main" });
    expect(count).toBe(0);
  });
});

// ── listStaleChunks ───────────────────────────────────────────────────────────

describe("listStaleChunks", () => {
  it("returns hydrated CanonicalCodeChunk objects", async () => {
    const row = {
      id: "99",
      repo: "kodi",
      owner: "xbmc",
      canonical_ref: "main",
      commit_sha: "abc999",
      file_path: "xbmc/Stale.cpp",
      language: "cpp",
      start_line: "5",
      end_line: "15",
      chunk_type: "method",
      symbol_name: "SomeClass::staleMethod",
      chunk_text: "void staleMethod() {}",
      content_hash: "sha256:cccc",
      embedding: null,
      embedding_model: null,
      stale: true,
      deleted_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const { sql } = createMockSql([[row]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const chunks = await store.listStaleChunks({
      repo: "kodi",
      canonicalRef: "main",
      targetModel: "voyage-4",
      limit: 100,
    });

    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(c.id).toBe(BigInt(99));
    expect(c.stale).toBe(true);
    expect(c.embeddingModel).toBeNull();
    expect(c.chunkType).toBe("method");
  });

  it("returns empty array when no stale chunks", async () => {
    const { sql } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const chunks = await store.listStaleChunks({
      repo: "kodi",
      canonicalRef: "main",
      targetModel: "voyage-4",
      limit: 100,
    });
    expect(chunks).toHaveLength(0);
  });
});

// ── markStale ─────────────────────────────────────────────────────────────────

describe("markStale", () => {
  it("is a no-op for empty array (no SQL call)", async () => {
    const { sql, calls } = createMockSql([]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.markStale([]);
    expect(calls).toHaveLength(0);
  });

  it("calls SQL UPDATE with BigInt ids for non-empty array", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.markStale([BigInt(1), BigInt(2), BigInt(3)]);
    expect(calls).toHaveLength(1);
    // Values should include the string-serialized bigint array
    const values = calls[0]!.values.flat();
    expect(values).toContain("1");
    expect(values).toContain("2");
    expect(values).toContain("3");
  });
});

// ── updateEmbeddingsBatch ─────────────────────────────────────────────────────

describe("updateEmbeddingsBatch", () => {
  it("is a no-op for empty embeddings array", async () => {
    const beginCalls: unknown[] = [];
    const sqlFn = Object.assign(
      (_strings: TemplateStringsArray) => Promise.resolve([]),
      {
        begin: (cb: () => Promise<void>) => {
          beginCalls.push(cb);
          return Promise.resolve();
        },
      },
    );
    const store = createCanonicalCodeStore({
      sql: sqlFn as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    await store.updateEmbeddingsBatch({ embeddings: [], targetModel: "voyage-4" });
    expect(beginCalls).toHaveLength(0);
  });

  it("calls sql.begin for non-empty batch", async () => {
    const { sql, calls } = createMockSql([]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.updateEmbeddingsBatch({
      embeddings: [{ id: BigInt(5), embedding: makeEmbedding() }],
      targetModel: "voyage-4",
    });

    const txCall = calls.find((c) => c.template === "BEGIN/COMMIT");
    expect(txCall).toBeDefined();
  });
});

// ── getBackfillState ──────────────────────────────────────────────────────────

describe("getBackfillState", () => {
  it("returns null when no row exists", async () => {
    const { sql } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const state = await store.getBackfillState({
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
    });
    expect(state).toBeNull();
  });

  it("maps row to CanonicalCorpusBackfillState correctly", async () => {
    const row = {
      repo: "kodi",
      owner: "xbmc",
      canonical_ref: "main",
      run_id: "run-xyz",
      status: "completed",
      files_total: "120",
      files_done: "120",
      chunks_total: "850",
      chunks_done: "840",
      chunks_skipped: "9",
      chunks_failed: "1",
      last_file_path: "xbmc/Application.cpp",
      commit_sha: "abc123",
      error_message: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };
    const { sql } = createMockSql([[row]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const state = await store.getBackfillState({
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
    });

    expect(state).not.toBeNull();
    expect(state!.runId).toBe("run-xyz");
    expect(state!.status).toBe("completed");
    expect(state!.filesTotal).toBe(120);
    expect(state!.chunksDone).toBe(840);
    expect(state!.chunksSkipped).toBe(9);
    expect(state!.chunksFailed).toBe(1);
    expect(state!.commitSha).toBe("abc123");
    expect(state!.errorMessage).toBeNull();
  });
});

// ── saveBackfillState ─────────────────────────────────────────────────────────

describe("saveBackfillState", () => {
  it("executes an upsert query", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const state: CanonicalCorpusBackfillState = {
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      runId: "run-abc",
      status: "running",
      filesTotal: 100,
      filesDone: 50,
      chunksTotal: 500,
      chunksDone: 250,
      chunksSkipped: 5,
      chunksFailed: 0,
      lastFilePath: "xbmc/Half.cpp",
      commitSha: "abc000",
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    await store.saveBackfillState(state);

    expect(calls).toHaveLength(1);
    const values = calls[0]!.values;
    expect(values).toContain("kodi");
    expect(values).toContain("run-abc");
    expect(values).toContain("running");
  });

  it("handles null filesTotal / chunksTotal gracefully", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const state: CanonicalCorpusBackfillState = {
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      runId: "run-new",
      status: "running",
      filesTotal: null,
      filesDone: 0,
      chunksTotal: null,
      chunksDone: 0,
      chunksSkipped: 0,
      chunksFailed: 0,
      lastFilePath: null,
      commitSha: null,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    await store.saveBackfillState(state);
    expect(calls).toHaveLength(1);
    const values = calls[0]!.values;
    expect(values).toContain(null);
  });
});

// ── close ─────────────────────────────────────────────────────────────────────

describe("close", () => {
  it("is a no-op — does not throw", () => {
    const { sql } = createMockSql();
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });
    expect(() => store.close()).not.toThrow();
  });
});

// ── Negative / boundary tests ─────────────────────────────────────────────────

describe("Negative and boundary conditions", () => {
  it("upsertChunk propagates SQL error from SELECT phase", async () => {
    const sqlFn = (_strings: TemplateStringsArray) =>
      Promise.reject(new Error("connection refused"));
    const store = createCanonicalCodeStore({
      sql: sqlFn as unknown as import("../db/client.ts").Sql,
      logger: createMockLogger(),
    });

    await expect(store.upsertChunk(makeWriteInput(), makeEmbedding())).rejects.toThrow(
      "connection refused",
    );
  });

  it("deleteChunksForFile treats undefined count as 0", async () => {
    // Result with no count property — simulates undefined from mock
    const mockResult = Object.assign([], {});
    const { sql } = createMockSql([mockResult]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const count = await store.deleteChunksForFile({
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      filePath: "any.cpp",
    });
    expect(count).toBe(0);
  });

  it("searchByEmbedding with zero topK passes value to SQL", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.searchByEmbedding({
      queryEmbedding: makeEmbedding(),
      repo: "kodi",
      canonicalRef: "main",
      topK: 0,
    });
    expect(calls[0]!.values).toContain(0);
  });

  it("listStaleChunks passes limit to SQL", async () => {
    const { sql, calls } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    await store.listStaleChunks({
      repo: "kodi",
      canonicalRef: "main",
      targetModel: "voyage-4",
      limit: 25,
    });
    expect(calls[0]!.values).toContain(25);
  });

  it("getBackfillState returns null when rows array is empty", async () => {
    const { sql } = createMockSql([[]]);
    const store = createCanonicalCodeStore({ sql, logger: createMockLogger() });

    const state = await store.getBackfillState({
      repo: "unknown-repo",
      owner: "unknown-owner",
      canonicalRef: "main",
    });
    expect(state).toBeNull();
  });
});
