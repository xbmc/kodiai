import type { Logger } from "pino";
import type { WikiPageStore, WikiPageInput } from "./wiki-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import { chunkWikiPage } from "./wiki-chunker.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export type WikiSyncSchedulerOptions = {
  store: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  source: string;
  baseUrl?: string;
  intervalMs?: number;
  delayMs?: number;
  logger: Logger;
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
};

export type WikiSyncResult = {
  pagesChecked: number;
  pagesUpdated: number;
  pagesDeleted: number;
  durationMs: number;
};

// ── MediaWiki RecentChanges API types ───────────────────────────────────────

type RecentChangesResponse = {
  continue?: {
    rccontinue: string;
    continue: string;
  };
  query: {
    recentchanges: Array<{
      type: string;
      ns: number;
      title: string;
      pageid: number;
      revid: number;
      old_revid: number;
      timestamp: string;
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
  };
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// ── Sync engine ─────────────────────────────────────────────────────────────

/**
 * Run incremental wiki sync using MediaWiki RecentChanges API.
 *
 * 1. Gets last sync timestamp from store
 * 2. Queries RecentChanges for pages modified since then
 * 3. Re-fetches, re-chunks, and re-embeds each changed page
 * 4. Soft-deletes pages that became redirects/stubs
 * 5. Updates sync state timestamp
 */
async function runSync(opts: {
  store: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  source: string;
  baseUrl: string;
  delayMs: number;
  logger: Logger;
  fetchFn: typeof globalThis.fetch;
}): Promise<WikiSyncResult> {
  const { store, embeddingProvider, source, baseUrl, delayMs, logger, fetchFn } = opts;
  const startTime = Date.now();
  let pagesChecked = 0;
  let pagesUpdated = 0;
  let pagesDeleted = 0;

  // Get last sync timestamp
  const syncState = await store.getSyncState(source);
  const lastSyncedAt = syncState?.lastSyncedAt ?? null;

  // Build RecentChanges query
  let hasMore = true;
  let rccontinue: string | undefined;

  // Deduplicate page IDs across pagination (a page may appear multiple times in RC)
  const processedPageIds = new Set<number>();

  while (hasMore) {
    const params = new URLSearchParams({
      action: "query",
      list: "recentchanges",
      rcprop: "title|ids|timestamp|sizes",
      rclimit: "500",
      rctype: "edit|new|log",
      format: "json",
    });

    if (lastSyncedAt) {
      // rcend is the oldest timestamp to include (MediaWiki RC is reverse chronological)
      params.set("rcend", lastSyncedAt.toISOString());
    }
    if (rccontinue) {
      params.set("rccontinue", rccontinue);
    }

    let rcResponse: RecentChangesResponse;
    try {
      const response = await fetchFn(`${baseUrl}/w/api.php?${params.toString()}`);
      if (!response.ok) {
        logger.warn({ status: response.status }, "Wiki RecentChanges API request failed");
        break;
      }
      rcResponse = (await response.json()) as RecentChangesResponse;
    } catch (err) {
      logger.error({ err }, "Wiki RecentChanges API network error");
      break;
    }

    const changes = rcResponse.query.recentchanges;

    for (const change of changes) {
      // Skip already processed pages
      if (processedPageIds.has(change.pageid)) continue;
      processedPageIds.add(change.pageid);

      pagesChecked++;

      try {
        // Check if revision has changed
        const existingRevision = await store.getPageRevision(change.pageid);
        if (existingRevision === change.revid) {
          continue; // Already up to date
        }

        // Fetch current page content
        const parseParams = new URLSearchParams({
          action: "parse",
          pageid: String(change.pageid),
          prop: "text|revid",
          format: "json",
        });

        let parseData: ParseResponse;
        try {
          const parseResponse = await fetchFn(`${baseUrl}/w/api.php?${parseParams.toString()}`);
          if (!parseResponse.ok) {
            logger.warn(
              { pageId: change.pageid, status: parseResponse.status },
              "Wiki sync parse request failed, skipping page",
            );
            await sleep(delayMs);
            continue;
          }
          parseData = (await parseResponse.json()) as ParseResponse;
        } catch (err) {
          logger.warn({ pageId: change.pageid, err }, "Wiki sync parse network error, skipping page");
          await sleep(delayMs);
          continue;
        }

        const namespace = namespaceIdToName(change.ns);
        const pageTitle = parseData.parse.title;
        const pageUrl = `${baseUrl}/view/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

        const pageInput: WikiPageInput = {
          pageId: change.pageid,
          pageTitle,
          namespace,
          pageUrl,
          htmlContent: parseData.parse.text["*"],
          revisionId: parseData.parse.revid,
        };

        // Chunk the page
        const chunks = chunkWikiPage(pageInput);

        if (chunks.length === 0) {
          // Page became redirect, stub, or disambiguation -- soft-delete
          if (existingRevision !== null) {
            await store.softDeletePage(change.pageid);
            pagesDeleted++;
          }
        } else {
          // Embed each chunk
          for (const chunk of chunks) {
            try {
              const embedResult = await embeddingProvider.generate(chunk.chunkText, "document");
              if (embedResult) {
                chunk.embedding = embedResult.embedding;
              }
            } catch (err) {
              logger.warn(
                { pageId: change.pageid, chunkIndex: chunk.chunkIndex, err },
                "Wiki sync chunk embedding failed (fail-open)",
              );
            }
          }

          // Replace all chunks for this page
          await store.replacePageChunks(change.pageid, chunks);
          pagesUpdated++;
        }

        await sleep(delayMs);
      } catch (err) {
        logger.warn({ pageId: change.pageid, err }, "Wiki sync page processing failed, continuing");
      }
    }

    // Check for continuation
    if (rcResponse.continue) {
      rccontinue = rcResponse.continue.rccontinue;
      hasMore = true;
    } else {
      hasMore = false;
    }
  }

  // Update sync state with current timestamp
  await store.updateSyncState({
    source,
    lastSyncedAt: new Date(),
    lastContinueToken: null,
    totalPagesSynced: (syncState?.totalPagesSynced ?? 0) + pagesUpdated,
    backfillComplete: syncState?.backfillComplete ?? false,
  });

  const durationMs = Date.now() - startTime;

  logger.info(
    { pagesChecked, pagesUpdated, pagesDeleted, durationMs },
    "Wiki incremental sync complete",
  );

  return { pagesChecked, pagesUpdated, pagesDeleted, durationMs };
}

// ── Scheduler ───────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STARTUP_DELAY_MS = 60_000; // 60 seconds

/**
 * Create a scheduled wiki sync that runs on an interval.
 *
 * - start(): sets up interval, runs first sync after 60s startup delay
 * - stop(): clears the interval
 * - syncNow(): triggers sync immediately (for testing/CLI)
 */
export function createWikiSyncScheduler(opts: WikiSyncSchedulerOptions): {
  start: () => void;
  stop: () => void;
  syncNow: () => Promise<WikiSyncResult>;
} {
  const {
    store,
    embeddingProvider,
    source,
    logger,
    delayMs = 500,
  } = opts;
  const baseUrl = opts.baseUrl ?? "https://kodi.wiki";
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let startupHandle: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function doSync(): Promise<WikiSyncResult> {
    if (running) {
      logger.debug("Wiki sync already running, skipping");
      return { pagesChecked: 0, pagesUpdated: 0, pagesDeleted: 0, durationMs: 0 };
    }

    running = true;
    try {
      return await runSync({
        store,
        embeddingProvider,
        source,
        baseUrl,
        delayMs,
        logger,
        fetchFn,
      });
    } catch (err) {
      logger.warn({ err }, "Wiki scheduled sync failed (fail-open)");
      return { pagesChecked: 0, pagesUpdated: 0, pagesDeleted: 0, durationMs: 0 };
    } finally {
      running = false;
    }
  }

  return {
    start() {
      logger.info(
        { intervalMs, startupDelayMs: STARTUP_DELAY_MS, source },
        "Wiki sync scheduler starting",
      );

      // First sync after startup delay
      startupHandle = setTimeout(() => {
        void doSync();

        // Then schedule recurring syncs
        intervalHandle = setInterval(() => {
          void doSync();
        }, intervalMs);
      }, STARTUP_DELAY_MS);
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
      logger.info("Wiki sync scheduler stopped");
    },

    syncNow: doSync,
  };
}
