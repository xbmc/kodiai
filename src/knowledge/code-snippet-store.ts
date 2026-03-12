/**
 * Code snippet store backed by PostgreSQL with pgvector.
 *
 * Uses content-hash deduplication: writeSnippet UPSERTs by content_hash
 * (identical hunk content is never re-embedded), while writeOccurrence
 * creates junction table entries linking each hash to PR/file/line metadata.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { CodeSnippetSearchResult, CodeSnippetStore } from "./code-snippet-types.ts";
import type { EmbeddingRepairCheckpoint, EmbeddingRepairCorpus, RepairCandidateRow } from "./embedding-repair.ts";

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

type CodeSnippetRow = {
  id: number;
  content_hash: string;
  embedded_text: string;
  language: string | null;
  embedding: unknown;
  embedding_model: string | null;
  stale: boolean;
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
const REPAIR_CORPUS: EmbeddingRepairCorpus = "code_snippets";

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
 * Create a code snippet store backed by PostgreSQL with pgvector for vector search.
 * Schema is managed by migration 009-code-snippets.sql.
 */
export function createCodeSnippetStore(opts: {
  sql: Sql;
  logger: Logger;
}): CodeSnippetStore {
  const { sql, logger } = opts;

  const store: CodeSnippetStore = {
    async writeSnippet(
      record: {
        contentHash: string;
        embeddedText: string;
        language: string;
        embeddingModel: string;
      },
      embedding: Float32Array,
    ): Promise<void> {
      const embeddingString = float32ArrayToVectorString(embedding);
      try {
        const result = await sql`
          INSERT INTO code_snippets (
            content_hash, embedded_text, language, embedding, embedding_model
          ) VALUES (
            ${record.contentHash}, ${record.embeddedText}, ${record.language},
            ${embeddingString}::vector, ${record.embeddingModel}
          )
          ON CONFLICT (content_hash) DO NOTHING
        `;
        if (result.count === 0) {
          logger.debug({ contentHash: record.contentHash }, "Snippet already exists (dedup hit)");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { err: message, contentHash: record.contentHash },
          "Failed to write code snippet",
        );
        throw err;
      }
    },

    async writeOccurrence(occurrence): Promise<void> {
      try {
        await sql`
          INSERT INTO code_snippet_occurrences (
            content_hash, repo, owner, pr_number, pr_title,
            file_path, start_line, end_line, function_context
          ) VALUES (
            ${occurrence.contentHash}, ${occurrence.repo}, ${occurrence.owner},
            ${occurrence.prNumber}, ${occurrence.prTitle ?? null},
            ${occurrence.filePath}, ${occurrence.startLine}, ${occurrence.endLine},
            ${occurrence.functionContext ?? null}
          )
        `;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { err: message, contentHash: occurrence.contentHash, repo: occurrence.repo },
          "Failed to write snippet occurrence",
        );
        throw err;
      }
    },

    async searchByEmbedding(params: {
      queryEmbedding: Float32Array;
      repo: string;
      topK: number;
      distanceThreshold?: number;
    }): Promise<CodeSnippetSearchResult[]> {
      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);
      const threshold = params.distanceThreshold ?? 0.7;

      const rows = await sql`
        SELECT
          cs.content_hash,
          cs.embedded_text,
          cs.language,
          cs.embedding <=> ${queryEmbeddingString}::vector AS distance,
          cso.repo,
          cso.pr_number,
          cso.pr_title,
          cso.file_path,
          cso.start_line,
          cso.end_line,
          cso.created_at
        FROM code_snippets cs
        INNER JOIN LATERAL (
          SELECT *
          FROM code_snippet_occurrences
          WHERE content_hash = cs.content_hash
            AND repo = ${params.repo}
          ORDER BY created_at DESC
          LIMIT 1
        ) cso ON true
        WHERE cs.stale = false
          AND cs.embedding IS NOT NULL
          AND cs.embedding <=> ${queryEmbeddingString}::vector < ${threshold}
        ORDER BY cs.embedding <=> ${queryEmbeddingString}::vector
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        contentHash: row.content_hash as string,
        embeddedText: row.embedded_text as string,
        distance: Number(row.distance),
        language: row.language as string,
        repo: row.repo as string,
        prNumber: row.pr_number as number,
        prTitle: (row.pr_title as string | null) ?? null,
        filePath: row.file_path as string,
        startLine: row.start_line as number,
        endLine: row.end_line as number,
        createdAt: row.created_at as string,
      }));
    },

    searchByFullText: async (params: {
      query: string;
      repo: string;
      topK: number;
    }): Promise<CodeSnippetSearchResult[]> => {
      if (!params.query.trim()) return [];

      const rows = await sql`
        SELECT
          cs.content_hash,
          cs.embedded_text,
          cs.language,
          ts_rank(cs.tsv, plainto_tsquery('english', ${params.query})) AS rank,
          cso.repo,
          cso.pr_number,
          cso.pr_title,
          cso.file_path,
          cso.start_line,
          cso.end_line,
          cso.created_at
        FROM code_snippets cs
        INNER JOIN LATERAL (
          SELECT *
          FROM code_snippet_occurrences
          WHERE content_hash = cs.content_hash
            AND repo = ${params.repo}
          ORDER BY created_at DESC
          LIMIT 1
        ) cso ON true
        WHERE cs.stale = false
          AND cs.tsv @@ plainto_tsquery('english', ${params.query})
        ORDER BY rank DESC
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        contentHash: row.content_hash as string,
        embeddedText: row.embedded_text as string,
        distance: 1 - Number(row.rank),
        language: row.language as string,
        repo: row.repo as string,
        prNumber: row.pr_number as number,
        prTitle: (row.pr_title as string | null) ?? null,
        filePath: row.file_path as string,
        startLine: row.start_line as number,
        endLine: row.end_line as number,
        createdAt: row.created_at as string,
      }));
    },

    async listRepairCandidates(corpus: EmbeddingRepairCorpus): Promise<RepairCandidateRow[]> {
      if (corpus !== REPAIR_CORPUS) {
        throw new Error(`Unsupported repair corpus for CodeSnippetStore: ${corpus}`);
      }

      const rows = await sql`
        SELECT id, embedded_text, language, embedding, embedding_model, stale
        FROM code_snippets
        WHERE embedded_text IS NOT NULL
          AND (
            embedding IS NULL
            OR stale = true
            OR embedding_model IS DISTINCT FROM ${"voyage-code-3"}
          )
        ORDER BY id ASC
      `;
      return rows.map((row) => ({
        id: Number(row.id),
        corpus: REPAIR_CORPUS,
        embedded_text: row.embedded_text as string,
        language: (row.language as string | null) ?? null,
        embedding: row.embedding,
        embedding_model: (row.embedding_model as string | null) ?? null,
        stale: Boolean(row.stale),
      }));
    },

    async getRepairState(corpus: EmbeddingRepairCorpus): Promise<EmbeddingRepairCheckpoint | null> {
      if (corpus !== REPAIR_CORPUS) {
        throw new Error(`Unsupported repair corpus for CodeSnippetStore: ${corpus}`);
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
        throw new Error(`Unsupported repair corpus for CodeSnippetStore: ${state.corpus}`);
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
          ${state.corpus}, ${state.repair_key ?? DEFAULT_REPAIR_KEY}, ${state.run_id}, ${state.target_model ?? "voyage-code-3"},
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
        throw new Error(`Unsupported repair corpus for CodeSnippetStore: ${payload.corpus}`);
      }
      if (payload.embeddings.length === 0) return;

      const ids = payload.embeddings.map((item) => item.row_id);
      const vectors = payload.embeddings.map((item) => float32ArrayToVectorString(item.embedding));

      await sql.begin(async (tx) => {
        await (tx as unknown as Sql).unsafe(
          `
            UPDATE code_snippets AS target
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

    close() {
      // No cleanup needed — sql connection is managed externally
    },
  };

  return store;
}
