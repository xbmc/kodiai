import type { EmbeddingProvider, LearningMemoryStore } from "./types.ts";
import type { ReviewCommentStore } from "./review-comment-types.ts";
import type { CodeSnippetStore } from "./code-snippet-types.ts";
import type { IssueStore } from "./issue-types.ts";
import { buildEmbeddingText } from "./code-snippet-chunker.ts";
import { buildCommentEmbeddingText, buildIssueEmbeddingText } from "./issue-comment-chunker.ts";

export type EmbeddingRepairCorpus = "review_comments" | "learning_memories" | "code_snippets" | "issues" | "issue_comments";

export type RepairCandidateRow = {
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

export type EmbeddingRepairFailureSummary = {
  by_class: Record<string, number>;
  last_failure_class: string | null;
  last_failure_message: string | null;
};

export type EmbeddingRepairCheckpoint = {
  run_id: string;
  corpus: EmbeddingRepairCorpus;
  repair_key?: string;
  target_model?: string;
  dry_run?: boolean;
  resumed?: boolean;
  status?: "running" | "completed" | "failed" | "resume_required" | "not_needed";
  resume_ready?: boolean;
  batch_index: number | null;
  batches_total: number | null;
  last_row_id: number | null;
  processed: number;
  repaired: number;
  skipped: number;
  failed: number;
  failure_summary: EmbeddingRepairFailureSummary;
  updated_at?: string;
};

export type RepairPlanBatch = {
  corpus: EmbeddingRepairCorpus;
  batch_index: number;
  batches_total: number;
  row_ids: number[];
  last_row_id: number;
  texts: string[];
};

export type EmbeddingRepairPlan = {
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
  batches: RepairPlanBatch[];
};

export type EmbeddingRepairProgress = {
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
};

export type EmbeddingRepairRun = {
  run_id: string;
  status: "running" | "completed" | "failed" | "resume_required" | "not_needed";
  corpus: EmbeddingRepairCorpus;
  batch_index: number | null;
  batches_total: number | null;
  last_row_id: number | null;
  processed: number;
  repaired: number;
  skipped: number;
  failed: number;
  failure_summary: EmbeddingRepairFailureSummary;
  updated_at: string;
};

export type EmbeddingRepairReport = {
  success: boolean;
  status_code: "repair_completed" | "repair_not_needed" | "repair_failed";
  corpus: EmbeddingRepairCorpus;
  target_model: string;
  resumed: boolean;
  dry_run: boolean;
  processed: number;
  repaired: number;
  skipped: number;
  failed: number;
  failure_summary: EmbeddingRepairFailureSummary;
  progress: EmbeddingRepairProgress[];
  cursor: {
    corpus: EmbeddingRepairCorpus;
    last_row_id: number | null;
    batch_index: number | null;
    batches_total: number | null;
  };
  run: EmbeddingRepairRun;
};

export type EmbeddingRepairStore = {
  listRepairCandidates: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
  getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<EmbeddingRepairCheckpoint | null>;
  saveRepairState: (state: EmbeddingRepairCheckpoint) => Promise<void>;
  writeRepairEmbeddingsBatch: (payload: {
    corpus: EmbeddingRepairCorpus;
    row_ids: number[];
    target_model: string;
    embeddings: Array<{ row_id: number; embedding: Float32Array }>;
  }) => Promise<void>;
};

export const NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-4";
export const NON_WIKI_REPAIR_CORPORA = [
  "review_comments",
  "learning_memories",
  "code_snippets",
  "issues",
  "issue_comments",
] as const satisfies readonly EmbeddingRepairCorpus[];
export const STALE_SUPPORTED_CORPORA = [
  "review_comments",
  "learning_memories",
  "code_snippets",
] as const satisfies readonly EmbeddingRepairCorpus[];

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_REPAIR_KEY = "default";

function supportsStale(corpus: EmbeddingRepairCorpus): boolean {
  return (STALE_SUPPORTED_CORPORA as readonly string[]).includes(corpus);
}

function normalizeFailureSummary(summary?: Partial<EmbeddingRepairFailureSummary> | null): EmbeddingRepairFailureSummary {
  return {
    by_class: { ...(summary?.by_class ?? {}) },
    last_failure_class: summary?.last_failure_class ?? null,
    last_failure_message: summary?.last_failure_message ?? null,
  };
}

function normalizeCheckpoint(checkpoint: EmbeddingRepairCheckpoint | null | undefined): EmbeddingRepairCheckpoint | null {
  if (!checkpoint) return null;
  return {
    run_id: checkpoint.run_id,
    corpus: checkpoint.corpus,
    repair_key: checkpoint.repair_key ?? DEFAULT_REPAIR_KEY,
    target_model: checkpoint.target_model ?? NON_WIKI_TARGET_EMBEDDING_MODEL,
    dry_run: checkpoint.dry_run ?? false,
    resumed: checkpoint.resumed ?? false,
    status: checkpoint.status ?? "resume_required",
    resume_ready: checkpoint.resume_ready ?? (checkpoint.failed > 0),
    batch_index: checkpoint.batch_index ?? null,
    batches_total: checkpoint.batches_total ?? null,
    last_row_id: checkpoint.last_row_id ?? null,
    processed: checkpoint.processed ?? 0,
    repaired: checkpoint.repaired ?? 0,
    skipped: checkpoint.skipped ?? 0,
    failed: checkpoint.failed ?? 0,
    failure_summary: normalizeFailureSummary(checkpoint.failure_summary),
    updated_at: checkpoint.updated_at,
  };
}

function assertString(value: string | undefined | null, message: string): string {
  if (value == null || value === "") {
    throw new Error(message);
  }
  return value;
}

export function buildRepairEmbeddingText(corpus: EmbeddingRepairCorpus, row: RepairCandidateRow): string {
  switch (corpus) {
    case "review_comments":
      return assertString(row.chunk_text, "review_comments repair requires persisted chunk_text");
    case "learning_memories": {
      const severity = assertString(row.severity, "learning_memories repair requires severity");
      const category = assertString(row.category, "learning_memories repair requires category");
      const findingText = assertString(row.finding_text, "learning_memories repair requires finding_text");
      const filePath = assertString(row.file_path, "learning_memories repair requires file_path");
      return [`[${severity}] [${category}]`, findingText, `File: ${filePath}`].join("\n");
    }
    case "code_snippets":
      return assertString(row.embedded_text, "code_snippets repair requires embedded_text");
    case "issues":
      return buildIssueEmbeddingText(
        assertString(row.title, "issues repair requires title"),
        row.body ?? null,
      );
    case "issue_comments":
      return buildCommentEmbeddingText(
        row.issue_number ?? 0,
        assertString(row.issue_title, "issue_comments repair requires issue_title"),
        assertString(row.comment_body, "issue_comments repair requires comment_body"),
      );
    default: {
      const exhaustiveCheck: never = corpus;
      throw new Error(`Unsupported repair corpus: ${String(exhaustiveCheck)}`);
    }
  }
}

function isRepairCandidate(corpus: EmbeddingRepairCorpus, row: RepairCandidateRow, targetModel: string): boolean {
  if (row.deleted) return false;
  if (row.embedding == null || row.embedding_model == null) return true;
  if (supportsStale(corpus) && row.stale) return true;
  return row.embedding_model !== targetModel;
}

function sortRepairRows(rows: RepairCandidateRow[]): RepairCandidateRow[] {
  return [...rows].sort((a, b) => a.id - b.id);
}

export function buildEmbeddingRepairPlan(input: {
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
}): EmbeddingRepairPlan {
  const targetModel = input.targetModel ?? NON_WIKI_TARGET_EMBEDDING_MODEL;
  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_BATCH_SIZE);
  const filteredRows = sortRepairRows(
    input.rows.filter((row) => isRepairCandidate(input.corpus, row, targetModel)),
  ).filter((row) => {
    if (input.checkpoint?.last_row_id == null) return true;
    return row.id > input.checkpoint.last_row_id;
  });

  const batches: RepairPlanBatch[] = [];
  const batchesTotal = Math.ceil(filteredRows.length / batchSize);
  for (let offset = 0; offset < filteredRows.length; offset += batchSize) {
    const batchRows = filteredRows.slice(offset, offset + batchSize);
    batches.push({
      corpus: input.corpus,
      batch_index: batches.length,
      batches_total: batchesTotal,
      row_ids: batchRows.map((row) => row.id),
      last_row_id: batchRows[batchRows.length - 1]!.id,
      texts: batchRows.map((row) => buildRepairEmbeddingText(input.corpus, row)),
    });
  }

  return {
    corpus: input.corpus,
    target_model: targetModel,
    stale_supported: supportsStale(input.corpus),
    total_candidates: filteredRows.length,
    batch_size: batchSize,
    resume_from: input.checkpoint ?? null,
    batches,
  };
}

function nextFailureSummary(
  previous: EmbeddingRepairFailureSummary,
  failureClass: string,
  failureMessage: string,
  increment: number,
): EmbeddingRepairFailureSummary {
  return {
    by_class: {
      ...previous.by_class,
      [failureClass]: (previous.by_class[failureClass] ?? 0) + increment,
    },
    last_failure_class: failureClass,
    last_failure_message: failureMessage,
  };
}

function buildRun(report: {
  run_id: string;
  status: EmbeddingRepairRun["status"];
  corpus: EmbeddingRepairCorpus;
  batch_index: number | null;
  batches_total: number | null;
  last_row_id: number | null;
  processed: number;
  repaired: number;
  skipped: number;
  failed: number;
  failure_summary: EmbeddingRepairFailureSummary;
  updated_at: string;
}): EmbeddingRepairRun {
  return {
    run_id: report.run_id,
    status: report.status,
    corpus: report.corpus,
    batch_index: report.batch_index,
    batches_total: report.batches_total,
    last_row_id: report.last_row_id,
    processed: report.processed,
    repaired: report.repaired,
    skipped: report.skipped,
    failed: report.failed,
    failure_summary: normalizeFailureSummary(report.failure_summary),
    updated_at: report.updated_at,
  };
}

function buildState(params: {
  run_id: string;
  corpus: EmbeddingRepairCorpus;
  target_model: string;
  dry_run: boolean;
  resumed: boolean;
  status: EmbeddingRepairRun["status"];
  resume_ready: boolean;
  batch_index: number | null;
  batches_total: number | null;
  last_row_id: number | null;
  processed: number;
  repaired: number;
  skipped: number;
  failed: number;
  failure_summary: EmbeddingRepairFailureSummary;
  updated_at: string;
}): EmbeddingRepairCheckpoint {
  return {
    run_id: params.run_id,
    corpus: params.corpus,
    repair_key: DEFAULT_REPAIR_KEY,
    target_model: params.target_model,
    dry_run: params.dry_run,
    resumed: params.resumed,
    status: params.status,
    resume_ready: params.resume_ready,
    batch_index: params.batch_index,
    batches_total: params.batches_total,
    last_row_id: params.last_row_id,
    processed: params.processed,
    repaired: params.repaired,
    skipped: params.skipped,
    failed: params.failed,
    failure_summary: normalizeFailureSummary(params.failure_summary),
    updated_at: params.updated_at,
  };
}

export async function runEmbeddingRepair(input: {
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
  store: EmbeddingRepairStore;
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
}): Promise<EmbeddingRepairReport> {
  const logger = input.logger ?? {};
  const existingCheckpoint = normalizeCheckpoint(await input.store.getRepairState(input.corpus));
  const checkpoint = input.resume ? existingCheckpoint : null;
  const rows = await input.store.listRepairCandidates(input.corpus);
  const plan = buildEmbeddingRepairPlan({
    corpus: input.corpus,
    rows,
    checkpoint: checkpoint
      ? {
          last_row_id: checkpoint.last_row_id,
          processed: checkpoint.processed,
          repaired: checkpoint.repaired,
          skipped: checkpoint.skipped,
          failed: checkpoint.failed,
        }
      : null,
    batchSize: input.batchSize,
    targetModel: NON_WIKI_TARGET_EMBEDDING_MODEL,
  });

  const runId = checkpoint?.run_id ?? `embedding-repair-${input.corpus}-${new Date().toISOString()}`;
  const resumed = Boolean(input.resume && checkpoint);
  const dryRun = Boolean(input.dryRun);
  let processed = checkpoint?.processed ?? 0;
  let repaired = checkpoint?.repaired ?? 0;
  let skipped = checkpoint?.skipped ?? 0;
  let failed = checkpoint?.failed ?? 0;
  let failureSummary = normalizeFailureSummary(checkpoint?.failure_summary);
  const progress: EmbeddingRepairProgress[] = [];
  let cursor = {
    corpus: input.corpus,
    last_row_id: checkpoint?.last_row_id ?? null,
    batch_index: checkpoint?.batch_index ?? null,
    batches_total: checkpoint?.batches_total ?? null,
  };

  if (plan.batches.length === 0) {
    const updatedAt = new Date().toISOString();
    if (!existingCheckpoint) {
      const state = buildState({
        run_id: runId,
        corpus: input.corpus,
        target_model: plan.target_model,
        dry_run: dryRun,
        resumed,
        status: "not_needed",
        resume_ready: false,
        batch_index: null,
        batches_total: null,
        last_row_id: cursor.last_row_id,
        processed,
        repaired,
        skipped,
        failed,
        failure_summary: failureSummary,
        updated_at: updatedAt,
      });
      await input.store.saveRepairState(state);
    }
    return {
      success: true,
      status_code: "repair_not_needed",
      corpus: input.corpus,
      target_model: plan.target_model,
      resumed,
      dry_run: dryRun,
      processed,
      repaired,
      skipped,
      failed,
      failure_summary: failureSummary,
      progress,
      cursor: {
        corpus: input.corpus,
        last_row_id: null,
        batch_index: null,
        batches_total: null,
      },
      run: buildRun({
        run_id: runId,
        status: "not_needed",
        corpus: input.corpus,
        batch_index: null,
        batches_total: null,
        last_row_id: null,
        processed,
        repaired,
        skipped,
        failed,
        failure_summary: failureSummary,
        updated_at: updatedAt,
      }),
    };
  }

  const rowMap = new Map(sortRepairRows(rows).map((row) => [row.id, row]));

  for (const batch of plan.batches) {
    const batchRows = batch.row_ids.map((rowId, index) => ({
      id: rowId,
      text: batch.texts[index] ?? buildRepairEmbeddingText(input.corpus, rowMap.get(rowId)!),
    }));

    const outcome = await input.embedRows(batchRows, 0);
    cursor = {
      corpus: input.corpus,
      last_row_id: batch.last_row_id,
      batch_index: batch.batch_index,
      batches_total: batch.batches_total,
    };

    if (outcome.status === "failed") {
      processed += batch.row_ids.length;
      failed += batch.row_ids.length;
      failureSummary = nextFailureSummary(failureSummary, outcome.failure_class, outcome.message, batch.row_ids.length);
      const updatedAt = new Date().toISOString();
      const state = buildState({
        run_id: runId,
        corpus: input.corpus,
        target_model: plan.target_model,
        dry_run: dryRun,
        resumed,
        status: "failed",
        resume_ready: true,
        batch_index: batch.batch_index,
        batches_total: batch.batches_total,
        last_row_id: batch.last_row_id,
        processed,
        repaired,
        skipped,
        failed,
        failure_summary: failureSummary,
        updated_at: updatedAt,
      });
      await input.store.saveRepairState(state);
      progress.push({
        corpus: input.corpus,
        batch_index: batch.batch_index,
        batches_total: batch.batches_total,
        last_row_id: batch.last_row_id,
        processed,
        repaired,
        skipped,
        failed,
        failure_class: outcome.failure_class,
        target_model: plan.target_model,
        dry_run: dryRun,
      });
      logger.error?.({ corpus: input.corpus, batch_index: batch.batch_index, failure_class: outcome.failure_class }, "Embedding repair batch failed");
      return {
        success: false,
        status_code: "repair_failed",
        corpus: input.corpus,
        target_model: plan.target_model,
        resumed,
        dry_run: dryRun,
        processed,
        repaired,
        skipped,
        failed,
        failure_summary: failureSummary,
        progress,
        cursor,
        run: buildRun({
          run_id: runId,
          status: "failed",
          corpus: input.corpus,
          batch_index: batch.batch_index,
          batches_total: batch.batches_total,
          last_row_id: batch.last_row_id,
          processed,
          repaired,
          skipped,
          failed,
          failure_summary: failureSummary,
          updated_at: updatedAt,
        }),
      };
    }

    if (!dryRun) {
      await input.store.writeRepairEmbeddingsBatch({
        corpus: input.corpus,
        row_ids: batch.row_ids,
        target_model: plan.target_model,
        embeddings: outcome.embeddings,
      });
    }

    processed += batch.row_ids.length;
    if (dryRun) {
      skipped += batch.row_ids.length;
    } else {
      repaired += batch.row_ids.length;
    }

    const isLastBatch = batch.batch_index === plan.batches.length - 1;
    const updatedAt = new Date().toISOString();
    const status: EmbeddingRepairRun["status"] = isLastBatch ? "completed" : "running";
    const state = buildState({
      run_id: runId,
      corpus: input.corpus,
      target_model: plan.target_model,
      dry_run: dryRun,
      resumed,
      status,
      resume_ready: false,
      batch_index: batch.batch_index,
      batches_total: batch.batches_total,
      last_row_id: batch.last_row_id,
      processed,
      repaired,
      skipped,
      failed,
      failure_summary: failureSummary,
      updated_at: updatedAt,
    });
    await input.store.saveRepairState(state);
    progress.push({
      corpus: input.corpus,
      batch_index: batch.batch_index,
      batches_total: batch.batches_total,
      last_row_id: batch.last_row_id,
      processed,
      repaired,
      skipped,
      failed,
      failure_class: null,
      target_model: plan.target_model,
      dry_run: dryRun,
    });
  }

  const finalUpdatedAt = new Date().toISOString();
  return {
    success: true,
    status_code: "repair_completed",
    corpus: input.corpus,
    target_model: plan.target_model,
    resumed,
    dry_run: dryRun,
    processed,
    repaired,
    skipped,
    failed,
    failure_summary: failureSummary,
    progress,
    cursor,
    run: buildRun({
      run_id: runId,
      status: dryRun && repaired === 0 ? "not_needed" : "completed",
      corpus: input.corpus,
      batch_index: cursor.batch_index,
      batches_total: cursor.batches_total,
      last_row_id: cursor.last_row_id,
      processed,
      repaired,
      skipped,
      failed,
      failure_summary: failureSummary,
      updated_at: finalUpdatedAt,
    }),
  };
}

function createScopedRepairStore(params: {
  storeName: string;
  corpus: EmbeddingRepairCorpus;
  store: {
    listRepairCandidates?: (corpus: EmbeddingRepairCorpus) => Promise<RepairCandidateRow[]>;
    getRepairState?: (corpus: EmbeddingRepairCorpus) => Promise<EmbeddingRepairCheckpoint | null>;
    saveRepairState?: (state: EmbeddingRepairCheckpoint) => Promise<void>;
    writeRepairEmbeddingsBatch?: (payload: {
      corpus: EmbeddingRepairCorpus;
      row_ids: number[];
      target_model: string;
      embeddings: Array<{ row_id: number; embedding: Float32Array }>;
    }) => Promise<void>;
  };
}): EmbeddingRepairStore {
  const { storeName, corpus, store } = params;
  if (!store.listRepairCandidates || !store.getRepairState || !store.saveRepairState || !store.writeRepairEmbeddingsBatch) {
    throw new Error(`${storeName} is missing repair helpers required for ${corpus} embedding repair`);
  }

  const { listRepairCandidates, getRepairState, saveRepairState, writeRepairEmbeddingsBatch } = store as Required<typeof store>;

  return {
    listRepairCandidates: async (requestedCorpus) => {
      if (requestedCorpus !== corpus) {
        throw new Error(`${storeName} repair store only supports ${corpus}, received ${requestedCorpus}`);
      }
      return await listRepairCandidates(requestedCorpus);
    },
    getRepairState: async (requestedCorpus) => {
      if (requestedCorpus !== corpus) {
        throw new Error(`${storeName} repair state only supports ${corpus}, received ${requestedCorpus}`);
      }
      return await getRepairState(requestedCorpus);
    },
    saveRepairState: async (state) => {
      if (state.corpus !== corpus) {
        throw new Error(`${storeName} repair state only supports ${corpus}, received ${state.corpus}`);
      }
      await saveRepairState(state);
    },
    writeRepairEmbeddingsBatch: async (payload) => {
      if (payload.corpus !== corpus) {
        throw new Error(`${storeName} repair writes only support ${corpus}, received ${payload.corpus}`);
      }
      await writeRepairEmbeddingsBatch(payload);
    },
  };
}

async function embedPersistedRepairRows(params: {
  rows: Array<{ id: number; text: string }>;
  embeddingProvider: EmbeddingProvider;
  missingMessage: string;
}): Promise<
  | {
      status: "ok";
      embeddings: Array<{ row_id: number; embedding: Float32Array }>;
    }
  | {
      status: "failed";
      failure_class: string;
      message: string;
      retryable: boolean;
    }
> {
  const embeddings: Array<{ row_id: number; embedding: Float32Array }> = [];
  for (const row of params.rows) {
    const result = await params.embeddingProvider.generate(row.text, "document");
    if (result == null) {
      return {
        status: "failed",
        failure_class: "embedding_unavailable",
        message: params.missingMessage,
        retryable: false,
      };
    }
    embeddings.push({ row_id: row.id, embedding: result.embedding });
  }

  return {
    status: "ok",
    embeddings,
  };
}

export function createReviewCommentRepairStore(store: ReviewCommentStore): EmbeddingRepairStore {
  return createScopedRepairStore({
    storeName: "ReviewCommentStore",
    corpus: "review_comments",
    store,
  });
}

export function createIssueRepairStore(store: IssueStore, corpus: "issues" | "issue_comments"): EmbeddingRepairStore {
  return createScopedRepairStore({
    storeName: "IssueStore",
    corpus,
    store,
  });
}

export function createLearningMemoryRepairStore(store: LearningMemoryStore): EmbeddingRepairStore {
  return createScopedRepairStore({
    storeName: "LearningMemoryStore",
    corpus: "learning_memories",
    store,
  });
}

export function createCodeSnippetRepairStore(store: CodeSnippetStore): EmbeddingRepairStore {
  return createScopedRepairStore({
    storeName: "CodeSnippetStore",
    corpus: "code_snippets",
    store,
  });
}

export async function runReviewCommentEmbeddingRepair(input: {
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}): Promise<EmbeddingRepairReport> {
  const repairStore = createReviewCommentRepairStore(input.store);
  return await runEmbeddingRepair({
    corpus: "review_comments",
    resume: input.resume,
    dryRun: input.dryRun,
    batchSize: input.batchSize,
    logger: input.logger,
    store: repairStore,
    embedRows: async (rows) => await embedPersistedRepairRows({
      rows,
      embeddingProvider: input.embeddingProvider,
      missingMessage: "Embedding provider returned null for persisted review comment text",
    }),
  });
}

export async function runIssueEmbeddingRepair(input: {
  corpus: "issues" | "issue_comments";
  store: IssueStore;
  embeddingProvider: EmbeddingProvider;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}): Promise<EmbeddingRepairReport> {
  const repairStore = createIssueRepairStore(input.store, input.corpus);
  return await runEmbeddingRepair({
    corpus: input.corpus,
    resume: input.resume,
    dryRun: input.dryRun,
    batchSize: input.batchSize,
    logger: input.logger,
    store: repairStore,
    embedRows: async (rows) => await embedPersistedRepairRows({
      rows,
      embeddingProvider: input.embeddingProvider,
      missingMessage: `Embedding provider returned null for persisted ${input.corpus} text`,
    }),
  });
}

export async function runLearningMemoryEmbeddingRepair(input: {
  store: LearningMemoryStore;
  embeddingProvider: EmbeddingProvider;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}): Promise<EmbeddingRepairReport> {
  const repairStore = createLearningMemoryRepairStore(input.store);
  return await runEmbeddingRepair({
    corpus: "learning_memories",
    resume: input.resume,
    dryRun: input.dryRun,
    batchSize: input.batchSize,
    logger: input.logger,
    store: repairStore,
    embedRows: async (rows) => await embedPersistedRepairRows({
      rows,
      embeddingProvider: input.embeddingProvider,
      missingMessage: "Embedding provider returned null for persisted learning memory text",
    }),
  });
}

export async function runCodeSnippetEmbeddingRepair(input: {
  store: CodeSnippetStore;
  embeddingProvider: EmbeddingProvider;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}): Promise<EmbeddingRepairReport> {
  const repairStore = createCodeSnippetRepairStore(input.store);
  return await runEmbeddingRepair({
    corpus: "code_snippets",
    resume: input.resume,
    dryRun: input.dryRun,
    batchSize: input.batchSize,
    logger: input.logger,
    store: repairStore,
    embedRows: async (rows) => await embedPersistedRepairRows({
      rows,
      embeddingProvider: input.embeddingProvider,
      missingMessage: "Embedding provider returned null for persisted code snippet text",
    }),
  });
}

export function buildCodeSnippetRepairTextFromParts(params: {
  prTitle: string;
  filePath: string;
  startLine: number;
  lineCount: number;
  functionContext?: string;
  addedLines: string[];
  language?: string | null;
}): string {
  return buildEmbeddingText({
    prTitle: params.prTitle,
    hunk: {
      filePath: params.filePath,
      startLine: params.startLine,
      lineCount: params.lineCount,
      functionContext: params.functionContext ?? "",
      addedLines: params.addedLines,
      language: params.language ?? "unknown",
    },
  });
}
