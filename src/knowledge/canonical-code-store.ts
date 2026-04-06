/**
 * Canonical current-code corpus store backed by PostgreSQL with pgvector.
 *
 * Manages `canonical_code_chunks` and `canonical_corpus_backfill_state`
 * (migration 033-canonical-code-corpus.sql).
 *
 * Separation guarantee: this module MUST NOT touch historical snippet tables
 * (code_snippets, code_snippet_occurrences — migration 009).
 *
 * Key semantics:
 *   - upsertChunk:   conflict key is chunk identity; content_hash guards dedup.
 *   - deleteChunksForFile: soft-delete via deleted_at before re-ingesting a file.
 *   - search*:       scoped to a specific repo + canonical_ref; excludes deleted rows.
 *   - repair helpers: listStaleChunks / updateEmbeddingsBatch for model-drift repair.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  CanonicalChunkSearchResult,
  CanonicalChunkType,
  CanonicalChunkWriteInput,
  CanonicalCodeChunk,
  CanonicalCodeStore,
  CanonicalCorpusBackfillState,
} from "./canonical-code-types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a Float32Array to pgvector-compatible string format: [0.1,0.2,...]
 * Mirrors the same utility used in code-snippet-store.ts.
 */
function float32ArrayToVectorString(arr: Float32Array): string {
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    parts[i] = String(arr[i]);
  }
  return `[${parts.join(",")}]`;
}

// ── Raw DB row shapes ─────────────────────────────────────────────────────────

type CanonicalChunkRow = {
  id: string | bigint;
  repo: string;
  owner: string;
  canonical_ref: string;
  commit_sha: string;
  file_path: string;
  language: string;
  start_line: number | string;
  end_line: number | string;
  chunk_type: string;
  symbol_name: string | null;
  chunk_text: string;
  content_hash: string;
  embedding: unknown;
  embedding_model: string | null;
  stale: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type BackfillStateRow = {
  repo: string;
  owner: string;
  canonical_ref: string;
  run_id: string;
  status: string;
  files_total: number | string | null;
  files_done: number | string;
  chunks_total: number | string | null;
  chunks_done: number | string;
  chunks_skipped: number | string;
  chunks_failed: number | string;
  last_file_path: string | null;
  commit_sha: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToChunk(row: CanonicalChunkRow): CanonicalCodeChunk {
  return {
    id: BigInt(row.id as string),
    repo: row.repo,
    owner: row.owner,
    canonicalRef: row.canonical_ref,
    commitSha: row.commit_sha,
    filePath: row.file_path,
    language: row.language,
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    chunkType: row.chunk_type as CanonicalChunkType,
    symbolName: row.symbol_name,
    chunkText: row.chunk_text,
    contentHash: row.content_hash,
    embeddingModel: row.embedding_model,
    stale: Boolean(row.stale),
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSearchResult(
  row: CanonicalChunkRow & { distance: number | string },
): CanonicalChunkSearchResult {
  return {
    id: BigInt(row.id as string),
    repo: row.repo,
    owner: row.owner,
    canonicalRef: row.canonical_ref,
    commitSha: row.commit_sha,
    filePath: row.file_path,
    language: row.language,
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    chunkType: row.chunk_type as CanonicalChunkType,
    symbolName: row.symbol_name,
    chunkText: row.chunk_text,
    contentHash: row.content_hash,
    distance: Number(row.distance),
    embeddingModel: row.embedding_model,
  };
}

function rowToBackfillState(row: BackfillStateRow): CanonicalCorpusBackfillState {
  return {
    repo: row.repo,
    owner: row.owner,
    canonicalRef: row.canonical_ref,
    runId: row.run_id,
    status: row.status as CanonicalCorpusBackfillState["status"],
    filesTotal: row.files_total == null ? null : Number(row.files_total),
    filesDone: Number(row.files_done),
    chunksTotal: row.chunks_total == null ? null : Number(row.chunks_total),
    chunksDone: Number(row.chunks_done),
    chunksSkipped: Number(row.chunks_skipped),
    chunksFailed: Number(row.chunks_failed),
    lastFilePath: row.last_file_path,
    commitSha: row.commit_sha,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a canonical code store backed by PostgreSQL with pgvector.
 * Schema is managed by migration 033-canonical-code-corpus.sql.
 */
export function createCanonicalCodeStore(opts: {
  sql: Sql;
  logger: Logger;
}): CanonicalCodeStore {
  const { sql, logger } = opts;

  const store: CanonicalCodeStore = {
    // ── upsertChunk ───────────────────────────────────────────────────────────

    async upsertChunk(
      input: CanonicalChunkWriteInput,
      embedding: Float32Array,
    ): Promise<"inserted" | "replaced" | "dedup"> {
      const embeddingString = float32ArrayToVectorString(embedding);
      // COALESCE to sentinel matches the partial unique index.
      const symbolKey = input.symbolName ?? "";

      try {
        // Check if a live row exists for this chunk identity.
        const existing = await sql`
          SELECT id, content_hash
          FROM canonical_code_chunks
          WHERE repo = ${input.repo}
            AND owner = ${input.owner}
            AND canonical_ref = ${input.canonicalRef}
            AND file_path = ${input.filePath}
            AND chunk_type = ${input.chunkType}
            AND COALESCE(symbol_name, '') = ${symbolKey}
            AND deleted_at IS NULL
          LIMIT 1
        `;

        if (existing.length > 0) {
          const row = existing[0] as { id: string | bigint; content_hash: string };
          if (row.content_hash === input.contentHash) {
            // Content unchanged — skip re-embedding.
            logger.debug(
              { repo: input.repo, filePath: input.filePath, symbolName: input.symbolName },
              "Canonical chunk dedup hit — content unchanged",
            );
            return "dedup";
          }

          // Content changed — update in place.
          const rowIdStr = String(row.id);
          await sql`
            UPDATE canonical_code_chunks
            SET
              commit_sha      = ${input.commitSha},
              start_line      = ${input.startLine},
              end_line        = ${input.endLine},
              chunk_text      = ${input.chunkText},
              content_hash    = ${input.contentHash},
              embedding       = ${embeddingString}::vector,
              embedding_model = ${input.embeddingModel},
              stale           = false,
              deleted_at      = NULL,
              updated_at      = now()
            WHERE id = ${rowIdStr}::bigint
          `;
          logger.debug(
            { repo: input.repo, filePath: input.filePath, symbolName: input.symbolName },
            "Canonical chunk replaced — content changed",
          );
          return "replaced";
        }

        // No live row — insert fresh.
        await sql`
          INSERT INTO canonical_code_chunks (
            repo, owner, canonical_ref, commit_sha,
            file_path, language, start_line, end_line,
            chunk_type, symbol_name,
            chunk_text, content_hash,
            embedding, embedding_model,
            stale
          ) VALUES (
            ${input.repo}, ${input.owner}, ${input.canonicalRef}, ${input.commitSha},
            ${input.filePath}, ${input.language}, ${input.startLine}, ${input.endLine},
            ${input.chunkType}, ${input.symbolName ?? null},
            ${input.chunkText}, ${input.contentHash},
            ${embeddingString}::vector, ${input.embeddingModel},
            false
          )
        `;
        logger.debug(
          { repo: input.repo, filePath: input.filePath, symbolName: input.symbolName },
          "Canonical chunk inserted",
        );
        return "inserted";
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          {
            err: message,
            repo: input.repo,
            filePath: input.filePath,
            symbolName: input.symbolName,
          },
          "Failed to upsert canonical chunk",
        );
        throw err;
      }
    },

    // ── deleteChunksForFile ───────────────────────────────────────────────────

    async deleteChunksForFile(params: {
      repo: string;
      owner: string;
      canonicalRef: string;
      filePath: string;
    }): Promise<number> {
      try {
        const result = await sql`
          UPDATE canonical_code_chunks
          SET deleted_at = now(), updated_at = now()
          WHERE repo = ${params.repo}
            AND owner = ${params.owner}
            AND canonical_ref = ${params.canonicalRef}
            AND file_path = ${params.filePath}
            AND deleted_at IS NULL
        `;
        const count = result.count ?? 0;
        logger.debug(
          { ...params, deletedCount: count },
          "Soft-deleted canonical chunks for file",
        );
        return count;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, ...params }, "Failed to delete canonical chunks for file");
        throw err;
      }
    },

    // ── searchByEmbedding ─────────────────────────────────────────────────────

    async searchByEmbedding(params: {
      queryEmbedding: Float32Array;
      repo: string;
      canonicalRef: string;
      topK: number;
      language?: string;
      distanceThreshold?: number;
    }): Promise<CanonicalChunkSearchResult[]> {
      const queryVec = float32ArrayToVectorString(params.queryEmbedding);
      const threshold = params.distanceThreshold ?? 0.7;

      const rows = params.language
        ? await sql`
            SELECT
              id, repo, owner, canonical_ref, commit_sha,
              file_path, language, start_line, end_line,
              chunk_type, symbol_name, chunk_text, content_hash,
              embedding_model,
              embedding <=> ${queryVec}::vector AS distance
            FROM canonical_code_chunks
            WHERE repo = ${params.repo}
              AND canonical_ref = ${params.canonicalRef}
              AND language = ${params.language}
              AND deleted_at IS NULL
              AND stale = false
              AND embedding IS NOT NULL
              AND embedding <=> ${queryVec}::vector < ${threshold}
            ORDER BY embedding <=> ${queryVec}::vector
            LIMIT ${params.topK}
          `
        : await sql`
            SELECT
              id, repo, owner, canonical_ref, commit_sha,
              file_path, language, start_line, end_line,
              chunk_type, symbol_name, chunk_text, content_hash,
              embedding_model,
              embedding <=> ${queryVec}::vector AS distance
            FROM canonical_code_chunks
            WHERE repo = ${params.repo}
              AND canonical_ref = ${params.canonicalRef}
              AND deleted_at IS NULL
              AND stale = false
              AND embedding IS NOT NULL
              AND embedding <=> ${queryVec}::vector < ${threshold}
            ORDER BY embedding <=> ${queryVec}::vector
            LIMIT ${params.topK}
          `;

      return rows.map((row) => rowToSearchResult(row as CanonicalChunkRow & { distance: number }));
    },

    // ── searchByFullText ──────────────────────────────────────────────────────

    async searchByFullText(params: {
      query: string;
      repo: string;
      canonicalRef: string;
      topK: number;
      language?: string;
    }): Promise<CanonicalChunkSearchResult[]> {
      if (!params.query.trim()) return [];

      const rows = params.language
        ? await sql`
            SELECT
              id, repo, owner, canonical_ref, commit_sha,
              file_path, language, start_line, end_line,
              chunk_type, symbol_name, chunk_text, content_hash,
              embedding_model,
              1 - ts_rank(tsv, plainto_tsquery('english', ${params.query})) AS distance
            FROM canonical_code_chunks
            WHERE repo = ${params.repo}
              AND canonical_ref = ${params.canonicalRef}
              AND language = ${params.language}
              AND deleted_at IS NULL
              AND tsv @@ plainto_tsquery('english', ${params.query})
            ORDER BY ts_rank(tsv, plainto_tsquery('english', ${params.query})) DESC
            LIMIT ${params.topK}
          `
        : await sql`
            SELECT
              id, repo, owner, canonical_ref, commit_sha,
              file_path, language, start_line, end_line,
              chunk_type, symbol_name, chunk_text, content_hash,
              embedding_model,
              1 - ts_rank(tsv, plainto_tsquery('english', ${params.query})) AS distance
            FROM canonical_code_chunks
            WHERE repo = ${params.repo}
              AND canonical_ref = ${params.canonicalRef}
              AND deleted_at IS NULL
              AND tsv @@ plainto_tsquery('english', ${params.query})
            ORDER BY ts_rank(tsv, plainto_tsquery('english', ${params.query})) DESC
            LIMIT ${params.topK}
          `;

      return rows.map((row) => rowToSearchResult(row as CanonicalChunkRow & { distance: number }));
    },

    // ── countChunks ───────────────────────────────────────────────────────────

    async countChunks(params: {
      repo: string;
      canonicalRef: string;
    }): Promise<number> {
      const rows = await sql`
        SELECT COUNT(*)::int AS total
        FROM canonical_code_chunks
        WHERE repo = ${params.repo}
          AND canonical_ref = ${params.canonicalRef}
          AND deleted_at IS NULL
      `;
      const row = rows[0] as { total: number } | undefined;
      return row?.total ?? 0;
    },

    // ── listChunksForFile ────────────────────────────────────────────────────

    async listChunksForFile(params: {
      repo: string;
      owner: string;
      canonicalRef: string;
      filePath: string;
    }): Promise<Array<Pick<CanonicalCodeChunk, "id" | "filePath" | "chunkType" | "symbolName" | "contentHash">>> {
      const rows = await sql`
        SELECT id, file_path, chunk_type, symbol_name, content_hash
        FROM canonical_code_chunks
        WHERE repo = ${params.repo}
          AND owner = ${params.owner}
          AND canonical_ref = ${params.canonicalRef}
          AND file_path = ${params.filePath}
          AND deleted_at IS NULL
        ORDER BY id ASC
      `;
      return rows.map((row) => {
        const typed = row as {
          id: string | bigint;
          file_path: string;
          chunk_type: string;
          symbol_name: string | null;
          content_hash: string;
        };
        return {
          id: BigInt(typed.id),
          filePath: typed.file_path,
          chunkType: typed.chunk_type as CanonicalChunkType,
          symbolName: typed.symbol_name,
          contentHash: typed.content_hash,
        };
      });
    },

    // ── listStaleChunks ───────────────────────────────────────────────────────

    async listStaleChunks(params: {
      repo: string;
      canonicalRef: string;
      targetModel: string;
      limit: number;
    }): Promise<CanonicalCodeChunk[]> {
      const rows = await sql`
        SELECT
          id, repo, owner, canonical_ref, commit_sha,
          file_path, language, start_line, end_line,
          chunk_type, symbol_name, chunk_text, content_hash,
          embedding, embedding_model, stale, deleted_at, created_at, updated_at
        FROM canonical_code_chunks
        WHERE repo = ${params.repo}
          AND canonical_ref = ${params.canonicalRef}
          AND deleted_at IS NULL
          AND (
            embedding IS NULL
            OR stale = true
            OR embedding_model IS DISTINCT FROM ${params.targetModel}
          )
        ORDER BY id ASC
        LIMIT ${params.limit}
      `;
      return rows.map((row) => rowToChunk(row as CanonicalChunkRow));
    },

    // ── markStale ─────────────────────────────────────────────────────────────

    async markStale(ids: bigint[]): Promise<void> {
      if (ids.length === 0) return;
      const idStrings = ids.map(String);
      await sql`
        UPDATE canonical_code_chunks
        SET stale = true, updated_at = now()
        WHERE id = ANY(${idStrings}::bigint[])
      `;
    },

    // ── updateEmbeddingsBatch ─────────────────────────────────────────────────

    async updateEmbeddingsBatch(payload: {
      embeddings: Array<{ id: bigint; embedding: Float32Array }>;
      targetModel: string;
    }): Promise<void> {
      if (payload.embeddings.length === 0) return;

      const ids = payload.embeddings.map((e) => String(e.id));
      const vectors = payload.embeddings.map((e) => float32ArrayToVectorString(e.embedding));

      await sql.begin(async (tx) => {
        await (tx as unknown as Sql).unsafe(
          `
            UPDATE canonical_code_chunks AS target
            SET embedding       = updates.embedding::vector,
                embedding_model = $2,
                stale           = false,
                updated_at      = now()
            FROM (
              SELECT UNNEST($1::bigint[]) AS id, UNNEST($3::text[]) AS embedding
            ) AS updates
            WHERE target.id = updates.id
          `,
          [ids, payload.targetModel, vectors],
        );
      });
    },

    // ── Backfill state ────────────────────────────────────────────────────────

    async getBackfillState(params: {
      repo: string;
      owner: string;
      canonicalRef: string;
    }): Promise<CanonicalCorpusBackfillState | null> {
      const rows = await sql`
        SELECT *
        FROM canonical_corpus_backfill_state
        WHERE repo = ${params.repo}
          AND owner = ${params.owner}
          AND canonical_ref = ${params.canonicalRef}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToBackfillState(rows[0] as unknown as BackfillStateRow);
    },

    async saveBackfillState(state: CanonicalCorpusBackfillState): Promise<void> {
      await sql`
        INSERT INTO canonical_corpus_backfill_state (
          repo, owner, canonical_ref, run_id, status,
          files_total, files_done,
          chunks_total, chunks_done, chunks_skipped, chunks_failed,
          last_file_path, commit_sha, error_message,
          updated_at
        ) VALUES (
          ${state.repo}, ${state.owner}, ${state.canonicalRef}, ${state.runId}, ${state.status},
          ${state.filesTotal ?? null}, ${state.filesDone},
          ${state.chunksTotal ?? null}, ${state.chunksDone}, ${state.chunksSkipped}, ${state.chunksFailed},
          ${state.lastFilePath ?? null}, ${state.commitSha ?? null}, ${state.errorMessage ?? null},
          now()
        )
        ON CONFLICT (repo, owner, canonical_ref) DO UPDATE SET
          run_id        = EXCLUDED.run_id,
          status        = EXCLUDED.status,
          files_total   = EXCLUDED.files_total,
          files_done    = EXCLUDED.files_done,
          chunks_total  = EXCLUDED.chunks_total,
          chunks_done   = EXCLUDED.chunks_done,
          chunks_skipped = EXCLUDED.chunks_skipped,
          chunks_failed = EXCLUDED.chunks_failed,
          last_file_path = EXCLUDED.last_file_path,
          commit_sha    = EXCLUDED.commit_sha,
          error_message = EXCLUDED.error_message,
          updated_at    = EXCLUDED.updated_at
      `;
    },

    // ── close ─────────────────────────────────────────────────────────────────

    close() {
      // No cleanup needed — sql connection is managed externally.
    },
  };

  return store;
}
