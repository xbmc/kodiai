import type { EmbeddingProvider, LearningMemoryStore } from "./types.ts";
import type { ReviewCommentStore } from "./review-comment-types.ts";
import type { CodeSnippetStore } from "./code-snippet-types.ts";
import type { IssueStore } from "./issue-types.ts";
import type { CanonicalCodeStore } from "./canonical-code-types.ts";
import { buildCommentEmbeddingText, buildIssueEmbeddingText } from "./issue-comment-chunker.ts";
import { generateDocumentEmbeddingResultsBatch } from "./embedding-batch.ts";
import {
  CANONICAL_CODE_TARGET_EMBEDDING_MODEL,
  NON_WIKI_TARGET_EMBEDDING_MODEL,
  STALE_SUPPORTED_CORPORA,
  type EmbeddingRepairCheckpoint,
  type EmbeddingRepairCorpus,
  type EmbeddingRepairFailureSummary,
  type EmbeddingRepairLogger,
  type EmbeddingRepairPlan,
  type EmbeddingRepairProgress,
  type EmbeddingRepairReport,
  type EmbeddingRepairRun,
  type EmbeddingRepairRunnerInput,
  type EmbeddingRepairStore,
  type RepairCandidateRow,
  type RepairPlanBatch,
} from "./embedding-repair-types.ts";

export {
  CANONICAL_CODE_TARGET_EMBEDDING_MODEL,
  NON_WIKI_REPAIR_CORPORA,
  NON_WIKI_TARGET_EMBEDDING_MODEL,
  STALE_SUPPORTED_CORPORA,
} from "./embedding-repair-types.ts";
export type {
  EmbeddingRepairCheckpoint,
  EmbeddingRepairCorpus,
  EmbeddingRepairFailureSummary,
  EmbeddingRepairLogger,
  EmbeddingRepairPlan,
  EmbeddingRepairProgress,
  EmbeddingRepairReport,
  EmbeddingRepairRun,
  EmbeddingRepairRunnerInput,
  EmbeddingRepairStore,
  RepairCandidateRow,
  RepairPlanBatch,
} from "./embedding-repair-types.ts";

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
    case "canonical_code":
      return assertString(row.chunk_text, "canonical_code repair requires persisted chunk_text");
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

type RuntimeRepairBatch = {
  batch: RepairPlanBatch;
  rowById: Map<number, RepairCandidateRow>;
};

async function* iterateRepairBatches(input: {
  corpus: EmbeddingRepairCorpus;
  store: EmbeddingRepairStore;
  checkpoint: EmbeddingRepairCheckpoint | null;
  batchSize: number;
  targetModel: string;
}): AsyncGenerator<RuntimeRepairBatch> {
  const afterCheckpointId = input.checkpoint?.last_row_id ?? null;
  if (input.store.countRepairCandidates && input.store.listRepairCandidateBatch) {
    const totalCandidates = await input.store.countRepairCandidates({
      corpus: input.corpus,
      afterId: afterCheckpointId,
      targetModel: input.targetModel,
    });
    const batchesTotal = Math.ceil(totalCandidates / input.batchSize);
    let afterId = afterCheckpointId;

    for (let batchIndex = 0; batchIndex < batchesTotal; batchIndex++) {
      const batchRows = sortRepairRows(
        await input.store.listRepairCandidateBatch({
          corpus: input.corpus,
          afterId,
          limit: input.batchSize,
          targetModel: input.targetModel,
        }),
      ).filter((row) => {
        if (!isRepairCandidate(input.corpus, row, input.targetModel)) return false;
        return afterId == null || row.id > afterId;
      });
      if (batchRows.length === 0) return;
      afterId = batchRows[batchRows.length - 1]!.id;
      yield {
        batch: {
          corpus: input.corpus,
          batch_index: batchIndex,
          batches_total: batchesTotal,
          row_ids: batchRows.map((row) => row.id),
          last_row_id: afterId,
        },
        rowById: new Map(batchRows.map((row) => [row.id, row])),
      };
    }
    return;
  }

  const rows = await input.store.listRepairCandidates(input.corpus);
  const plan = buildEmbeddingRepairPlan({
    corpus: input.corpus,
    rows,
    checkpoint: input.checkpoint
      ? {
          last_row_id: input.checkpoint.last_row_id,
          processed: input.checkpoint.processed,
          repaired: input.checkpoint.repaired,
          skipped: input.checkpoint.skipped,
          failed: input.checkpoint.failed,
        }
      : null,
    batchSize: input.batchSize,
    targetModel: input.targetModel,
  });
  const rowById = new Map(sortRepairRows(rows).map((row) => [row.id, row]));
  for (const batch of plan.batches) {
    yield { batch, rowById };
  }
}

export async function runEmbeddingRepair(input: {
  corpus: EmbeddingRepairCorpus;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  logger?: EmbeddingRepairLogger;
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
  const targetModel = NON_WIKI_TARGET_EMBEDDING_MODEL;
  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_BATCH_SIZE);
  const batchIterator = iterateRepairBatches({
    corpus: input.corpus,
    store: input.store,
    checkpoint,
    batchSize,
    targetModel,
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

  let nextBatch = await batchIterator.next();
  if (nextBatch.done) {
    const updatedAt = new Date().toISOString();
    if (!existingCheckpoint) {
      const state = buildState({
        run_id: runId,
        corpus: input.corpus,
        target_model: targetModel,
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
      target_model: targetModel,
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

  while (!nextBatch.done) {
    const { batch, rowById } = nextBatch.value;
    const batchRows = batch.row_ids.map((rowId) => ({
      id: rowId,
      text: buildRepairEmbeddingText(input.corpus, rowById.get(rowId)!),
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
        target_model: targetModel,
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
        target_model: targetModel,
        dry_run: dryRun,
      });
      logger.error?.({ corpus: input.corpus, batch_index: batch.batch_index, failure_class: outcome.failure_class }, "Embedding repair batch failed");
      return {
        success: false,
        status_code: "repair_failed",
        corpus: input.corpus,
        target_model: targetModel,
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
        target_model: targetModel,
        embeddings: outcome.embeddings,
      });
    }

    processed += batch.row_ids.length;
    if (dryRun) {
      skipped += batch.row_ids.length;
    } else {
      repaired += batch.row_ids.length;
    }

    const isLastBatch = batch.batch_index === batch.batches_total - 1;
    const updatedAt = new Date().toISOString();
    const status: EmbeddingRepairRun["status"] = isLastBatch ? "completed" : "running";
    const state = buildState({
      run_id: runId,
      corpus: input.corpus,
      target_model: targetModel,
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
      target_model: targetModel,
      dry_run: dryRun,
    });
    nextBatch = await batchIterator.next();
  }

  const finalUpdatedAt = new Date().toISOString();
  return {
    success: true,
    status_code: "repair_completed",
    corpus: input.corpus,
    target_model: targetModel,
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
    countRepairCandidates?: (input: {
      corpus: EmbeddingRepairCorpus;
      afterId: number | null;
      targetModel: string;
    }) => Promise<number>;
    listRepairCandidateBatch?: (input: {
      corpus: EmbeddingRepairCorpus;
      afterId: number | null;
      limit: number;
      targetModel: string;
    }) => Promise<RepairCandidateRow[]>;
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
    countRepairCandidates: store.countRepairCandidates
      ? async (request) => {
          if (request.corpus !== corpus) {
            throw new Error(`${storeName} repair count only supports ${corpus}, received ${request.corpus}`);
          }
          return await store.countRepairCandidates!(request);
        }
      : undefined,
    listRepairCandidateBatch: store.listRepairCandidateBatch
      ? async (request) => {
          if (request.corpus !== corpus) {
            throw new Error(`${storeName} repair batch only supports ${corpus}, received ${request.corpus}`);
          }
          return await store.listRepairCandidateBatch!(request);
        }
      : undefined,
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
  const results = await generateDocumentEmbeddingResultsBatch({
    texts: params.rows.map((row) => row.text),
    embeddingProvider: params.embeddingProvider,
  });
  for (const [index, result] of results.entries()) {
    if (result.status === "unavailable") {
      return {
        status: "failed",
        failure_class: "embedding_unavailable",
        message: params.missingMessage,
        retryable: false,
      };
    }
    if (result.status === "failed") {
      return {
        status: "failed",
        failure_class: "embedding_error",
        message: result.err instanceof Error ? result.err.message : String(result.err),
        retryable: true,
      };
    }
    embeddings.push({ row_id: params.rows[index]!.id, embedding: result.embedding });
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

export async function runReviewCommentEmbeddingRepair(
  input: EmbeddingRepairRunnerInput<ReviewCommentStore>,
): Promise<EmbeddingRepairReport> {
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

export async function runIssueEmbeddingRepair(
  input: EmbeddingRepairRunnerInput<IssueStore> & { corpus: "issues" | "issue_comments" },
): Promise<EmbeddingRepairReport> {
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

export async function runLearningMemoryEmbeddingRepair(
  input: EmbeddingRepairRunnerInput<LearningMemoryStore>,
): Promise<EmbeddingRepairReport> {
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

export async function runCodeSnippetEmbeddingRepair(
  input: EmbeddingRepairRunnerInput<CodeSnippetStore>,
): Promise<EmbeddingRepairReport> {
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

// ── Canonical code repair ─────────────────────────────────────────────────────

/**
 * Maximum number of canonical chunks to pull per repair pass.
 * Keeps memory bounded; operator can run multiple passes for large corpora.
 */
const CANONICAL_CODE_REPAIR_LIMIT = 2000;

/**
 * Build an EmbeddingRepairStore adapter over CanonicalCodeStore.
 *
 * The adapter maps from the number-ID repair infrastructure to the bigint IDs
 * used by canonical_code_chunks. Row IDs are stored as their string
 * representation in the number-keyed maps to avoid precision loss for very
 * large bigints; JavaScript Number is safe for IDs up to 2^53-1.
 *
 * listRepairCandidates: queries all chunks where stale=true OR embedding IS NULL
 * OR model != targetModel, up to CANONICAL_CODE_REPAIR_LIMIT rows.
 *
 * writeRepairEmbeddingsBatch: maps number IDs back to bigints and calls
 * CanonicalCodeStore.updateEmbeddingsBatch.
 *
 * The canonical corpus has no persistent checkpoint table — repair state
 * is implicit (re-run until listStaleChunks returns empty). getRepairState /
 * saveRepairState are therefore no-ops that keep the repair framework happy.
 */
function createCanonicalCodeRepairStore(
  store: CanonicalCodeStore,
  opts: {
    repo: string;
    canonicalRef: string;
    targetModel: string;
  },
): EmbeddingRepairStore {
  // Number→bigint ID bridge. Using a Map avoids relying on JS number precision
  // for very large bigints (though canonical IDs are typically sequential).
  const idMap = new Map<number, bigint>();

  return {
    async listRepairCandidates(_corpus: EmbeddingRepairCorpus): Promise<RepairCandidateRow[]> {
      const chunks = await store.listStaleChunks({
        repo: opts.repo,
        canonicalRef: opts.canonicalRef,
        targetModel: opts.targetModel,
        limit: CANONICAL_CODE_REPAIR_LIMIT,
      });

      idMap.clear();
      return chunks.map((chunk, index) => {
        // Use a sequential int key so the number→bigint bridge stays simple.
        const numericId = index + 1;
        idMap.set(numericId, chunk.id);
        const row: RepairCandidateRow = {
          id: numericId,
          corpus: "canonical_code",
          embedding_model: chunk.embeddingModel,
          embedding: null, // not needed for repair — presence of chunk_text is sufficient
          stale: chunk.stale,
          chunk_text: chunk.chunkText,
        };
        return row;
      });
    },

    async getRepairState(_corpus: EmbeddingRepairCorpus): Promise<EmbeddingRepairCheckpoint | null> {
      // Canonical code repair has no persistent checkpoint — always starts fresh.
      return null;
    },

    async saveRepairState(_state: EmbeddingRepairCheckpoint): Promise<void> {
      // No-op: canonical code repair does not persist checkpoints.
    },

    async writeRepairEmbeddingsBatch(payload: {
      corpus: EmbeddingRepairCorpus;
      row_ids: number[];
      target_model: string;
      embeddings: Array<{ row_id: number; embedding: Float32Array }>;
    }): Promise<void> {
      const mapped = payload.embeddings.map((entry) => {
        const bigId = idMap.get(entry.row_id);
        if (!bigId) {
          throw new Error(
            `canonical_code repair: no bigint mapping for numeric ID ${entry.row_id}`,
          );
        }
        return { id: bigId, embedding: entry.embedding };
      });
      await store.updateEmbeddingsBatch({
        embeddings: mapped,
        targetModel: payload.target_model,
      });
    },
  };
}

/**
 * Run embedding repair for a single canonical code repo×ref pair.
 *
 * Fail-open: per-batch failures are recorded in the repair report but do not
 * propagate exceptions — the operator can re-run to repair remaining chunks.
 * This matches the behaviour of other corpus repair runners.
 */
export async function runCanonicalCodeEmbeddingRepair(
  input: EmbeddingRepairRunnerInput<CanonicalCodeStore> & {
    repo: string;
    canonicalRef: string;
  },
): Promise<EmbeddingRepairReport> {
  const targetModel = CANONICAL_CODE_TARGET_EMBEDDING_MODEL;
  const repairStore = createCanonicalCodeRepairStore(input.store, {
    repo: input.repo,
    canonicalRef: input.canonicalRef,
    targetModel,
  });

  return await runEmbeddingRepair({
    corpus: "canonical_code",
    resume: input.resume,
    dryRun: input.dryRun,
    batchSize: input.batchSize,
    logger: input.logger,
    store: repairStore,
    embedRows: async (rows) => await embedPersistedRepairRows({
      rows,
      embeddingProvider: input.embeddingProvider,
      missingMessage: `Embedding provider returned null for canonical code chunk in ${input.repo}@${input.canonicalRef}`,
    }),
  });
}
