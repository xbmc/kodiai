/**
 * One-time backfill script for wiki page popularity scores.
 *
 * Usage: bun run src/knowledge/wiki-popularity-backfill.ts
 *
 * Creates the popularity scorer, calls runNow() to compute initial scores
 * for all wiki pages, then prints the top 10 pages by composite score.
 */

import pino from "pino";
import { createDbClient } from "../db/client.ts";
import { createWikiPageStore } from "./wiki-store.ts";
import { createWikiPopularityStore } from "./wiki-popularity-store.ts";
import { createWikiPopularityScorer } from "./wiki-popularity-scorer.ts";

// ── Setup ────────────────────────────────────────────────────────────────

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const WIKI_BASE_URL = process.env.WIKI_BASE_URL ?? "https://kodi.wiki";

async function main(): Promise<void> {
  logger.info("Starting wiki popularity backfill");

  // Create DB connection
  const db = createDbClient({ logger });

  try {
    // Create stores
    const wikiPageStore = createWikiPageStore({ sql: db.sql, logger });
    const popularityStore = createWikiPopularityStore({ sql: db.sql, logger });

    // Create scorer (no scheduler needed -- just using runNow)
    const scorer = createWikiPopularityScorer({
      sql: db.sql,
      logger,
      wikiPageStore,
      popularityStore,
      wikiBaseUrl: WIKI_BASE_URL,
    });

    // Run scoring
    logger.info({ wikiBaseUrl: WIKI_BASE_URL }, "Running popularity scoring");
    const result = await scorer.runNow();

    if (result.skipped) {
      logger.warn({ skipReason: result.skipReason }, "Scoring was skipped");
      return;
    }

    logger.info(
      {
        pagesScored: result.pagesScored,
        citationsAggregated: result.citationsAggregated,
        citationsCleaned: result.citationsCleaned,
        durationMs: result.durationMs,
      },
      "Popularity scoring complete",
    );

    // Print top 10 pages for manual verification
    const topPages = await popularityStore.getTopPages(10);

    if (topPages.length > 0) {
      console.log("\n--- Top 10 Pages by Composite Score ---\n");
      console.log(
        "Rank  Score     Links  Citations  Recency  Title",
      );
      console.log(
        "----  --------  -----  ---------  -------  -----",
      );

      for (let i = 0; i < topPages.length; i++) {
        const page = topPages[i]!;
        console.log(
          `${String(i + 1).padStart(4)}  ${page.compositeScore.toFixed(6)}  ${String(page.inboundLinks).padStart(5)}  ${String(page.citationCount).padStart(9)}  ${page.editRecencyScore.toFixed(5)}  ${page.pageTitle}`,
        );
      }

      console.log("");
    } else {
      logger.info("No popularity records found after scoring");
    }
  } catch (err) {
    logger.error({ err }, "Wiki popularity backfill failed");
    process.exit(1);
  } finally {
    await db.close();
    logger.info("Database connection closed");
  }
}

void main();
