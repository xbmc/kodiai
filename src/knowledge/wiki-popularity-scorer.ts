/**
 * Composite popularity scorer with scheduled refresh.
 *
 * Combines three signals per wiki page:
 * 1. Inbound links (from MediaWiki linkshere API)
 * 2. Citation frequency (from rolling-window citation event log)
 * 3. Edit recency (exponential decay from last_modified timestamp)
 *
 * Follows the createWikiStalenessDetector scheduler pattern:
 * start() / stop() / runNow() with startup delay + recurring interval.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { WikiPageStore } from "./wiki-types.ts";
import { createWikiPopularityStore, type PopularityUpsert } from "./wiki-popularity-store.ts";
import {
  CITATION_WINDOW_DAYS,
  computeCompositeScore,
} from "./wiki-popularity-config.ts";
import { fetchAllLinkshereCounts } from "./wiki-linkshere-fetcher.ts";

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_STARTUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// ── Types ────────────────────────────────────────────────────────────────

export type WikiPopularityScorerOptions = {
  sql: Sql;
  logger: Logger;
  wikiPageStore: WikiPageStore;
  popularityStore: ReturnType<typeof createWikiPopularityStore>;
  wikiBaseUrl: string;
  fetchFn?: typeof globalThis.fetch;
  intervalMs?: number;
  startupDelayMs?: number;
};

export type WikiPopularityScoringResult = {
  pagesScored: number;
  citationsAggregated: number;
  citationsCleaned: number;
  durationMs: number;
  skipped: boolean;
  skipReason?: string;
};

// ── Distinct page query ──────────────────────────────────────────────────

type DistinctPage = {
  page_id: number;
  title: string;
  last_modified: string | null;
};

/**
 * Get distinct wiki pages with their title and last_modified.
 * The wiki_pages table has multiple rows per page_id (one per chunk),
 * so we use DISTINCT ON to get one row per page.
 */
async function getDistinctPages(sql: Sql): Promise<DistinctPage[]> {
  const rows = await sql`
    SELECT DISTINCT ON (page_id)
      page_id,
      page_title AS title,
      last_modified
    FROM wiki_pages
    WHERE deleted = false
    ORDER BY page_id, chunk_index ASC
  `;
  return rows as unknown as DistinctPage[];
}

// ── Scoring logic ────────────────────────────────────────────────────────

async function runScoring(
  opts: WikiPopularityScorerOptions,
  logger: Logger,
): Promise<WikiPopularityScoringResult> {
  const startTime = Date.now();

  // 1. Get all distinct wiki pages
  const pages = await getDistinctPages(opts.sql);

  if (pages.length === 0) {
    logger.info("Popularity scoring skipped: no wiki pages in store");
    return {
      pagesScored: 0,
      citationsAggregated: 0,
      citationsCleaned: 0,
      durationMs: Date.now() - startTime,
      skipped: true,
      skipReason: "no_wiki_pages",
    };
  }

  const pageIds = pages.map((p) => p.page_id);

  // 2. Fetch inbound link counts via linkshere API
  const linkCounts = await fetchAllLinkshereCounts({
    baseUrl: opts.wikiBaseUrl,
    pageIds,
    fetchFn: opts.fetchFn,
    logger,
  });

  // 3. Get citation counts from rolling window
  const citationCounts = await opts.popularityStore.getCitationCounts(CITATION_WINDOW_DAYS);
  const citationsAggregated = citationCounts.size;

  // 4. Clean up old citations
  const citationsCleaned = await opts.popularityStore.cleanupOldCitations(CITATION_WINDOW_DAYS);

  // 5. Compute normalization bounds
  const allLinkValues = pages.map((p) => linkCounts.get(p.page_id) ?? 0);
  const allCitationValues = pages.map((p) => citationCounts.get(p.page_id) ?? 0);

  const normalization = {
    maxInboundLinks: Math.max(...allLinkValues),
    minInboundLinks: Math.min(...allLinkValues),
    maxCitationCount: Math.max(...allCitationValues),
    minCitationCount: Math.min(...allCitationValues),
  };

  // 6. Compute composite score for each page
  const now = Date.now();
  const records: PopularityUpsert[] = [];

  for (const page of pages) {
    const inboundLinks = linkCounts.get(page.page_id) ?? 0;
    const citationCount = citationCounts.get(page.page_id) ?? 0;

    // Compute days since last edit
    const lastModifiedMs = page.last_modified
      ? new Date(page.last_modified).getTime()
      : 0;
    const daysSinceEdit = lastModifiedMs > 0
      ? (now - lastModifiedMs) / (1000 * 60 * 60 * 24)
      : 365; // Default to 1 year if no last_modified

    const { editRecencyScore, compositeScore } = computeCompositeScore({
      inboundLinks,
      citationCount,
      daysSinceEdit,
      normalization,
    });

    records.push({
      pageId: page.page_id,
      pageTitle: page.title,
      inboundLinks,
      citationCount,
      editRecencyScore,
      compositeScore,
    });
  }

  // 7. Upsert all results
  await opts.popularityStore.upsertPopularity(records);

  const durationMs = Date.now() - startTime;

  logger.info(
    {
      pagesScored: records.length,
      citationsAggregated,
      citationsCleaned,
      citationWindowDays: CITATION_WINDOW_DAYS,
      durationMs,
    },
    "Wiki popularity scoring complete",
  );

  return {
    pagesScored: records.length,
    citationsAggregated,
    citationsCleaned,
    durationMs,
    skipped: false,
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a wiki popularity scorer with start/stop/runNow scheduler.
 *
 * Follows the createWikiStalenessDetector pattern:
 * - start(): setTimeout for startup delay, then setInterval for recurring
 * - stop(): clearTimeout + clearInterval
 * - runNow(): immediate scoring with running guard
 *
 * Default interval: 7 days (weekly)
 * Default startup delay: 5 minutes
 */
export function createWikiPopularityScorer(
  opts: WikiPopularityScorerOptions,
): { start(): void; stop(): void; runNow(): Promise<WikiPopularityScoringResult> } {
  const logger = opts.logger.child({ module: "wiki-popularity-scorer" });

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let startupHandle: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function doScore(): Promise<WikiPopularityScoringResult> {
    if (running) {
      logger.debug("Wiki popularity scoring already running, skipping");
      return {
        pagesScored: 0,
        citationsAggregated: 0,
        citationsCleaned: 0,
        durationMs: 0,
        skipped: true,
        skipReason: "already_running",
      };
    }

    running = true;
    try {
      return await runScoring(opts, logger);
    } catch (err) {
      logger.error({ err }, "Wiki popularity scoring failed");
      return {
        pagesScored: 0,
        citationsAggregated: 0,
        citationsCleaned: 0,
        durationMs: 0,
        skipped: true,
        skipReason: `error: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      running = false;
    }
  }

  return {
    start() {
      const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
      const delayMs = opts.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
      logger.info({ intervalMs, startupDelayMs: delayMs }, "Wiki popularity scorer starting");

      startupHandle = setTimeout(() => {
        void doScore().catch((err) =>
          logger.error({ err }, "Initial wiki popularity scoring failed"),
        );
        intervalHandle = setInterval(() => {
          void doScore().catch((err) =>
            logger.error({ err }, "Scheduled wiki popularity scoring failed"),
          );
        }, intervalMs);
      }, delayMs);
    },

    stop() {
      if (startupHandle) {
        clearTimeout(startupHandle);
        startupHandle = null;
      }
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      logger.info("Wiki popularity scorer stopped");
    },

    runNow: doScore,
  };
}
