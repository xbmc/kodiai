import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { LearningMemoryRecord, LearningMemoryStore } from "./types.ts";

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
  id: number;
  repo: string;
  owner: string;
  finding_id: number;
  review_id: number;
  source_repo: string;
  finding_text: string;
  severity: string;
  category: string;
  file_path: string;
  outcome: string;
  embedding_model: string;
  embedding_dim: number;
  stale: boolean;
  created_at: string;
};

function rowToRecord(row: MemoryRow): LearningMemoryRecord {
  return {
    id: row.id,
    repo: row.repo,
    owner: row.owner,
    findingId: row.finding_id,
    reviewId: row.review_id,
    sourceRepo: row.source_repo,
    findingText: row.finding_text,
    severity: row.severity as LearningMemoryRecord["severity"],
    category: row.category as LearningMemoryRecord["category"],
    filePath: row.file_path,
    outcome: row.outcome as LearningMemoryRecord["outcome"],
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    stale: row.stale,
    createdAt: row.created_at,
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
    async writeMemory(record: LearningMemoryRecord, embedding: Float32Array): Promise<void> {
      const embeddingString = float32ArrayToVectorString(embedding);
      try {
        await sql`
          INSERT INTO learning_memories (
            repo, owner, finding_id, review_id, source_repo,
            finding_text, severity, category, file_path, outcome,
            embedding_model, embedding_dim, stale, embedding
          ) VALUES (
            ${record.repo}, ${record.owner}, ${record.findingId}, ${record.reviewId}, ${record.sourceRepo},
            ${record.findingText}, ${record.severity}, ${record.category}, ${record.filePath}, ${record.outcome},
            ${record.embeddingModel}, ${record.embeddingDim}, ${record.stale}, ${embeddingString}::vector
          )
          ON CONFLICT (repo, finding_id, outcome) DO NOTHING
        `;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, repo: record.repo, findingId: record.findingId }, "Failed to write memory");
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

    async getMemoryRecord(memoryId: number): Promise<LearningMemoryRecord | null> {
      const rows = await sql`SELECT * FROM learning_memories WHERE id = ${memoryId}`;
      if (rows.length === 0) return null;
      return rowToRecord(rows[0] as unknown as MemoryRow);
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

    close(): void {
      // No-op: sql lifecycle managed by caller
    },
  };

  logger.debug("LearningMemoryStore initialized with pgvector HNSW index");
  return store;
}
