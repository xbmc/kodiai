/**
 * CLI entry point for backfilling wiki pages from MediaWiki API.
 *
 * Usage:
 *   bun scripts/backfill-wiki.ts                              # Full backfill from kodi.wiki
 *   bun scripts/backfill-wiki.ts --source kodi.wiki           # Explicit source
 *   bun scripts/backfill-wiki.ts --base-url https://kodi.wiki # Custom base URL
 *   bun scripts/backfill-wiki.ts --namespace Main             # Only Main namespace
 *   bun scripts/backfill-wiki.ts --delay 1000                 # 1s delay between requests
 *   bun scripts/backfill-wiki.ts --dry-run                    # Fetch and log, don't store
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   VOYAGE_API_KEY        - VoyageAI API key (optional, embeddings disabled without it)
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createWikiPageStore } from "../src/knowledge/wiki-store.ts";
import { createEmbeddingProvider, createNoOpEmbeddingProvider } from "../src/knowledge/embeddings.ts";
import { backfillWikiPages } from "../src/knowledge/wiki-backfill.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    source: { type: "string", default: "kodi.wiki" },
    "base-url": { type: "string", default: "https://kodi.wiki" },
    namespace: { type: "string", multiple: true },
    delay: { type: "string", default: "500" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/backfill-wiki.ts [options]

Options:
  --source <name>       Wiki source identifier (default: kodi.wiki)
  --base-url <url>      MediaWiki base URL (default: https://kodi.wiki)
  --namespace <name>    Filter to specific namespace (can be repeated)
  --delay <ms>          Delay between API requests in ms (default: 500)
  --dry-run             Fetch and log but don't store
  --help                Show this help

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
  VOYAGE_API_KEY        VoyageAI API key (optional)
`);
  process.exit(0);
}

const source = values.source!;
const baseUrl = values["base-url"]!;
const namespaces = values.namespace ?? [];
const delayMs = parseInt(values.delay!, 10);
const dryRun = values["dry-run"]!;

// ── Validate environment ────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Source:     ${source}`);
  console.log(`Base URL:   ${baseUrl}`);
  if (namespaces.length > 0) console.log(`Namespaces: ${namespaces.join(", ")}`);
  console.log(`Delay:      ${delayMs}ms`);
  if (dryRun) console.log("DRY RUN: No data will be written.");
  console.log();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createDbClient({ logger });
  await runMigrations(db.sql);
  const store = createWikiPageStore({ sql: db.sql, logger });

  // ── Embeddings ────────────────────────────────────────────────────────────
  const voyageApiKey = process.env.VOYAGE_API_KEY;
  const embeddingProvider = voyageApiKey
    ? createEmbeddingProvider({
        apiKey: voyageApiKey,
        model: "voyage-code-3",
        dimensions: 1024,
        logger,
      })
    : createNoOpEmbeddingProvider(logger);

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const result = await backfillWikiPages({
      store,
      embeddingProvider,
      source,
      baseUrl,
      namespaces: namespaces.length > 0 ? namespaces : undefined,
      logger,
      dryRun,
      delayMs,
    });

    console.log();
    console.log("Wiki backfill complete.");
    console.log(`  Total pages:      ${result.totalPages}`);
    console.log(`  Total chunks:     ${result.totalChunks}`);
    console.log(`  Total embeddings: ${result.totalEmbeddings}`);
    console.log(`  Skipped pages:    ${result.skippedPages}`);
    console.log(`  Duration:         ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Resumed:          ${result.resumed}`);
  } finally {
    await db.close();
  }
}

await main();
