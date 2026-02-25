import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  ReviewCommentChunk,
  ReviewCommentRecord,
  ReviewCommentSearchResult,
  ReviewCommentStore,
  SyncState,
} from "./review-comment-types.ts";

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

type CommentRow = {
  id: number;
  created_at: string;
  repo: string;
  owner: string;
  pr_number: number;
  pr_title: string | null;
  comment_github_id: string | number;
  thread_id: string;
  in_reply_to_id: string | number | null;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  diff_hunk: string | null;
  author_login: string;
  author_association: string | null;
  body: string;
  chunk_index: number;
  chunk_text: string;
  token_count: number;
  embedding: unknown;
  embedding_model: string | null;
  stale: boolean;
  github_created_at: string;
  github_updated_at: string | null;
  deleted: boolean;
  backfill_batch: string | null;
};

function rowToRecord(row: CommentRow): ReviewCommentRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    repo: row.repo,
    owner: row.owner,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    commentGithubId: Number(row.comment_github_id),
    threadId: row.thread_id,
    inReplyToId: row.in_reply_to_id != null ? Number(row.in_reply_to_id) : null,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    diffHunk: row.diff_hunk,
    authorLogin: row.author_login,
    authorAssociation: row.author_association,
    body: row.body,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    tokenCount: row.token_count,
    embedding: row.embedding,
    embeddingModel: row.embedding_model,
    stale: row.stale,
    githubCreatedAt: row.github_created_at,
    githubUpdatedAt: row.github_updated_at,
    deleted: row.deleted,
    backfillBatch: row.backfill_batch,
  };
}

/**
 * Create a review comment store backed by PostgreSQL with pgvector.
 * Follows the same factory pattern as createLearningMemoryStore.
 */
export function createReviewCommentStore(opts: {
  sql: Sql;
  logger: Logger;
}): ReviewCommentStore {
  const { sql, logger } = opts;

  const store: ReviewCommentStore = {
    async writeChunks(chunks: ReviewCommentChunk[]): Promise<void> {
      if (chunks.length === 0) return;

      for (const chunk of chunks) {
        try {
          await sql`
            INSERT INTO review_comments (
              repo, owner, pr_number, pr_title, comment_github_id,
              thread_id, in_reply_to_id, file_path, start_line, end_line,
              diff_hunk, author_login, author_association, body,
              chunk_index, chunk_text, token_count,
              github_created_at, github_updated_at, backfill_batch
            ) VALUES (
              ${chunk.repo}, ${chunk.owner}, ${chunk.prNumber}, ${chunk.prTitle ?? null}, ${chunk.commentGithubId},
              ${chunk.threadId}, ${chunk.inReplyToId ?? null}, ${chunk.filePath ?? null}, ${chunk.startLine ?? null}, ${chunk.endLine ?? null},
              ${chunk.diffHunk ?? null}, ${chunk.authorLogin}, ${chunk.authorAssociation ?? null}, ${chunk.body},
              ${chunk.chunkIndex}, ${chunk.chunkText}, ${chunk.tokenCount},
              ${chunk.githubCreatedAt}, ${chunk.githubUpdatedAt ?? null}, ${chunk.backfillBatch ?? null}
            )
            ON CONFLICT (repo, comment_github_id, chunk_index) DO NOTHING
          `;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(
            { err: message, repo: chunk.repo, commentGithubId: chunk.commentGithubId },
            "Failed to write review comment chunk",
          );
          throw err;
        }
      }
    },

    async softDelete(repo: string, commentGithubId: number): Promise<void> {
      await sql`
        UPDATE review_comments
        SET deleted = true
        WHERE repo = ${repo} AND comment_github_id = ${commentGithubId}
      `;
    },

    async updateChunks(chunks: ReviewCommentChunk[]): Promise<void> {
      if (chunks.length === 0) return;

      // All chunks should be for the same comment
      const { repo, commentGithubId } = chunks[0]!;

      await sql.begin(async (tx) => {
        // Delete existing chunks for this comment
        await tx`
          DELETE FROM review_comments
          WHERE repo = ${repo} AND comment_github_id = ${commentGithubId}
        `;

        // Insert new chunks
        for (const chunk of chunks) {
          await tx`
            INSERT INTO review_comments (
              repo, owner, pr_number, pr_title, comment_github_id,
              thread_id, in_reply_to_id, file_path, start_line, end_line,
              diff_hunk, author_login, author_association, body,
              chunk_index, chunk_text, token_count,
              github_created_at, github_updated_at, backfill_batch
            ) VALUES (
              ${chunk.repo}, ${chunk.owner}, ${chunk.prNumber}, ${chunk.prTitle ?? null}, ${chunk.commentGithubId},
              ${chunk.threadId}, ${chunk.inReplyToId ?? null}, ${chunk.filePath ?? null}, ${chunk.startLine ?? null}, ${chunk.endLine ?? null},
              ${chunk.diffHunk ?? null}, ${chunk.authorLogin}, ${chunk.authorAssociation ?? null}, ${chunk.body},
              ${chunk.chunkIndex}, ${chunk.chunkText}, ${chunk.tokenCount},
              ${chunk.githubCreatedAt}, ${chunk.githubUpdatedAt ?? null}, ${chunk.backfillBatch ?? null}
            )
          `;
        }
      });
    },

    async searchByEmbedding(params: {
      queryEmbedding: Float32Array;
      repo: string;
      topK: number;
    }): Promise<ReviewCommentSearchResult[]> {
      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);

      const rows = await sql`
        SELECT *,
          embedding <=> ${queryEmbeddingString}::vector AS distance
        FROM review_comments
        WHERE repo = ${params.repo}
          AND stale = false
          AND deleted = false
        ORDER BY embedding <=> ${queryEmbeddingString}::vector
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        record: rowToRecord(row as unknown as CommentRow),
        distance: Number((row as Record<string, unknown>).distance),
      }));
    },

    async getThreadComments(threadId: string): Promise<ReviewCommentRecord[]> {
      const rows = await sql`
        SELECT * FROM review_comments
        WHERE thread_id = ${threadId} AND deleted = false
        ORDER BY github_created_at, chunk_index
      `;
      return rows.map((row) => rowToRecord(row as unknown as CommentRow));
    },

    async getSyncState(repo: string): Promise<SyncState | null> {
      const rows = await sql`
        SELECT * FROM review_comment_sync_state WHERE repo = ${repo}
      `;
      if (rows.length === 0) return null;

      const row = rows[0]!;
      return {
        id: row.id as number,
        repo: row.repo as string,
        lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
        lastPageCursor: (row.last_page_cursor as string) ?? null,
        totalCommentsSynced: row.total_comments_synced as number,
        backfillComplete: row.backfill_complete as boolean,
        updatedAt: row.updated_at as string,
      };
    },

    async updateSyncState(state: SyncState): Promise<void> {
      await sql`
        INSERT INTO review_comment_sync_state (
          repo, last_synced_at, last_page_cursor,
          total_comments_synced, backfill_complete, updated_at
        ) VALUES (
          ${state.repo}, ${state.lastSyncedAt}, ${state.lastPageCursor},
          ${state.totalCommentsSynced}, ${state.backfillComplete}, now()
        )
        ON CONFLICT (repo) DO UPDATE SET
          last_synced_at = EXCLUDED.last_synced_at,
          last_page_cursor = EXCLUDED.last_page_cursor,
          total_comments_synced = EXCLUDED.total_comments_synced,
          backfill_complete = EXCLUDED.backfill_complete,
          updated_at = now()
      `;
    },

    async getLatestCommentDate(repo: string): Promise<Date | null> {
      const rows = await sql`
        SELECT MAX(github_created_at) AS latest
        FROM review_comments
        WHERE repo = ${repo} AND deleted = false
      `;
      if (rows.length === 0 || !rows[0]!.latest) return null;
      return new Date(rows[0]!.latest as string);
    },

    async countByRepo(repo: string): Promise<number> {
      const rows = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM review_comments
        WHERE repo = ${repo} AND deleted = false
      `;
      return rows[0]!.cnt as number;
    },
  };

  logger.debug("ReviewCommentStore initialized with pgvector HNSW index");
  return store;
}
