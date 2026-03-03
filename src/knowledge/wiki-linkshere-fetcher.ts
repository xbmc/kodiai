/**
 * MediaWiki linkshere API client with batching, pagination, and rate limiting.
 *
 * Fetches inbound link counts for wiki pages using the MediaWiki Action API
 * prop=linkshere endpoint. Follows the same API fetching pattern as wiki-sync.ts.
 */

import type { Logger } from "pino";
import {
  LINKSHERE_BATCH_SIZE,
  LINKSHERE_RATE_LIMIT_MS,
  LINKSHERE_MAX_PER_PAGE,
  LINKSHERE_NAMESPACE,
} from "./wiki-popularity-config.ts";

// ── MediaWiki API response types ─────────────────────────────────────────

type LinksherePage = {
  pageid: number;
  ns: number;
  title: string;
};

type LinkshereContinue = {
  lhcontinue?: string;
  continue?: string;
};

type LinksHereResponse = {
  continue?: LinkshereContinue;
  query: {
    pages: Record<
      string,
      {
        pageid: number;
        title: string;
        linkshere?: LinksherePage[];
      }
    >;
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Linkshere fetcher ────────────────────────────────────────────────────

/**
 * Fetch inbound link counts for all given page IDs using the MediaWiki
 * linkshere API with batching, pagination, and rate limiting.
 *
 * - Batches pageIds into groups of LINKSHERE_BATCH_SIZE (50) per request
 * - Paginates via lhcontinue until complete
 * - Caps per-page accumulation at LINKSHERE_MAX_PER_PAGE (5000)
 * - Delays LINKSHERE_RATE_LIMIT_MS (500ms) between batch requests
 * - Fail-open: if a batch fails, logs warning and continues
 */
export async function fetchAllLinkshereCounts(opts: {
  baseUrl: string;
  pageIds: number[];
  fetchFn?: typeof globalThis.fetch;
  logger: Logger;
}): Promise<Map<number, number>> {
  const { baseUrl, pageIds, logger } = opts;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const counts = new Map<number, number>();

  if (pageIds.length === 0) return counts;

  // Initialize all page IDs with 0 counts
  for (const id of pageIds) {
    counts.set(id, 0);
  }

  // Batch pageIds into groups
  const batches: number[][] = [];
  for (let i = 0; i < pageIds.length; i += LINKSHERE_BATCH_SIZE) {
    batches.push(pageIds.slice(i, i + LINKSHERE_BATCH_SIZE));
  }

  logger.info(
    { totalPages: pageIds.length, batchCount: batches.length },
    "Fetching linkshere counts",
  );

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!;

    try {
      await fetchBatchLinkshere({
        baseUrl,
        pageIds: batch,
        fetchFn,
        counts,
        logger,
      });
    } catch (err) {
      // Fail-open: log and continue with remaining batches
      logger.warn(
        { err, batchIdx, batchSize: batch.length },
        "Linkshere batch failed, continuing with remaining batches",
      );
    }

    // Rate limit between batch requests (skip after last batch)
    if (batchIdx < batches.length - 1) {
      await sleep(LINKSHERE_RATE_LIMIT_MS);
    }
  }

  logger.info(
    { totalPages: pageIds.length, pagesWithLinks: [...counts.values()].filter((v) => v > 0).length },
    "Linkshere counts fetch complete",
  );

  return counts;
}

/**
 * Fetch linkshere for a single batch of page IDs, handling pagination.
 */
async function fetchBatchLinkshere(opts: {
  baseUrl: string;
  pageIds: number[];
  fetchFn: typeof globalThis.fetch;
  counts: Map<number, number>;
  logger: Logger;
}): Promise<void> {
  const { baseUrl, pageIds, fetchFn, counts, logger } = opts;

  let lhcontinue: string | undefined;
  let hasMore = true;

  // Track per-page accumulation to enforce cap
  const pageCapped = new Set<number>();

  while (hasMore) {
    const params = new URLSearchParams({
      action: "query",
      prop: "linkshere",
      pageids: pageIds.join("|"),
      lhprop: "pageid",
      lhlimit: "500",
      lhnamespace: String(LINKSHERE_NAMESPACE),
      format: "json",
    });

    if (lhcontinue) {
      params.set("lhcontinue", lhcontinue);
    }

    const url = `${baseUrl}/w/api.php?${params.toString()}`;
    const response = await fetchFn(url);

    if (!response.ok) {
      throw new Error(`Linkshere API returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as LinksHereResponse;

    // Accumulate counts from response
    for (const [pageIdStr, pageData] of Object.entries(data.query.pages)) {
      const pageId = Number(pageIdStr);
      if (pageCapped.has(pageId)) continue;

      const links = pageData.linkshere ?? [];
      const currentCount = counts.get(pageId) ?? 0;
      const newCount = currentCount + links.length;

      if (newCount >= LINKSHERE_MAX_PER_PAGE) {
        counts.set(pageId, LINKSHERE_MAX_PER_PAGE);
        pageCapped.add(pageId);
        logger.debug(
          { pageId, title: pageData.title },
          "Linkshere count capped at maximum",
        );
      } else {
        counts.set(pageId, newCount);
      }
    }

    // Check pagination
    if (data.continue?.lhcontinue) {
      lhcontinue = data.continue.lhcontinue;
      hasMore = true;
      await sleep(LINKSHERE_RATE_LIMIT_MS);
    } else {
      hasMore = false;
    }
  }
}
