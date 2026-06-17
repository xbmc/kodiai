import type { EmbeddingProvider } from "./types.ts";

export type EmbeddingRepairCorpus = "review_comments" | "learning_memories" | "code_snippets" | "issues" | "issue_comments" | "canonical_code";

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
  getRepairState: (corpus: EmbeddingRepairCorpus) => Promise<EmbeddingRepairCheckpoint | null>;
  saveRepairState: (state: EmbeddingRepairCheckpoint) => Promise<void>;
  writeRepairEmbeddingsBatch: (payload: {
    corpus: EmbeddingRepairCorpus;
    row_ids: number[];
    target_model: string;
    embeddings: Array<{ row_id: number; embedding: Float32Array }>;
  }) => Promise<void>;
};

export type EmbeddingRepairLogger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
};

export type EmbeddingRepairRunnerInput<Store> = {
  store: Store;
  embeddingProvider: EmbeddingProvider;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  logger?: EmbeddingRepairLogger;
};

export const NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-4";
export const CANONICAL_CODE_TARGET_EMBEDDING_MODEL = "voyage-4";
export const NON_WIKI_REPAIR_CORPORA = [
  "review_comments",
  "learning_memories",
  "code_snippets",
  "issues",
  "issue_comments",
  "canonical_code",
] as const satisfies readonly EmbeddingRepairCorpus[];
export const STALE_SUPPORTED_CORPORA = [
  "review_comments",
  "learning_memories",
  "code_snippets",
  "canonical_code",
] as const satisfies readonly EmbeddingRepairCorpus[];
