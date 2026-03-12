import { describe, expect, test, mock } from "bun:test";

type RepairCandidateRow = {
  id: number;
  page_id: number;
  page_title: string;
  chunk_index: number;
  token_count: number;
  chunk_text: string;
  embedding_model: string | null;
  embedding: unknown;
  stale: boolean;
  deleted: boolean;
};

type RepairWindow = {
  page_id: number;
  page_title: string;
  window_index: number;
  windows_total: number;
  chunk_ids: number[];
  chunk_indexes: number[];
  approx_tokens: number;
};

type WikiRepairModule = {
  TARGET_WIKI_EMBEDDING_MODEL: string;
  DEFAULT_REPAIR_LIMITS: {
    maxChunksPerWindow: number;
    maxApproxTokensPerWindow: number;
    minChunksPerWindow: number;
    maxTransientRetries: number;
  };
  buildWikiRepairPlan: (input: {
    rows: RepairCandidateRow[];
    targetModel?: string;
    checkpoint?: {
      page_id: number | null;
      window_index: number | null;
    } | null;
    limits?: {
      maxChunksPerWindow?: number;
      maxApproxTokensPerWindow?: number;
    };
  }) => {
    target_model: string;
    total_pages: number;
    total_chunks: number;
    resume_from: {
      page_id: number | null;
      window_index: number | null;
    } | null;
    pages: Array<{
      page_id: number;
      page_title: string;
      chunk_ids: number[];
      windows: RepairWindow[];
    }>;
  };
  splitWikiRepairWindows: (rows: RepairCandidateRow[], limits?: {
    maxChunksPerWindow?: number;
    maxApproxTokensPerWindow?: number;
  }) => RepairWindow[];
  runWikiEmbeddingRepair: (input: {
    pageTitle?: string;
    resume?: boolean;
    limits?: {
      maxChunksPerWindow?: number;
      maxApproxTokensPerWindow?: number;
      minChunksPerWindow?: number;
      maxTransientRetries?: number;
    };
    logger?: {
      info?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
      debug?: (...args: unknown[]) => void;
    };
    store: {
      listRepairCandidates: (params?: { pageTitle?: string }) => Promise<RepairCandidateRow[]>;
      getRepairCheckpoint: () => Promise<{
        page_id: number | null;
        page_title: string | null;
        window_index: number | null;
        repaired: number;
        skipped: number;
        failed: number;
        last_failure_class: string | null;
      } | null>;
      saveRepairCheckpoint: (state: {
        page_id: number | null;
        page_title: string | null;
        window_index: number | null;
        windows_total: number | null;
        repaired: number;
        skipped: number;
        failed: number;
        last_failure_class: string | null;
        last_failure_message: string | null;
        updated_at?: string;
      }) => Promise<void>;
      writeRepairEmbeddingsBatch: (payload: {
        page_id: number;
        page_title: string;
        chunk_ids: number[];
        target_model: string;
        embeddings: Array<{ chunk_id: number; embedding: Float32Array }>;
      }) => Promise<void>;
    };
    embedWindow: (window: RepairWindow, attempt: number) => Promise<
      | {
          status: "ok";
          embeddings: Array<{ chunk_id: number; embedding: Float32Array }>;
          retry_count?: number;
        }
      | {
          status: "failed";
          failure_class: string;
          message: string;
          retryable: boolean;
          should_split: boolean;
        }
    >;
  }) => Promise<{
    success: boolean;
    status_code: string;
    target_model: string;
    resumed: boolean;
    repaired: number;
    skipped: number;
    failed: number;
    used_split_fallback: boolean;
    progress: Array<{
      page_id: number;
      page_title: string;
      window_index: number;
      windows_total: number;
      repaired: number;
      skipped: number;
      failed: number;
      failure_class: string | null;
      retry_count: number;
      target_model: string;
    }>;
    cursor: {
      page_id: number | null;
      page_title: string | null;
      window_index: number | null;
      windows_total: number | null;
    };
  }>;
};

async function loadWikiRepairModule(): Promise<WikiRepairModule> {
  try {
    return await import("./wiki-embedding-repair.ts") as WikiRepairModule;
  } catch (error) {
    throw new Error(
      "Missing S02 implementation: expected src/knowledge/wiki-embedding-repair.ts to export TARGET_WIKI_EMBEDDING_MODEL, DEFAULT_REPAIR_LIMITS, buildWikiRepairPlan(), splitWikiRepairWindows(), and runWikiEmbeddingRepair() for the bounded wiki repair contract.",
      { cause: error },
    );
  }
}

function makeRow(overrides: Partial<RepairCandidateRow> = {}): RepairCandidateRow {
  return {
    id: overrides.id ?? 1,
    page_id: overrides.page_id ?? 101,
    page_title: overrides.page_title ?? "JSON-RPC API/v8",
    chunk_index: overrides.chunk_index ?? 0,
    token_count: overrides.token_count ?? 400,
    chunk_text: overrides.chunk_text ?? `chunk-${overrides.id ?? 1}`,
    embedding_model: overrides.embedding_model ?? "voyage-code-3",
    embedding: overrides.embedding ?? new Float32Array([0.1, 0.2]),
    stale: overrides.stale ?? false,
    deleted: overrides.deleted ?? false,
  };
}

function makeEmbedding(seed: number): Float32Array {
  return new Float32Array([seed, seed + 0.01, seed + 0.02]);
}

describe("wiki repair contract for src/knowledge/wiki-embedding-repair.ts", () => {
  test("buildWikiRepairPlan repairs only degraded wiki rows and keeps wiki pinned to voyage-context-3", async () => {
    const module = await loadWikiRepairModule();

    expect(module.TARGET_WIKI_EMBEDDING_MODEL).toBe("voyage-context-3");
    expect(module.DEFAULT_REPAIR_LIMITS.maxChunksPerWindow).toBeGreaterThan(0);
    expect(module.DEFAULT_REPAIR_LIMITS.maxApproxTokensPerWindow).toBeGreaterThan(0);
    expect(module.DEFAULT_REPAIR_LIMITS.minChunksPerWindow).toBeGreaterThan(0);
    expect(module.DEFAULT_REPAIR_LIMITS.maxTransientRetries).toBeGreaterThanOrEqual(1);

    const plan = module.buildWikiRepairPlan({
      rows: [
        makeRow({ id: 1, page_id: 101, page_title: "JSON-RPC API/v8", chunk_index: 0, embedding_model: "voyage-code-3" }),
        makeRow({ id: 2, page_id: 101, page_title: "JSON-RPC API/v8", chunk_index: 1, embedding_model: "voyage-context-3", stale: true }),
        makeRow({ id: 3, page_id: 101, page_title: "JSON-RPC API/v8", chunk_index: 2, embedding_model: null, embedding: null }),
        makeRow({ id: 4, page_id: 102, page_title: "Healthy page", chunk_index: 0, embedding_model: "voyage-context-3", stale: false }),
        makeRow({ id: 5, page_id: 103, page_title: "Deleted page", chunk_index: 0, embedding_model: null, embedding: null, deleted: true }),
      ],
    });

    expect(plan.target_model).toBe("voyage-context-3");
    expect(plan.total_pages).toBe(1);
    expect(plan.total_chunks).toBe(3);
    expect(plan.resume_from).toBeNull();
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]).toMatchObject({
      page_id: 101,
      page_title: "JSON-RPC API/v8",
      chunk_ids: [1, 2, 3],
    });
  });

  test("splitWikiRepairWindows preserves chunk order and uses conservative bounded windows instead of whole-page requests", async () => {
    const module = await loadWikiRepairModule();

    const windows = module.splitWikiRepairWindows([
      makeRow({ id: 11, chunk_index: 0, token_count: 550 }),
      makeRow({ id: 12, chunk_index: 1, token_count: 500 }),
      makeRow({ id: 13, chunk_index: 2, token_count: 450 }),
      makeRow({ id: 14, chunk_index: 3, token_count: 440 }),
      makeRow({ id: 15, chunk_index: 4, token_count: 430 }),
    ], {
      maxChunksPerWindow: 2,
      maxApproxTokensPerWindow: 1100,
    });

    expect(windows).toEqual([
      {
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 0,
        windows_total: 3,
        chunk_ids: [11, 12],
        chunk_indexes: [0, 1],
        approx_tokens: 1050,
      },
      {
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 1,
        windows_total: 3,
        chunk_ids: [13, 14],
        chunk_indexes: [2, 3],
        approx_tokens: 890,
      },
      {
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 2,
        windows_total: 3,
        chunk_ids: [15],
        chunk_indexes: [4],
        approx_tokens: 430,
      },
    ]);
  });

  test("runWikiEmbeddingRepair splits only on size failures, retries transient timeouts in-place, batches writes per window, and advances checkpoints after each bounded unit", async () => {
    const module = await loadWikiRepairModule();

    const rows = [
      makeRow({ id: 21, chunk_index: 0, token_count: 300 }),
      makeRow({ id: 22, chunk_index: 1, token_count: 300 }),
      makeRow({ id: 23, chunk_index: 2, token_count: 300 }),
      makeRow({ id: 24, chunk_index: 3, token_count: 300 }),
    ];

    const checkpointStates: Array<Record<string, unknown>> = [];
    const writeBatches: Array<Record<string, unknown>> = [];
    const embedCalls: Array<{ chunk_ids: number[]; attempt: number }> = [];

    const timeoutFailures = new Map<string, number>();
    const store = {
      listRepairCandidates: mock(async () => rows),
      getRepairCheckpoint: mock(async () => null),
      saveRepairCheckpoint: mock(async (state) => {
        checkpointStates.push(state as unknown as Record<string, unknown>);
      }),
      writeRepairEmbeddingsBatch: mock(async (payload) => {
        writeBatches.push(payload as unknown as Record<string, unknown>);
      }),
    };

    const result = await module.runWikiEmbeddingRepair({
      store,
      limits: {
        maxChunksPerWindow: 4,
        maxApproxTokensPerWindow: 1600,
        minChunksPerWindow: 1,
        maxTransientRetries: 1,
      },
      embedWindow: async (window, attempt) => {
        embedCalls.push({ chunk_ids: [...window.chunk_ids], attempt });
        const key = window.chunk_ids.join(",");

        if (key === "21,22,23,24") {
          return {
            status: "failed",
            failure_class: "request_too_large",
            message: "window exceeds conservative size budget",
            retryable: false,
            should_split: true,
          };
        }

        if (key === "23,24") {
          const seen = timeoutFailures.get(key) ?? 0;
          timeoutFailures.set(key, seen + 1);
          if (seen === 0) {
            return {
              status: "failed",
              failure_class: "timeout_transient",
              message: "provider timed out",
              retryable: true,
              should_split: false,
            };
          }
        }

        return {
          status: "ok",
          embeddings: window.chunk_ids.map((chunk_id, index) => ({
            chunk_id,
            embedding: makeEmbedding(chunk_id + index),
          })),
          retry_count: attempt,
        };
      },
    });

    expect(embedCalls).toEqual([
      { chunk_ids: [21, 22, 23, 24], attempt: 0 },
      { chunk_ids: [21, 22], attempt: 0 },
      { chunk_ids: [23, 24], attempt: 0 },
      { chunk_ids: [23, 24], attempt: 1 },
    ]);
    expect(writeBatches).toEqual([
      expect.objectContaining({
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        chunk_ids: [21, 22],
        target_model: "voyage-context-3",
      }),
      expect.objectContaining({
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        chunk_ids: [23, 24],
        target_model: "voyage-context-3",
      }),
    ]);
    expect(checkpointStates).toEqual([
      expect.objectContaining({
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 0,
        windows_total: 2,
        repaired: 2,
        failed: 0,
        last_failure_class: null,
      }),
      expect.objectContaining({
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 1,
        windows_total: 2,
        repaired: 4,
        failed: 0,
        last_failure_class: null,
      }),
    ]);
    expect(result).toMatchObject({
      success: true,
      status_code: "repair_completed",
      target_model: "voyage-context-3",
      resumed: false,
      repaired: 4,
      skipped: 0,
      failed: 0,
      used_split_fallback: true,
      cursor: {
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 1,
        windows_total: 2,
      },
    });
    expect(result.progress).toEqual([
      expect.objectContaining({
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 0,
        windows_total: 2,
        repaired: 2,
        failed: 0,
        failure_class: null,
        retry_count: 0,
        target_model: "voyage-context-3",
      }),
      expect.objectContaining({
        page_id: 101,
        page_title: "JSON-RPC API/v8",
        window_index: 1,
        windows_total: 2,
        repaired: 4,
        failed: 0,
        failure_class: null,
        retry_count: 1,
        target_model: "voyage-context-3",
      }),
    ]);
  });

  test("runWikiEmbeddingRepair resumes from persisted page-window checkpoints instead of restarting at page 1", async () => {
    const module = await loadWikiRepairModule();

    const rows = [
      makeRow({ id: 31, page_id: 200, page_title: "Resume target", chunk_index: 0, token_count: 200 }),
      makeRow({ id: 32, page_id: 200, page_title: "Resume target", chunk_index: 1, token_count: 200 }),
      makeRow({ id: 33, page_id: 200, page_title: "Resume target", chunk_index: 2, token_count: 200 }),
      makeRow({ id: 34, page_id: 200, page_title: "Resume target", chunk_index: 3, token_count: 200 }),
      makeRow({ id: 35, page_id: 200, page_title: "Resume target", chunk_index: 4, token_count: 200 }),
    ];

    const embedCalls: number[][] = [];
    const checkpointStates: Array<Record<string, unknown>> = [];

    const store = {
      listRepairCandidates: mock(async () => rows),
      getRepairCheckpoint: mock(async () => ({
        page_id: 200,
        page_title: "Resume target",
        window_index: 1,
        repaired: 2,
        skipped: 0,
        failed: 0,
        last_failure_class: null,
      })),
      saveRepairCheckpoint: mock(async (state) => {
        checkpointStates.push(state as unknown as Record<string, unknown>);
      }),
      writeRepairEmbeddingsBatch: mock(async () => undefined),
    };

    const result = await module.runWikiEmbeddingRepair({
      store,
      resume: true,
      limits: {
        maxChunksPerWindow: 2,
        maxApproxTokensPerWindow: 500,
        minChunksPerWindow: 1,
        maxTransientRetries: 1,
      },
      embedWindow: async (window) => {
        embedCalls.push([...window.chunk_ids]);
        return {
          status: "ok",
          embeddings: window.chunk_ids.map((chunk_id) => ({ chunk_id, embedding: makeEmbedding(chunk_id) })),
        };
      },
    });

    expect(embedCalls).toEqual([
      [33, 34],
      [35],
    ]);
    expect(checkpointStates).toEqual([
      expect.objectContaining({
        page_id: 200,
        page_title: "Resume target",
        window_index: 1,
        windows_total: 3,
        repaired: 4,
      }),
      expect.objectContaining({
        page_id: 200,
        page_title: "Resume target",
        window_index: 2,
        windows_total: 3,
        repaired: 5,
      }),
    ]);
    expect(result).toMatchObject({
      success: true,
      status_code: "repair_completed",
      resumed: true,
      repaired: 5,
      cursor: {
        page_id: 200,
        page_title: "Resume target",
        window_index: 2,
        windows_total: 3,
      },
    });
  });
});
