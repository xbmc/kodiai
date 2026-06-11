import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { LearningMemoryRecord, LearningMemoryStore } from "./types.ts";
import type { EmbeddingRepairCheckpoint, EmbeddingRepairCorpus, RepairCandidateRow } from "./embedding-repair.ts";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

/**
 * Convert a Float32Array to pgvector-compatible string format: [0.1,0.2,...]
 */
function float32ArrayToVectorString(arr: Float32Array): string {
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    parts[i] = String(arr[i]);
  }
  return `[${parts.join(",")}]`;
}

type MemoryRow = {
  id: number | string | bigint;
  repo: string;
  owner: string;
  finding_id: number | string | bigint;
  review_id: number | string | bigint;
  source_repo: string;
  finding_text: string;
  severity: string;
  category: string;
  file_path: string;
  language: string | null;
  outcome: string;
  embedding: unknown;
  embedding_model: string | null;
  embedding_dim: number;
  stale: boolean;
  created_at: string;
};

type RepairStateRow = {
  id: number;
  corpus: string;
  repair_key: string;
  run_id: string;
  target_model: string | null;
  dry_run: boolean;
  resumed: boolean;
  status: string;
  resume_ready: boolean;
  batch_index: number | null;
  batches_total: number | null;
  last_row_id: number | null;
  processed: number;
  repaired: number;
  skipped: number;
  failed: number;
  failure_counts: Record<string, number> | string | null;
  last_failure_class: string | null;
  last_failure_message: string | null;
  updated_at: string;
  created_at: string;
};

const DEFAULT_REPAIR_KEY = "default";
const REPAIR_CORPUS = "learning_memories" as const satisfies EmbeddingRepairCorpus;

type RequiredLearningMemorySqlField =
  | "repo"
  | "owner"
  | "findingId"
  | "reviewId"
  | "sourceRepo"
  | "findingText"
  | "severity"
  | "category"
  | "filePath"
  | "outcome"
  | "embeddingModel"
  | "embeddingDim"
  | "stale";

type PreparedLearningMemoryRecord = Omit<LearningMemoryRecord, "id" | "language" | "createdAt"> & {
  id: number | null;
  language: string | null;
  createdAt: string | null;
};

const REQUIRED_LEARNING_MEMORY_SQL_FIELDS = [
  "repo",
  "owner",
  "findingId",
  "reviewId",
  "sourceRepo",
  "findingText",
  "severity",
  "category",
  "filePath",
  "outcome",
  "embeddingModel",
  "embeddingDim",
  "stale",
] as const satisfies readonly RequiredLearningMemorySqlField[];

function assertRequiredLearningMemorySqlField(
  record: LearningMemoryRecord,
  field: RequiredLearningMemorySqlField,
): void {
  if (record[field] === undefined) {
    throw new Error(`LearningMemoryRecord.${field} is undefined before SQL binding`);
  }
}

/**
 * Prepare a learning-memory record for postgres.js binding.
 *
 * Required SQL-bound fields fail locally if undefined so postgres UNDEFINED_VALUE
 * is never the first visible signal. Optional fields are normalized to null at
 * this boundary; writeMemory can still derive fallback language before writing.
 */
export function prepareLearningMemoryRecordForSql(record: LearningMemoryRecord): PreparedLearningMemoryRecord {
  for (const field of REQUIRED_LEARNING_MEMORY_SQL_FIELDS) {
    assertRequiredLearningMemorySqlField(record, field);
  }

  return {
    repo: record.repo,
    owner: record.owner,
    findingId: record.findingId,
    reviewId: record.reviewId,
    sourceRepo: record.sourceRepo,
    findingText: record.findingText,
    severity: record.severity,
    category: record.category,
    filePath: record.filePath,
    language: record.language ?? null,
    outcome: record.outcome,
    embeddingModel: record.embeddingModel,
    embeddingDim: record.embeddingDim,
    stale: record.stale,
    id: record.id ?? null,
    createdAt: record.createdAt ?? null,
  };
}

export function normalizeSafeInteger(value: number | string | bigint, fieldName: string): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`${fieldName} exceeds JavaScript safe integer range: ${String(value)}`);
    }
    return Number(value);
  }

  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`${fieldName} is not an integer: ${String(value)}`);
    }
    const bigintValue = BigInt(value);
    if (bigintValue > BigInt(Number.MAX_SAFE_INTEGER) || bigintValue < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`${fieldName} exceeds JavaScript safe integer range: ${String(value)}`);
    }
    return Number(bigintValue);
  }

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} exceeds JavaScript safe integer range: ${String(value)}`);
  }
  return value;
}

function rowToRecord(row: MemoryRow): LearningMemoryRecord {
  return {
    id: normalizeSafeInteger(row.id, "learning_memories.id"),
    repo: row.repo,
    owner: row.owner,
    findingId: normalizeSafeInteger(row.finding_id, "learning_memories.finding_id"),
    reviewId: normalizeSafeInteger(row.review_id, "learning_memories.review_id"),
    sourceRepo: row.source_repo,
    findingText: row.finding_text,
    severity: row.severity as LearningMemoryRecord["severity"],
    category: row.category as LearningMemoryRecord["category"],
    filePath: row.file_path,
    language: row.language ?? undefined,
    outcome: row.outcome as LearningMemoryRecord["outcome"],
    embeddingModel: row.embedding_model ?? "voyage-4",
    embeddingDim: row.embedding_dim,
    stale: row.stale,
    createdAt: row.created_at,
  };
}

function rowToRepairState(row: RepairStateRow): EmbeddingRepairCheckpoint {
  const failureCounts = typeof row.failure_counts === "string"
    ? JSON.parse(row.failure_counts) as Record<string, number>
    : (row.failure_counts ?? {});

  return {
    run_id: row.run_id,
    corpus: row.corpus as EmbeddingRepairCorpus,
    repair_key: row.repair_key,
    target_model: row.target_model ?? undefined,
    dry_run: row.dry_run,
    resumed: row.resumed,
    status: row.status as EmbeddingRepairCheckpoint["status"],
    resume_ready: row.resume_ready,
    batch_index: row.batch_index == null ? null : Number(row.batch_index),
    batches_total: row.batches_total == null ? null : Number(row.batches_total),
    last_row_id: row.last_row_id == null ? null : Number(row.last_row_id),
    processed: Number(row.processed),
    repaired: Number(row.repaired),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    failure_summary: {
      by_class: failureCounts,
      last_failure_class: row.last_failure_class,
      last_failure_message: row.last_failure_message,
    },
    updated_at: row.updated_at,
  };
}

/**
 * Create a learning memory store backed by PostgreSQL with pgvector for vector search.
 * Uses HNSW index with cosine distance operator for efficient similarity queries.
 * Schema is managed by migrations (001-initial-schema.sql + 002-pgvector-indexes.sql).
 */
export function createLearningMemoryStore(opts: {
  sql: Sql;
  logger: Logger;
}): LearningMemoryStore {
  const { sql, logger } = opts;

  const store: LearningMemoryStore = {
    async hasMemoryConflict(key: { repo: string; findingId: number; outcome: LearningMemoryRecord["outcome"] }): Promise<boolean> {
      const rows = await sql`
        SELECT 1
        FROM learning_memories
        WHERE repo = ${key.repo}
          AND finding_id = ${key.findingId}
          AND outcome = ${key.outcome}
        LIMIT 1
      `;
      return rows.length > 0;
    },

    async writeMemory(record: LearningMemoryRecord, embedding: Float32Array): Promise<void> {
      const preparedRecord = prepareLearningMemoryRecordForSql(record);
      const embeddingString = float32ArrayToVectorString(embedding);
      // Use record.language if caller pre-classified (e.g., context-aware for .h files),
      // otherwise classify from filePath. Normalize to lowercase for DB storage.
      const language = preparedRecord.language
        ? preparedRecord.language.toLowerCase()
        : classifyFileLanguage(preparedRecord.filePath).toLowerCase().replace("unknown", "unknown");
      try {
        await sql`
          INSERT INTO learning_memories (
            repo, owner, finding_id, review_id, source_repo,
            finding_text, severity, category, file_path, language, outcome,
            embedding_model, embedding_dim, stale, embedding
          ) VALUES (
            ${preparedRecord.repo}, ${preparedRecord.owner}, ${preparedRecord.findingId}, ${preparedRecord.reviewId}, ${preparedRecord.sourceRepo},
            ${preparedRecord.findingText}, ${preparedRecord.severity}, ${preparedRecord.category}, ${preparedRecord.filePath}, ${language}, ${preparedRecord.outcome},
            ${preparedRecord.embeddingModel}, ${preparedRecord.embeddingDim}, ${preparedRecord.stale}, ${embeddingString}::vector
          )
          ON CONFLICT (repo, finding_id, outcome) DO NOTHING
        `;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, repo: preparedRecord.repo, findingId: preparedRecord.findingId }, "Failed to write memory");
        throw err;
      }
    },

    async retrieveMemories(params: {
      queryEmbedding: Float32Array;
      repo: string;
      topK: number;
    }): Promise<{ memoryId: number; distance: number }[]> {
      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);
      const rows = await sql`
        SELECT m.id AS memory_id, m.embedding <=> ${queryEmbeddingString}::vector AS distance
        FROM learning_memories m
        WHERE m.repo = ${params.repo} AND m.stale = false
        ORDER BY m.embedding <=> ${queryEmbeddingString}::vector
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        memoryId: Number(row.memory_id),
        distance: Number(row.distance),
      }));
    },

    async retrieveMemoriesForOwner(params: {
      queryEmbedding: Float32Array;
      owner: string;
      excludeRepo: string;
      topK: number;
    }): Promise<{ memoryId: number; distance: number }[]> {
      // Find repos for the same owner (up to 5 most active)
      const repoRows = await sql`
        SELECT repo, COUNT(*) AS cnt
        FROM learning_memories
        WHERE owner = ${params.owner} AND repo != ${params.excludeRepo} AND stale = false
        GROUP BY repo
        ORDER BY cnt DESC
        LIMIT 5
      `;

      if (repoRows.length === 0) {
        return [];
      }

      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);
      const perRepoK = Math.max(1, Math.ceil(params.topK / repoRows.length));

      // Query each repo and merge results
      const allResults: { memoryId: number; distance: number }[] = [];

      for (const repoRow of repoRows) {
        try {
          const rows = await sql`
            SELECT m.id AS memory_id, m.embedding <=> ${queryEmbeddingString}::vector AS distance
            FROM learning_memories m
            WHERE m.repo = ${repoRow.repo} AND m.stale = false
            ORDER BY m.embedding <=> ${queryEmbeddingString}::vector
            LIMIT ${perRepoK}
          `;

          for (const row of rows) {
            allResults.push({
              memoryId: Number(row.memory_id),
              distance: Number(row.distance),
            });
          }
        } catch (err: unknown) {
          logger.debug(
            { err, repo: repoRow.repo },
            "Failed to retrieve memories from shared repo partition (fail-open)",
          );
        }
      }

      // Dedupe by memory_id, sort by distance, take topK
      const seen = new Set<number>();
      const deduped = allResults.filter((r) => {
        if (seen.has(r.memoryId)) return false;
        seen.add(r.memoryId);
        return true;
      });

      deduped.sort((a, b) => a.distance - b.distance);
      return deduped.slice(0, params.topK);
    },

    searchByFullText: async (params: {
      query: string;
      repo: string;
      topK: number;
    }): Promise<{ memoryId: number; rank: number }[]> => {
      if (!params.query.trim()) return [];

      const rows = await sql`
        SELECT m.id AS memory_id,
          ts_rank(m.search_tsv, plainto_tsquery('english', ${params.query})) AS rank
        FROM learning_memories m
        WHERE m.repo = ${params.repo}
          AND m.stale = false
          AND m.search_tsv @@ plainto_tsquery('english', ${params.query})
        ORDER BY rank DESC
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        memoryId: Number(row.memory_id),
        rank: Number(row.rank),
      }));
    },

    async getMemoryRecord(memoryId: number): Promise<LearningMemoryRecord | null> {
      const rows = await sql`SELECT * FROM learning_memories WHERE id = ${memoryId}`;
      if (rows.length === 0) return null;
      return rowToRecord(rows[0] as unknown as MemoryRow);
    },

    async getMemoryRecords(memoryIds: number[]): Promise<Map<number, LearningMemoryRecord>> {
      const ids = Array.from(new Set(memoryIds.filter((id) => Number.isSafeInteger(id))));
      if (ids.length === 0) return new Map();

      const rows = await sql.unsafe(
        "SELECT * FROM learning_memories WHERE id = ANY($1::bigint[])",
        [ids],
      );
      const records = new Map<number, LearningMemoryRecord>();
      for (const row of rows) {
        const memoryRow = row as unknown as MemoryRow;
        const record = rowToRecord(memoryRow);
        records.set(normalizeSafeInteger(memoryRow.id, "learning_memories.id"), record);
      }
      return records;
    },

    async markStale(embeddingModel: string): Promise<number> {
      const result = await sql`
        UPDATE learning_memories SET stale = true
        WHERE embedding_model != ${embeddingModel} AND stale = false
      `;
      return result.count;
    },

    async purgeStaleEmbeddings(): Promise<number> {
      const result = await sql`
        DELETE FROM learning_memories WHERE stale = true
      `;
      return result.count;
    },

    async listRepairCandidates(corpus: EmbeddingRepairCorpus): Promise<RepairCandidateRow[]> {
      if (corpus !== REPAIR_CORPUS) {
        throw new Error(`Unsupported repair corpus for LearningMemoryStore: ${corpus}`);
      }

      const rows = await sql`
        SELECT id, finding_text, severity, category, file_path, language, embedding, embedding_model, stale
        FROM learning_memories
        WHERE embedding IS NULL
           OR stale = true
           OR embedding_model IS DISTINCT FROM ${"voyage-4"}
        ORDER BY id ASC
      `;
      return rows.map((row) => ({
        id: Number(row.id),
        corpus: REPAIR_CORPUS,
        finding_text: row.finding_text as string,
        severity: row.severity as string,
        category: row.category as string,
        file_path: row.file_path as string,
        language: (row.language as string | null) ?? null,
        embedding: row.embedding,
        embedding_model: (row.embedding_model as string | null) ?? null,
        stale: Boolean(row.stale),
      }));
    },

    async getRepairState(corpus: EmbeddingRepairCorpus): Promise<EmbeddingRepairCheckpoint | null> {
      if (corpus !== REPAIR_CORPUS) {
        throw new Error(`Unsupported repair corpus for LearningMemoryStore: ${corpus}`);
      }

      const rows = await sql`
        SELECT * FROM embedding_repair_state
        WHERE corpus = ${corpus}
          AND repair_key = ${DEFAULT_REPAIR_KEY}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToRepairState(rows[0] as unknown as RepairStateRow);
    },

    async saveRepairState(state: EmbeddingRepairCheckpoint): Promise<void> {
      if (state.corpus !== REPAIR_CORPUS) {
        throw new Error(`Unsupported repair corpus for LearningMemoryStore: ${state.corpus}`);
      }

      await sql`
        INSERT INTO embedding_repair_state (
          corpus, repair_key, run_id, target_model,
          dry_run, resumed, status, resume_ready,
          batch_index, batches_total, last_row_id,
          processed, repaired, skipped, failed,
          failure_counts, last_failure_class, last_failure_message,
          updated_at
        ) VALUES (
          ${state.corpus}, ${state.repair_key ?? DEFAULT_REPAIR_KEY}, ${state.run_id}, ${state.target_model ?? "voyage-4"},
          ${state.dry_run ?? false}, ${state.resumed ?? false}, ${state.status ?? "running"}, ${state.resume_ready ?? false},
          ${state.batch_index}, ${state.batches_total}, ${state.last_row_id},
          ${state.processed}, ${state.repaired}, ${state.skipped}, ${state.failed},
          ${JSON.stringify(state.failure_summary.by_class)}::jsonb, ${state.failure_summary.last_failure_class}, ${state.failure_summary.last_failure_message},
          ${state.updated_at ?? new Date().toISOString()}
        )
        ON CONFLICT (corpus, repair_key) DO UPDATE SET
          run_id = EXCLUDED.run_id,
          target_model = EXCLUDED.target_model,
          dry_run = EXCLUDED.dry_run,
          resumed = EXCLUDED.resumed,
          status = EXCLUDED.status,
          resume_ready = EXCLUDED.resume_ready,
          batch_index = EXCLUDED.batch_index,
          batches_total = EXCLUDED.batches_total,
          last_row_id = EXCLUDED.last_row_id,
          processed = EXCLUDED.processed,
          repaired = EXCLUDED.repaired,
          skipped = EXCLUDED.skipped,
          failed = EXCLUDED.failed,
          failure_counts = EXCLUDED.failure_counts,
          last_failure_class = EXCLUDED.last_failure_class,
          last_failure_message = EXCLUDED.last_failure_message,
          updated_at = EXCLUDED.updated_at
      `;
    },

    async writeRepairEmbeddingsBatch(payload: {
      corpus: EmbeddingRepairCorpus;
      row_ids: number[];
      target_model: string;
      embeddings: Array<{ row_id: number; embedding: Float32Array }>;
    }): Promise<void> {
      if (payload.corpus !== REPAIR_CORPUS) {
        throw new Error(`Unsupported repair corpus for LearningMemoryStore: ${payload.corpus}`);
      }
      if (payload.embeddings.length === 0) return;

      const ids = payload.embeddings.map((item) => item.row_id);
      const vectors = payload.embeddings.map((item) => float32ArrayToVectorString(item.embedding));

      await sql.begin(async (tx) => {
        await (tx as unknown as Sql).unsafe(
          `
            UPDATE learning_memories AS target
            SET embedding = updates.embedding::vector,
                embedding_model = $2,
                stale = false
            FROM (
              SELECT UNNEST($1::bigint[]) AS row_id, UNNEST($3::text[]) AS embedding
            ) AS updates
            WHERE target.id = updates.row_id
          `,
          [ids, payload.target_model, vectors],
        );
      });
    },

    close(): void {
      // No-op: sql lifecycle managed by caller
    },
  };

  logger.debug("LearningMemoryStore initialized with pgvector HNSW index");
  return store;
}
