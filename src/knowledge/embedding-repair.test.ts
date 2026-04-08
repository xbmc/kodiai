import { describe, expect, test, mock } from "bun:test";
import { buildCommentEmbeddingText, buildIssueEmbeddingText } from "./issue-comment-chunker.ts";
import { buildEmbeddingText } from "./code-snippet-chunker.ts";

type EmbeddingRepairCorpus = "review_comments" | "learning_memories" | "code_snippets" | "issues" | "issue_comments" | "canonical_code";

type RepairCandidateRow = {
  id: number;
  corpus: EmbeddingRepairCorpus;
  embedding_model: string | null;
  embedding: unknown;
  stale?: boolean;
  deleted?: boolean;
  chunk_text?: string;
  finding_text?: string;
  severity?: string;
  category?: string;
  file_path?: string;
  embedded_text?: string;
  language?: string | null;
  issue_number?: number;
  issue_title?: string;
  title?: string;
  body?: string | null;
  comment_body?: string;
};

type EmbeddingRepairModule = {
  NON_WIKI_TARGET_EMBEDDING_MODEL: string;
  NON_WIKI_REPAIR_CORPORA: readonly EmbeddingRepairCorpus[];
  STALE_SUPPORTED_CORPORA: readonly EmbeddingRepairCorpus[];
  buildRepairEmbeddingText: (corpus: EmbeddingRepairCorpus, row: RepairCandidateRow) => string;
  createReviewCommentRepairStore: (store: Record<string, unknown>) => {
    listRepairCandidates: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
    getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<unknown>;
    saveRepairState: (state: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
    writeRepairEmbeddingsBatch: (payload: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
  };
  createIssueRepairStore: (store: Record<string, unknown>, corpus: "issues" | "issue_comments") => {
    listRepairCandidates: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
    getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<unknown>;
    saveRepairState: (state: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
    writeRepairEmbeddingsBatch: (payload: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
  };
  createLearningMemoryRepairStore: (store: Record<string, unknown>) => {
    listRepairCandidates: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
    getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<unknown>;
    saveRepairState: (state: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
    writeRepairEmbeddingsBatch: (payload: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
  };
  createCodeSnippetRepairStore: (store: Record<string, unknown>) => {
    listRepairCandidates: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
    getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<unknown>;
    saveRepairState: (state: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
    writeRepairEmbeddingsBatch: (payload: { corpus: EmbeddingRepairCorpus }) => Promise<void>;
  };
  buildEmbeddingRepairPlan: (input: {
    corpus: EmbeddingRepairCorpus;
    rows: RepairCandidateRow[];
    checkpoint?: {
      last_row_id: number | null;
      processed: number;
      repaired: number;
      skipped: number;
      failed: number;
    } | null;
    batchSize?: number;
    targetModel?: string;
  }) => {
    corpus: EmbeddingRepairCorpus;
    target_model: string;
    stale_supported: boolean;
    total_candidates: number;
    batch_size: number;
    resume_from: {
      last_row_id: number | null;
      processed: number;
      repaired: number;
      skipped: number;
      failed: number;
    } | null;
    batches: Array<{
      corpus: EmbeddingRepairCorpus;
      batch_index: number;
      batches_total: number;
      row_ids: number[];
      last_row_id: number;
      texts: string[];
    }>;
  };
  runEmbeddingRepair: (input: {
    corpus: EmbeddingRepairCorpus;
    resume?: boolean;
    dryRun?: boolean;
    batchSize?: number;
    logger?: {
      info?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
      debug?: (...args: unknown[]) => void;
    };
    store: {
      listRepairCandidates: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
      getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<{
        run_id: string;
        corpus: EmbeddingRepairCorpus;
        last_row_id: number | null;
        processed: number;
        repaired: number;
        skipped: number;
        failed: number;
        failure_summary: {
          by_class: Record<string, number>;
          last_failure_class: string | null;
          last_failure_message: string | null;
        };
      } | null>;
      saveRepairState: (state: {
        run_id: string;
        corpus: EmbeddingRepairCorpus;
        target_model: string;
        dry_run: boolean;
        resumed: boolean;
        batch_index: number | null;
        batches_total: number | null;
        last_row_id: number | null;
        processed: number;
        repaired: number;
        skipped: number;
        failed: number;
        failure_summary: {
          by_class: Record<string, number>;
          last_failure_class: string | null;
          last_failure_message: string | null;
        };
        updated_at?: string;
      }) => Promise<void>;
      writeRepairEmbeddingsBatch: (payload: {
        corpus: EmbeddingRepairCorpus;
        row_ids: number[];
        target_model: string;
        embeddings: Array<{ row_id: number; embedding: Float32Array }>;
      }) => Promise<void>;
    };
    embedRows: (rows: Array<{ id: number; text: string }>, attempt: number) => Promise<
      | {
          status: "ok";
          embeddings: Array<{ row_id: number; embedding: Float32Array }>;
          retry_count?: number;
        }
      | {
          status: "failed";
          failure_class: string;
          message: string;
          retryable: boolean;
        }
    >;
  }) => Promise<{
    success: boolean;
    status_code: string;
    corpus: EmbeddingRepairCorpus;
    target_model: string;
    resumed: boolean;
    dry_run: boolean;
    processed: number;
    repaired: number;
    skipped: number;
    failed: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    progress: Array<{
      corpus: EmbeddingRepairCorpus;
      batch_index: number;
      batches_total: number;
      last_row_id: number;
      processed: number;
      repaired: number;
      skipped: number;
      failed: number;
      failure_class: string | null;
      target_model: string;
      dry_run: boolean;
    }>;
    cursor: {
      corpus: EmbeddingRepairCorpus;
      last_row_id: number | null;
      batch_index: number | null;
      batches_total: number | null;
    };
  }>;
};

async function loadEmbeddingRepairModule(): Promise<EmbeddingRepairModule> {
  try {
    return await import("./embedding-repair.ts") as unknown as EmbeddingRepairModule;
  } catch (error) {
    throw new Error(
      "Missing S03 implementation: expected src/knowledge/embedding-repair.ts to export NON_WIKI_TARGET_EMBEDDING_MODEL, NON_WIKI_REPAIR_CORPORA, STALE_SUPPORTED_CORPORA, buildRepairEmbeddingText(), buildEmbeddingRepairPlan(), and runEmbeddingRepair() for the shared non-wiki repair contract.",
      { cause: error },
    );
  }
}

function makeRow(overrides: Partial<RepairCandidateRow> & Pick<RepairCandidateRow, "corpus">): RepairCandidateRow {
  return {
    id: overrides.id ?? 1,
    corpus: overrides.corpus,
    embedding_model: Object.prototype.hasOwnProperty.call(overrides, "embedding_model")
      ? overrides.embedding_model ?? null
      : "voyage-4",
    embedding: Object.prototype.hasOwnProperty.call(overrides, "embedding")
      ? overrides.embedding ?? null
      : new Float32Array([0.1, 0.2]),
    stale: overrides.stale ?? false,
    deleted: overrides.deleted ?? false,
    chunk_text: overrides.chunk_text,
    finding_text: overrides.finding_text,
    severity: overrides.severity,
    category: overrides.category,
    file_path: overrides.file_path,
    embedded_text: overrides.embedded_text,
    language: overrides.language,
    issue_number: overrides.issue_number,
    issue_title: overrides.issue_title,
    title: overrides.title,
    body: overrides.body,
    comment_body: overrides.comment_body,
  };
}

function makeEmbedding(seed: number): Float32Array {
  return new Float32Array([seed, seed + 0.01, seed + 0.02]);
}

describe("shared non-wiki repair contract for src/knowledge/embedding-repair.ts", () => {
  test("buildEmbeddingRepairPlan keeps all non-wiki corpora pinned to voyage-4 and preserves stale-support differences", async () => {
    const module = await loadEmbeddingRepairModule();

    expect(module.NON_WIKI_TARGET_EMBEDDING_MODEL).toBe("voyage-4");
    expect(module.NON_WIKI_REPAIR_CORPORA).toEqual([
      "review_comments",
      "learning_memories",
      "code_snippets",
      "issues",
      "issue_comments",
      "canonical_code",
    ]);
    expect(module.STALE_SUPPORTED_CORPORA).toEqual([
      "review_comments",
      "learning_memories",
      "code_snippets",
      "canonical_code",
    ]);

    const reviewPlan = module.buildEmbeddingRepairPlan({
      corpus: "review_comments",
      batchSize: 2,
      rows: [
        makeRow({ corpus: "review_comments", id: 11, chunk_text: "needs model repair", embedding_model: "voyage-context-3" }),
        makeRow({ corpus: "review_comments", id: 12, chunk_text: "needs stale repair", stale: true }),
        makeRow({ corpus: "review_comments", id: 13, chunk_text: "needs null repair", embedding: null, embedding_model: null }),
        makeRow({ corpus: "review_comments", id: 14, chunk_text: "healthy", embedding_model: "voyage-4", stale: false }),
      ],
    });

    expect(reviewPlan).toMatchObject({
      corpus: "review_comments",
      target_model: "voyage-4",
      stale_supported: true,
      total_candidates: 3,
      batch_size: 2,
      resume_from: null,
    });
    expect(reviewPlan.batches).toEqual([
      expect.objectContaining({ row_ids: [11, 12], last_row_id: 12 }),
      expect.objectContaining({ row_ids: [13], last_row_id: 13 }),
    ]);

    const issuePlan = module.buildEmbeddingRepairPlan({
      corpus: "issues",
      batchSize: 10,
      rows: [
        makeRow({ corpus: "issues", id: 21, title: "Model drift", body: "wrong model", embedding_model: "voyage-context-3" }),
        makeRow({ corpus: "issues", id: 22, title: "Missing embedding", body: null, embedding: null, embedding_model: null }),
        makeRow({ corpus: "issues", id: 23, title: "Healthy issue", body: "already correct", embedding_model: "voyage-4", stale: true }),
      ],
    });

    expect(issuePlan).toMatchObject({
      corpus: "issues",
      target_model: "voyage-4",
      stale_supported: false,
      total_candidates: 2,
    });
    expect(issuePlan.batches).toEqual([
      expect.objectContaining({ row_ids: [21, 22], last_row_id: 22 }),
    ]);
  });

  test("buildRepairEmbeddingText uses persisted row text only and matches each corpus-specific shaping contract", async () => {
    const module = await loadEmbeddingRepairModule();

    expect(module.buildRepairEmbeddingText("review_comments", makeRow({
      corpus: "review_comments",
      id: 31,
      chunk_text: "Persisted review chunk text",
    }))).toBe("Persisted review chunk text");

    expect(module.buildRepairEmbeddingText("learning_memories", makeRow({
      corpus: "learning_memories",
      id: 32,
      finding_text: "Potential null dereference when cache is empty",
      severity: "high",
      category: "correctness",
      file_path: "src/cache.ts",
    }))).toBe([
      "[high] [correctness]",
      "Potential null dereference when cache is empty",
      "File: src/cache.ts",
    ].join("\n"));

    const codeSnippetText = buildEmbeddingText({
      prTitle: "Fix cache invalidation race",
      hunk: {
        filePath: "src/cache.ts",
        startLine: 48,
        lineCount: 4,
        functionContext: "function refreshCache",
        addedLines: [
          "if (!entry) return;",
          "entry.version = nextVersion;",
        ],
        language: "ts",
      },
    });
    expect(module.buildRepairEmbeddingText("code_snippets", makeRow({
      corpus: "code_snippets",
      id: 33,
      embedded_text: codeSnippetText,
    }))).toBe(codeSnippetText);

    expect(module.buildRepairEmbeddingText("issues", makeRow({
      corpus: "issues",
      id: 34,
      title: "Cache corruption after restart",
      body: "Restoring snapshots can reuse stale keys.",
    }))).toBe(buildIssueEmbeddingText("Cache corruption after restart", "Restoring snapshots can reuse stale keys."));

    expect(module.buildRepairEmbeddingText("issue_comments", makeRow({
      corpus: "issue_comments",
      id: 35,
      issue_number: 9021,
      issue_title: "Cache corruption after restart",
      comment_body: "I reproduced this on two warm restarts.",
    }))).toBe(buildCommentEmbeddingText(9021, "Cache corruption after restart", "I reproduced this on two warm restarts."));
  });

  test("store adapters scope each repair store to the supported corpus and reject mismatches", async () => {
    const module = await loadEmbeddingRepairModule();

    const reviewStore = {
      listRepairCandidates: mock(async () => []),
      getRepairState: mock(async () => null),
      saveRepairState: mock(async () => undefined),
      writeRepairEmbeddingsBatch: mock(async () => undefined),
    };
    const issueStore = {
      listRepairCandidates: mock(async () => []),
      getRepairState: mock(async () => null),
      saveRepairState: mock(async () => undefined),
      writeRepairEmbeddingsBatch: mock(async () => undefined),
    };
    const memoryStore = {
      listRepairCandidates: mock(async () => []),
      getRepairState: mock(async () => null),
      saveRepairState: mock(async () => undefined),
      writeRepairEmbeddingsBatch: mock(async () => undefined),
    };
    const snippetStore = {
      listRepairCandidates: mock(async () => []),
      getRepairState: mock(async () => null),
      saveRepairState: mock(async () => undefined),
      writeRepairEmbeddingsBatch: mock(async () => undefined),
    };

    const scopedReview = module.createReviewCommentRepairStore(reviewStore);
    const scopedIssues = module.createIssueRepairStore(issueStore, "issues");
    const scopedIssueComments = module.createIssueRepairStore(issueStore, "issue_comments");
    const scopedMemories = module.createLearningMemoryRepairStore(memoryStore);
    const scopedSnippets = module.createCodeSnippetRepairStore(snippetStore);

    await scopedReview.listRepairCandidates("review_comments");
    await scopedIssues.listRepairCandidates("issues");
    await scopedIssueComments.listRepairCandidates("issue_comments");
    await scopedMemories.listRepairCandidates("learning_memories");
    await scopedSnippets.listRepairCandidates("code_snippets");

    expect(reviewStore.listRepairCandidates).toHaveBeenCalledWith("review_comments");
    expect(issueStore.listRepairCandidates).toHaveBeenCalledWith("issues");
    expect(issueStore.listRepairCandidates).toHaveBeenCalledWith("issue_comments");
    expect(memoryStore.listRepairCandidates).toHaveBeenCalledWith("learning_memories");
    expect(snippetStore.listRepairCandidates).toHaveBeenCalledWith("code_snippets");

    await expect(scopedIssues.listRepairCandidates("review_comments")).rejects.toThrow(
      "IssueStore repair store only supports issues, received review_comments",
    );
    await expect(scopedIssueComments.saveRepairState({ corpus: "issues" })).rejects.toThrow(
      "IssueStore repair state only supports issue_comments, received issues",
    );
    await expect(scopedMemories.writeRepairEmbeddingsBatch({ corpus: "issues" })).rejects.toThrow(
      "LearningMemoryStore repair writes only support learning_memories, received issues",
    );
    await expect(scopedSnippets.getRepairState("issues")).rejects.toThrow(
      "CodeSnippetStore repair state only supports code_snippets, received issues",
    );
  });

  test("runEmbeddingRepair advances bounded batches, persists durable cursor fields after each batch, and keeps dry-run read-only", async () => {
    const module = await loadEmbeddingRepairModule();

    const rows = [
      makeRow({ corpus: "review_comments", id: 41, chunk_text: "row 41", embedding: null, embedding_model: null }),
      makeRow({ corpus: "review_comments", id: 42, chunk_text: "row 42", stale: true }),
      makeRow({ corpus: "review_comments", id: 43, chunk_text: "row 43", embedding_model: "voyage-context-3" }),
      makeRow({ corpus: "review_comments", id: 44, chunk_text: "healthy row 44" }),
      makeRow({ corpus: "review_comments", id: 45, chunk_text: "row 45", embedding: null, embedding_model: null }),
    ];

    const savedStates: Array<Record<string, unknown>> = [];
    const writeBatches: Array<Record<string, unknown>> = [];
    const embedCalls: Array<{ ids: number[]; attempt: number }> = [];

    const store = {
      listRepairCandidates: mock(async () => rows),
      getRepairState: mock(async () => null),
      saveRepairState: mock(async (state) => {
        savedStates.push(state as Record<string, unknown>);
      }),
      writeRepairEmbeddingsBatch: mock(async (payload) => {
        writeBatches.push(payload as Record<string, unknown>);
      }),
    };

    const result = await module.runEmbeddingRepair({
      corpus: "review_comments",
      batchSize: 2,
      store,
      embedRows: async (batch, attempt) => {
        embedCalls.push({ ids: batch.map((row) => row.id), attempt });
        return {
          status: "ok",
          embeddings: batch.map((row) => ({ row_id: row.id, embedding: makeEmbedding(row.id) })),
          retry_count: attempt,
        };
      },
    });

    expect(embedCalls).toEqual([
      { ids: [41, 42], attempt: 0 },
      { ids: [43, 45], attempt: 0 },
    ]);
    expect(writeBatches).toEqual([
      expect.objectContaining({ corpus: "review_comments", row_ids: [41, 42], target_model: "voyage-4" }),
      expect.objectContaining({ corpus: "review_comments", row_ids: [43, 45], target_model: "voyage-4" }),
    ]);
    expect(savedStates).toEqual([
      expect.objectContaining({
        corpus: "review_comments",
        dry_run: false,
        resumed: false,
        batch_index: 0,
        batches_total: 2,
        last_row_id: 42,
        processed: 2,
        repaired: 2,
        failed: 0,
        failure_summary: {
          by_class: {},
          last_failure_class: null,
          last_failure_message: null,
        },
      }),
      expect.objectContaining({
        corpus: "review_comments",
        dry_run: false,
        resumed: false,
        batch_index: 1,
        batches_total: 2,
        last_row_id: 45,
        processed: 4,
        repaired: 4,
        failed: 0,
      }),
    ]);
    expect(result).toMatchObject({
      success: true,
      status_code: "repair_completed",
      corpus: "review_comments",
      target_model: "voyage-4",
      resumed: false,
      dry_run: false,
      processed: 4,
      repaired: 4,
      skipped: 0,
      failed: 0,
      cursor: {
        corpus: "review_comments",
        last_row_id: 45,
        batch_index: 1,
        batches_total: 2,
      },
    });

    savedStates.length = 0;
    writeBatches.length = 0;
    embedCalls.length = 0;

    const dryRun = await module.runEmbeddingRepair({
      corpus: "issues",
      dryRun: true,
      batchSize: 1,
      store: {
        listRepairCandidates: mock(async () => [
          makeRow({ corpus: "issues", id: 51, title: "Wrong model", body: "persisted issue", embedding_model: "voyage-context-3" }),
        ]),
        getRepairState: mock(async () => null),
        saveRepairState: mock(async (state) => {
          savedStates.push(state as Record<string, unknown>);
        }),
        writeRepairEmbeddingsBatch: mock(async (payload) => {
          writeBatches.push(payload as Record<string, unknown>);
        }),
      },
      embedRows: async (batch, attempt) => {
        embedCalls.push({ ids: batch.map((row) => row.id), attempt });
        return {
          status: "ok",
          embeddings: batch.map((row) => ({ row_id: row.id, embedding: makeEmbedding(row.id) })),
        };
      },
    });

    expect(embedCalls).toEqual([{ ids: [51], attempt: 0 }]);
    expect(writeBatches).toEqual([]);
    expect(savedStates).toEqual([
      expect.objectContaining({
        corpus: "issues",
        dry_run: true,
        last_row_id: 51,
        processed: 1,
        repaired: 0,
        skipped: 1,
        failed: 0,
      }),
    ]);
    expect(dryRun).toMatchObject({
      success: true,
      status_code: "repair_completed",
      corpus: "issues",
      dry_run: true,
      processed: 1,
      repaired: 0,
      skipped: 1,
      failed: 0,
      cursor: {
        corpus: "issues",
        last_row_id: 51,
        batch_index: 0,
        batches_total: 1,
      },
    });
  });

  test("runEmbeddingRepair exposes a truthful no-op result for empty or already-healthy corpora", async () => {
    const module = await loadEmbeddingRepairModule();

    const saveRepairState = mock(async () => undefined);
    const writeRepairEmbeddingsBatch = mock(async () => undefined);

    const result = await module.runEmbeddingRepair({
      corpus: "learning_memories",
      batchSize: 5,
      store: {
        listRepairCandidates: mock(async () => []),
        getRepairState: mock(async () => null),
        saveRepairState,
        writeRepairEmbeddingsBatch,
      },
      embedRows: async () => ({
        status: "ok",
        embeddings: [],
      }),
    });

    expect(saveRepairState).toHaveBeenCalledTimes(1);
    expect(writeRepairEmbeddingsBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      status_code: "repair_not_needed",
      corpus: "learning_memories",
      target_model: "voyage-4",
      processed: 0,
      repaired: 0,
      skipped: 0,
      failed: 0,
      failure_summary: {
        by_class: {},
        last_failure_class: null,
        last_failure_message: null,
      },
      progress: [],
      cursor: {
        corpus: "learning_memories",
        last_row_id: null,
        batch_index: null,
        batches_total: null,
      },
    });
  });

  test("runEmbeddingRepair leaves the persisted checkpoint untouched on healthy reruns so status still exposes the last bounded repair evidence", async () => {
    const module = await loadEmbeddingRepairModule();

    const saveRepairState = mock(async () => undefined);
    const writeRepairEmbeddingsBatch = mock(async () => undefined);

    const result = await module.runEmbeddingRepair({
      corpus: "review_comments",
      batchSize: 100,
      store: {
        listRepairCandidates: mock(async () => []),
        getRepairState: mock(async () => ({
          run_id: "embedding-repair-review_comments-2026-03-12T08:30:00.000Z",
          corpus: "review_comments" as const,
          last_row_id: 3033,
          processed: 1833,
          repaired: 1833,
          skipped: 0,
          failed: 0,
          failure_summary: {
            by_class: {},
            last_failure_class: null,
            last_failure_message: null,
          },
        })),
        saveRepairState,
        writeRepairEmbeddingsBatch,
      },
      embedRows: async () => ({
        status: "ok",
        embeddings: [],
      }),
    });

    expect(saveRepairState).not.toHaveBeenCalled();
    expect(writeRepairEmbeddingsBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      status_code: "repair_not_needed",
      corpus: "review_comments",
      processed: 0,
      repaired: 0,
      skipped: 0,
      failed: 0,
      progress: [],
      cursor: {
        corpus: "review_comments",
        last_row_id: null,
        batch_index: null,
        batches_total: null,
      },
    });
  });
});
