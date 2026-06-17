import type { Logger } from "pino";
import type { WikiPageStore, WikiPageInput } from "./wiki-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import { generateDocumentEmbeddingResultsBatch } from "./embedding-batch.ts";
import { chunkWikiPage } from "./wiki-chunker.ts";
import { buildWikiApiUrl, fetchWikiJsonWithRetry, withWikiRequestPolicy, type FetchFn } from "./wiki-fetch.ts";

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
  fetchFn?: FetchFn;
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
  parse?: {
    title?: string;
    pageid?: number;
    revid?: number;
    text?: {
      "*"?: string;
    };
  };
  error?: {
    code?: string;
    info?: string;
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
  fetchFn: FetchFn;
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
  let hadFailure = false;

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
      rcResponse = await fetchWikiJsonWithRetry<RecentChangesResponse>({
        fetchFn,
        url: buildWikiApiUrl(baseUrl, params),
        logger,
        context: { source, request: "recentchanges", continueToken: rccontinue ?? null },
      });
    } catch (err) {
      logger.error({ err }, "Wiki RecentChanges API network error");
      hadFailure = true;
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
          parseData = await fetchWikiJsonWithRetry<ParseResponse>({
            fetchFn,
            url: buildWikiApiUrl(baseUrl, parseParams),
            logger,
            context: { source, request: "parse", pageId: change.pageid },
          });
        } catch (err) {
          logger.warn({ pageId: change.pageid, err }, "Wiki sync parse network error, skipping page");
          hadFailure = true;
          await sleep(delayMs);
          continue;
        }

        const parseRecord = parseData && typeof parseData === "object" ? parseData : undefined;
        if (
          typeof parseRecord?.parse?.title !== "string"
          || typeof parseRecord?.parse?.revid !== "number"
          || typeof parseRecord?.parse?.text?.["*"] !== "string"
        ) {
          logger.warn(
            {
              pageId: change.pageid,
              reason: "malformed-parse-response",
              errorCode: parseRecord?.error?.code,
              errorInfo: parseRecord?.error?.info,
            },
            "Wiki sync parse response malformed, skipping page",
          );
          hadFailure = true;
          await sleep(delayMs);
          continue;
        }

        const namespace = namespaceIdToName(change.ns);
        const pageTitle = parseRecord.parse.title;
        const pageUrl = `${baseUrl}/view/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

        const pageInput: WikiPageInput = {
          pageId: change.pageid,
          pageTitle,
          namespace,
          pageUrl,
          htmlContent: parseRecord.parse.text["*"],
          revisionId: parseRecord.parse.revid,
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
          const embeddings = await generateDocumentEmbeddingResultsBatch({
            texts: chunks.map((chunk) => chunk.chunkText),
            embeddingProvider,
          });
          const embeddingFailures: Array<{ chunkIndex: number; err: unknown }> = [];
          for (const [index, embeddingResult] of embeddings.entries()) {
            const chunk = chunks[index]!;
            if (embeddingResult.status === "success") {
              chunk.embedding = embeddingResult.embedding;
              continue;
            }
            if (embeddingResult.status === "failed") {
              embeddingFailures.push({ chunkIndex: chunk.chunkIndex, err: embeddingResult.err });
            }
          }
          if (embeddingFailures.length > 0) {
            logger.warn(
              {
                pageId: change.pageid,
                failedChunkCount: embeddingFailures.length,
                failedChunkIndexes: embeddingFailures.slice(0, 5).map((failure) => failure.chunkIndex),
                firstError: embeddingFailures[0]?.err,
              },
              "Wiki sync chunk embeddings failed (fail-open)",
            );
          }

          // Replace all chunks for this page
          await store.replacePageChunks(change.pageid, chunks);
          pagesUpdated++;
        }

        await sleep(delayMs);
      } catch (err) {
        logger.warn({ pageId: change.pageid, err }, "Wiki sync page processing failed, continuing");
        hadFailure = true;
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

  if (!hadFailure) {
    await store.updateSyncState({
      source,
      lastSyncedAt: new Date(),
      lastContinueToken: null,
      totalPagesSynced: (syncState?.totalPagesSynced ?? 0) + pagesUpdated,
      backfillComplete: syncState?.backfillComplete ?? false,
    });
  } else {
    logger.warn({ source }, "Wiki incremental sync had failures; preserving previous sync checkpoint");
  }

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
  const fetchFn = withWikiRequestPolicy(opts.fetchFn ?? globalThis.fetch);

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
      if (startupHandle || intervalHandle) {
        logger.debug("Wiki sync scheduler already started, skipping duplicate start");
        return;
      }

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
