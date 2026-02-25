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

    close() {
      // No cleanup needed — sql connection is managed externally
    },
  };

  return store;
}
