import type { Logger } from "pino";
import type { WikiPageStore, WikiPageInput } from "./wiki-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import { chunkWikiPage } from "./wiki-chunker.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export type WikiBackfillResult = {
  totalPages: number;
  totalChunks: number;
  totalEmbeddings: number;
  skippedPages: number;
  durationMs: number;
  resumed: boolean;
};

export type WikiBackfillOptions = {
  store: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  source: string;
  baseUrl?: string;
  namespaces?: string[];
  logger: Logger;
  dryRun?: boolean;
  delayMs?: number;
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
};

// ── MediaWiki API types ─────────────────────────────────────────────────────

type AllPagesResponse = {
  continue?: {
    apcontinue: string;
    continue: string;
  };
  query: {
    allpages: Array<{
      pageid: number;
      ns: number;
      title: string;
    }>;
  };
};

type ParseResponse = {
  parse: {
    title: string;
    pageid: number;
    revid: number;
    text: {
      "*": string;
    };
    displaytitle?: string;
    categories?: Array<{
      "*": string;
      sortkey?: string;
      hidden?: string;
    }>;
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Namespace ID to name mapping for MediaWiki.
 * See: https://www.mediawiki.org/wiki/Help:Namespaces
 */
function namespaceIdToName(nsId: number): string {
  const map: Record<number, string> = {
    0: "Main",
    1: "Talk",
    2: "User",
    3: "User talk",
    4: "Project",
    5: "Project talk",
    6: "File",
    7: "File talk",
    8: "MediaWiki",
    10: "Template",
    12: "Help",
    14: "Category",
  };
  return map[nsId] ?? `NS${nsId}`;
}

// ── Backfill engine ──────────────────────────────────────────────────────────

/**
 * Fetch all wiki pages from a MediaWiki instance, chunk, embed, and store.
 *
 * Uses MediaWiki Action API:
 * - action=query&list=allpages for page enumeration
 * - action=parse for page content (rendered HTML)
 *
 * Supports resume via sync state and configurable rate limiting.
 */
export async function backfillWikiPages(
  opts: WikiBackfillOptions,
): Promise<WikiBackfillResult> {
  const {
    store,
    embeddingProvider,
    source,
    logger,
    dryRun = false,
    delayMs = 500,
  } = opts;
  const baseUrl = opts.baseUrl ?? "https://kodi.wiki";
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  const startTime = Date.now();
  let totalPages = 0;
  let totalChunks = 0;
  let totalEmbeddings = 0;
  let skippedPages = 0;
  let resumed = false;

  // Check sync state for resume
  const syncState = await store.getSyncState(source);
  if (syncState?.backfillComplete) {
    logger.info({ source }, "Wiki backfill already complete, skipping");
    return {
      totalPages: 0,
      totalChunks: 0,
      totalEmbeddings: 0,
      skippedPages: 0,
      durationMs: Date.now() - startTime,
      resumed: false,
    };
  }

  let continueToken = syncState?.lastContinueToken ?? undefined;
  if (continueToken) {
    resumed = true;
    logger.info({ source, continueToken }, "Resuming wiki backfill from last position");
  }

  // Enumerate all pages via allpages API
  let hasMore = true;

  while (hasMore) {
    // Build URL for allpages query
    const params = new URLSearchParams({
      action: "query",
      list: "allpages",
      aplimit: "50",
      format: "json",
    });
    if (continueToken) {
      params.set("apcontinue", continueToken);
    }

    let pageListResponse: AllPagesResponse;
    try {
      const response = await fetchFn(`${baseUrl}/w/api.php?${params.toString()}`);
      if (!response.ok) {
        logger.warn({ status: response.status, url: response.url }, "Wiki API allpages request failed");
        // Retry once with backoff
        await sleep(2000);
        const retryResponse = await fetchFn(`${baseUrl}/w/api.php?${params.toString()}`);
        if (!retryResponse.ok) {
          logger.error({ status: retryResponse.status }, "Wiki API allpages request failed after retry, stopping");
          break;
        }
        pageListResponse = await retryResponse.json() as AllPagesResponse;
      } else {
        pageListResponse = await response.json() as AllPagesResponse;
      }
    } catch (err) {
      logger.error({ err }, "Wiki API allpages network error, stopping");
      break;
    }

    const pages = pageListResponse.query.allpages;

    for (const pageInfo of pages) {
      try {
        // Check if page already exists with same revision
        const existingRevision = await store.getPageRevision(pageInfo.pageid);

        // Fetch page content via parse API
        const parseParams = new URLSearchParams({
          action: "parse",
          pageid: String(pageInfo.pageid),
          prop: "text|revid|displaytitle|categories",
          format: "json",
        });

        let parseData: ParseResponse;
        try {
          const parseResponse = await fetchFn(`${baseUrl}/w/api.php?${parseParams.toString()}`);
          if (!parseResponse.ok) {
            logger.warn({ pageId: pageInfo.pageid, status: parseResponse.status }, "Wiki parse request failed, skipping page");
            skippedPages++;
            await sleep(delayMs);
            continue;
          }
          parseData = await parseResponse.json() as ParseResponse;
        } catch (err) {
          logger.warn({ pageId: pageInfo.pageid, err }, "Wiki parse network error, skipping page");
          skippedPages++;
          await sleep(delayMs);
          continue;
        }

        const revisionId = parseData.parse.revid;

        // Skip if revision matches (already ingested)
        if (existingRevision === revisionId) {
          await sleep(delayMs);
          continue;
        }

        const namespace = namespaceIdToName(pageInfo.ns);
        const pageTitle = parseData.parse.title;
        const pageUrl = `${baseUrl}/view/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

        const pageInput: WikiPageInput = {
          pageId: pageInfo.pageid,
          pageTitle,
          namespace,
          pageUrl,
          htmlContent: parseData.parse.text["*"],
          revisionId,
        };

        // Chunk the page
        const chunks = chunkWikiPage(pageInput);

        if (chunks.length === 0) {
          skippedPages++;
          totalPages++;
          await sleep(delayMs);
          continue;
        }

        // Embed each chunk
        let embeddingsGenerated = 0;
        for (const chunk of chunks) {
          try {
            const embedResult = await embeddingProvider.generate(chunk.chunkText, "document");
            if (embedResult) {
              chunk.embedding = embedResult.embedding;
              embeddingsGenerated++;
            }
          } catch (err) {
            logger.warn({ pageId: pageInfo.pageid, chunkIndex: chunk.chunkIndex, err }, "Wiki chunk embedding failed (fail-open)");
          }
        }

        // Store chunks
        if (!dryRun) {
          await store.replacePageChunks(pageInfo.pageid, chunks);
        }

        totalPages++;
        totalChunks += chunks.length;
        totalEmbeddings += embeddingsGenerated;

        // Log progress every 50 pages
        if (totalPages % 50 === 0) {
          logger.info(
            { totalPages, totalChunks, skippedPages, totalEmbeddings },
            "Wiki backfill progress",
          );
        }

        // Update sync state every 10 pages
        if (!dryRun && totalPages % 10 === 0) {
          await store.updateSyncState({
            source,
            lastSyncedAt: new Date(),
            lastContinueToken: continueToken ?? null,
            totalPagesSynced: (syncState?.totalPagesSynced ?? 0) + totalPages,
            backfillComplete: false,
          });
        }
      } catch (err) {
        logger.warn({ pageId: pageInfo.pageid, err }, "Wiki page processing failed, continuing");
        skippedPages++;
      }

      await sleep(delayMs);
    }

    // Check for continuation
    if (pageListResponse.continue) {
      continueToken = pageListResponse.continue.apcontinue;
      hasMore = true;
    } else {
      hasMore = false;
    }
  }

  // Mark backfill complete
  if (!dryRun) {
    await store.updateSyncState({
      source,
      lastSyncedAt: new Date(),
      lastContinueToken: null,
      totalPagesSynced: (syncState?.totalPagesSynced ?? 0) + totalPages,
      backfillComplete: true,
    });
  }

  const durationMs = Date.now() - startTime;

  logger.info(
    { totalPages, totalChunks, totalEmbeddings, skippedPages, durationMs, resumed },
    "Wiki backfill complete",
  );

  return {
    totalPages,
    totalChunks,
    totalEmbeddings,
    skippedPages,
    durationMs,
    resumed,
  };
}
