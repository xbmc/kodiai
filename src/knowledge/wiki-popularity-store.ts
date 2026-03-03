import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";

export type PopularityRecord = {
  id: number;
  pageId: number;
  pageTitle: string;
  inboundLinks: number;
  citationCount: number;
  editRecencyScore: number;
  compositeScore: number;
  lastScoredAt: string | null;
  lastLinkshereFetch: string | null;
  lastCitationReset: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PopularityUpsert = {
  pageId: number;
  pageTitle: string;
  inboundLinks: number;
  citationCount: number;
  editRecencyScore: number;
  compositeScore: number;
};

type PopularityRow = {
  id: number;
  page_id: number;
  page_title: string;
  inbound_links: number;
  citation_count: number;
  edit_recency_score: number;
  composite_score: number;
  last_scored_at: string | null;
  last_linkshere_fetch: string | null;
  last_citation_reset: string | null;
  created_at: string;
  updated_at: string;
};

function rowToRecord(row: PopularityRow): PopularityRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    inboundLinks: row.inbound_links,
    citationCount: row.citation_count,
    editRecencyScore: row.edit_recency_score,
    compositeScore: row.composite_score,
    lastScoredAt: row.last_scored_at,
    lastLinkshereFetch: row.last_linkshere_fetch,
    lastCitationReset: row.last_citation_reset,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a wiki popularity store backed by PostgreSQL.
 * Follows the same factory pattern as createWikiPageStore.
 */
export function createWikiPopularityStore(opts: {
  sql: Sql;
  logger: Logger;
}): {
  logCitations(pageIds: number[]): Promise<void>;
  getCitationCounts(windowDays: number): Promise<Map<number, number>>;
  cleanupOldCitations(windowDays: number): Promise<number>;
  upsertPopularity(records: PopularityUpsert[]): Promise<void>;
  getTopPages(limit: number): Promise<PopularityRecord[]>;
  getAll(): Promise<PopularityRecord[]>;
} {
  const { sql, logger } = opts;

  return {
    /**
     * Log citation events for wiki pages that appeared in retrieval results.
     * Batch INSERT one row per page_id with cited_at = now().
     */
    async logCitations(pageIds: number[]): Promise<void> {
      if (pageIds.length === 0) return;

      // Deduplicate page_ids within a single retrieval call
      const unique = [...new Set(pageIds)];

      await sql`
        INSERT INTO wiki_citation_events (page_id)
        SELECT unnest(${sql.array(unique)}::integer[])
      `;

      logger.debug({ count: unique.length }, "Logged wiki citation events");
    },

    /**
     * Get citation counts per page_id within a rolling window.
     */
    async getCitationCounts(
      windowDays: number,
    ): Promise<Map<number, number>> {
      const rows = await sql`
        SELECT page_id, COUNT(*)::int AS cnt
        FROM wiki_citation_events
        WHERE cited_at > now() - ${windowDays + " days"}::interval
        GROUP BY page_id
      `;

      const counts = new Map<number, number>();
      for (const row of rows) {
        counts.set(row.page_id as number, row.cnt as number);
      }
      return counts;
    },

    /**
     * Delete citation events older than the rolling window.
     * Returns number of deleted rows.
     */
    async cleanupOldCitations(windowDays: number): Promise<number> {
      const result = await sql`
        DELETE FROM wiki_citation_events
        WHERE cited_at < now() - ${windowDays + " days"}::interval
      `;
      const deleted = result.count;
      if (deleted > 0) {
        logger.info({ deleted }, "Cleaned up old wiki citation events");
      }
      return deleted;
    },

    /**
     * Bulk upsert popularity records using ON CONFLICT (page_id) DO UPDATE.
     */
    async upsertPopularity(records: PopularityUpsert[]): Promise<void> {
      if (records.length === 0) return;

      // Process in batches to avoid overly large queries
      const BATCH_SIZE = 100;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        const values = batch.map((r) => ({
          page_id: r.pageId,
          page_title: r.pageTitle,
          inbound_links: r.inboundLinks,
          citation_count: r.citationCount,
          edit_recency_score: r.editRecencyScore,
          composite_score: r.compositeScore,
          last_scored_at: sql`now()`,
          updated_at: sql`now()`,
        }));

        await sql`
          INSERT INTO wiki_page_popularity ${sql(values, "page_id", "page_title", "inbound_links", "citation_count", "edit_recency_score", "composite_score", "last_scored_at", "updated_at")}
          ON CONFLICT (page_id) DO UPDATE SET
            page_title = EXCLUDED.page_title,
            inbound_links = EXCLUDED.inbound_links,
            citation_count = EXCLUDED.citation_count,
            edit_recency_score = EXCLUDED.edit_recency_score,
            composite_score = EXCLUDED.composite_score,
            last_scored_at = EXCLUDED.last_scored_at,
            updated_at = EXCLUDED.updated_at
        `;
      }

      logger.debug({ count: records.length }, "Upserted wiki popularity records");
    },

    /**
     * Get top-N pages ordered by composite_score DESC.
     */
    async getTopPages(limit: number): Promise<PopularityRecord[]> {
      const rows = await sql`
        SELECT * FROM wiki_page_popularity
        ORDER BY composite_score DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => rowToRecord(row as unknown as PopularityRow));
    },

    /**
     * Get all popularity records ordered by composite_score DESC.
     */
    async getAll(): Promise<PopularityRecord[]> {
      const rows = await sql`
        SELECT * FROM wiki_page_popularity
        ORDER BY composite_score DESC
      `;
      return rows.map((row) => rowToRecord(row as unknown as PopularityRow));
    },
  };
}
