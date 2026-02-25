import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  WikiPageChunk,
  WikiPageRecord,
  WikiPageSearchResult,
  WikiPageStore,
  WikiSyncState,
} from "./wiki-types.ts";

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

type WikiRow = {
  id: number;
  created_at: string;
  page_id: number;
  page_title: string;
  namespace: string;
  page_url: string;
  section_heading: string | null;
  section_anchor: string | null;
  section_level: number | null;
  chunk_index: number;
  chunk_text: string;
  raw_text: string;
  token_count: number;
  embedding: unknown;
  embedding_model: string | null;
  stale: boolean;
  last_modified: string | null;
  revision_id: number | null;
  deleted: boolean;
  language_tags: string[];
};

function rowToRecord(row: WikiRow): WikiPageRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    pageId: row.page_id,
    pageTitle: row.page_title,
    namespace: row.namespace,
    pageUrl: row.page_url,
    sectionHeading: row.section_heading,
    sectionAnchor: row.section_anchor,
    sectionLevel: row.section_level,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    rawText: row.raw_text,
    tokenCount: row.token_count,
    embedding: row.embedding,
    embeddingModel: row.embedding_model,
    stale: row.stale,
    lastModified: row.last_modified,
    revisionId: row.revision_id,
    deleted: row.deleted,
    languageTags: row.language_tags ?? [],
  };
}

/**
 * Create a wiki page store backed by PostgreSQL with pgvector.
 * Follows the same factory pattern as createReviewCommentStore.
 */
export function createWikiPageStore(opts: {
  sql: Sql;
  logger: Logger;
}): WikiPageStore {
  const { sql, logger } = opts;

  const store: WikiPageStore = {
    async writeChunks(chunks: WikiPageChunk[]): Promise<void> {
      if (chunks.length === 0) return;

      for (const chunk of chunks) {
        try {
          const embeddingValue = chunk.embedding ? float32ArrayToVectorString(chunk.embedding) : null;
          const embeddingModel = chunk.embedding ? "voyage-code-3" : null;
          const sectionAnchor = chunk.sectionAnchor ?? "";
          const languageTags = chunk.languageTags ?? ["general"];
          await sql`
            INSERT INTO wiki_pages (
              page_id, page_title, namespace, page_url,
              section_heading, section_anchor, section_level,
              chunk_index, chunk_text, raw_text, token_count,
              embedding, embedding_model, stale,
              last_modified, revision_id, language_tags
            ) VALUES (
              ${chunk.pageId}, ${chunk.pageTitle}, ${chunk.namespace}, ${chunk.pageUrl},
              ${chunk.sectionHeading ?? null}, ${sectionAnchor}, ${chunk.sectionLevel ?? null},
              ${chunk.chunkIndex}, ${chunk.chunkText}, ${chunk.rawText}, ${chunk.tokenCount},
              ${embeddingValue}::vector, ${embeddingModel}, ${chunk.embedding ? false : true},
              ${chunk.lastModified ?? null}, ${chunk.revisionId ?? null}, ${sql.array(languageTags)}
            )
            ON CONFLICT (page_id, COALESCE(section_anchor, ''), chunk_index) DO NOTHING
          `;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(
            { err: message, pageId: chunk.pageId, pageTitle: chunk.pageTitle },
            "Failed to write wiki page chunk",
          );
          throw err;
        }
      }
    },

    async deletePageChunks(pageId: number): Promise<void> {
      await sql`
        DELETE FROM wiki_pages WHERE page_id = ${pageId}
      `;
    },

    async replacePageChunks(pageId: number, chunks: WikiPageChunk[]): Promise<void> {
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM wiki_pages WHERE page_id = ${pageId}
        `;

        for (const chunk of chunks) {
          const embeddingValue = chunk.embedding ? float32ArrayToVectorString(chunk.embedding) : null;
          const embeddingModel = chunk.embedding ? "voyage-code-3" : null;
          const sectionAnchor = chunk.sectionAnchor ?? "";
          const languageTags = chunk.languageTags ?? ["general"];
          await tx`
            INSERT INTO wiki_pages (
              page_id, page_title, namespace, page_url,
              section_heading, section_anchor, section_level,
              chunk_index, chunk_text, raw_text, token_count,
              embedding, embedding_model, stale,
              last_modified, revision_id, language_tags
            ) VALUES (
              ${chunk.pageId}, ${chunk.pageTitle}, ${chunk.namespace}, ${chunk.pageUrl},
              ${chunk.sectionHeading ?? null}, ${sectionAnchor}, ${chunk.sectionLevel ?? null},
              ${chunk.chunkIndex}, ${chunk.chunkText}, ${chunk.rawText}, ${chunk.tokenCount},
              ${embeddingValue}::vector, ${embeddingModel}, ${chunk.embedding ? false : true},
              ${chunk.lastModified ?? null}, ${chunk.revisionId ?? null}, ${sql.array(languageTags)}
            )
          `;
        }
      });
    },

    async softDeletePage(pageId: number): Promise<void> {
      await sql`
        UPDATE wiki_pages SET deleted = true WHERE page_id = ${pageId}
      `;
    },

    async searchByEmbedding(params: {
      queryEmbedding: Float32Array;
      topK: number;
      namespace?: string;
    }): Promise<WikiPageSearchResult[]> {
      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);

      const rows = params.namespace
        ? await sql`
            SELECT *,
              embedding <=> ${queryEmbeddingString}::vector AS distance
            FROM wiki_pages
            WHERE namespace = ${params.namespace}
              AND stale = false
              AND deleted = false
              AND embedding IS NOT NULL
            ORDER BY embedding <=> ${queryEmbeddingString}::vector
            LIMIT ${params.topK}
          `
        : await sql`
            SELECT *,
              embedding <=> ${queryEmbeddingString}::vector AS distance
            FROM wiki_pages
            WHERE stale = false
              AND deleted = false
              AND embedding IS NOT NULL
            ORDER BY embedding <=> ${queryEmbeddingString}::vector
            LIMIT ${params.topK}
          `;

      return rows.map((row) => ({
        record: rowToRecord(row as unknown as WikiRow),
        distance: Number((row as Record<string, unknown>).distance),
      }));
    },

    async searchByFullText(params: {
      query: string;
      topK: number;
      namespace?: string;
    }): Promise<WikiPageSearchResult[]> {
      if (!params.query.trim()) return [];

      const rows = params.namespace
        ? await sql`
            SELECT *,
              ts_rank(search_tsv, plainto_tsquery('english', ${params.query})) AS rank
            FROM wiki_pages
            WHERE namespace = ${params.namespace}
              AND stale = false
              AND deleted = false
              AND search_tsv @@ plainto_tsquery('english', ${params.query})
            ORDER BY rank DESC
            LIMIT ${params.topK}
          `
        : await sql`
            SELECT *,
              ts_rank(search_tsv, plainto_tsquery('english', ${params.query})) AS rank
            FROM wiki_pages
            WHERE stale = false
              AND deleted = false
              AND search_tsv @@ plainto_tsquery('english', ${params.query})
            ORDER BY rank DESC
            LIMIT ${params.topK}
          `;

      return rows.map((row) => ({
        record: rowToRecord(row as unknown as WikiRow),
        distance: 1 - Number((row as Record<string, unknown>).rank),
      }));
    },

    async getPageChunks(pageId: number): Promise<WikiPageRecord[]> {
      const rows = await sql`
        SELECT * FROM wiki_pages
        WHERE page_id = ${pageId} AND deleted = false
        ORDER BY chunk_index
      `;
      return rows.map((row) => rowToRecord(row as unknown as WikiRow));
    },

    async getSyncState(source: string): Promise<WikiSyncState | null> {
      const rows = await sql`
        SELECT * FROM wiki_sync_state WHERE source = ${source}
      `;
      if (rows.length === 0) return null;

      const row = rows[0]!;
      return {
        id: row.id as number,
        source: row.source as string,
        lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
        lastContinueToken: (row.last_continue_token as string) ?? null,
        totalPagesSynced: row.total_pages_synced as number,
        backfillComplete: row.backfill_complete as boolean,
        updatedAt: row.updated_at as string,
      };
    },

    async updateSyncState(state: WikiSyncState): Promise<void> {
      await sql`
        INSERT INTO wiki_sync_state (
          source, last_synced_at, last_continue_token,
          total_pages_synced, backfill_complete, updated_at
        ) VALUES (
          ${state.source}, ${state.lastSyncedAt}, ${state.lastContinueToken},
          ${state.totalPagesSynced}, ${state.backfillComplete}, now()
        )
        ON CONFLICT (source) DO UPDATE SET
          last_synced_at = EXCLUDED.last_synced_at,
          last_continue_token = EXCLUDED.last_continue_token,
          total_pages_synced = EXCLUDED.total_pages_synced,
          backfill_complete = EXCLUDED.backfill_complete,
          updated_at = now()
      `;
    },

    async countBySource(): Promise<number> {
      const rows = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM wiki_pages
        WHERE deleted = false
      `;
      return rows[0]!.cnt as number;
    },

    async getPageRevision(pageId: number): Promise<number | null> {
      const rows = await sql`
        SELECT revision_id FROM wiki_pages
        WHERE page_id = ${pageId} AND deleted = false
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rows[0]!.revision_id as number | null;
    },
  };

  logger.debug("WikiPageStore initialized with pgvector HNSW index");
  return store;
}
