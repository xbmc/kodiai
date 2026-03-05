/**
 * CLI script for generating wiki update suggestions from PR evidence.
 *
 * Processes top N stale wiki pages (by popularity score) and generates
 * section-level rewrite suggestions grounded in actual code diffs.
 * Uses Phase 125's voice-preserving pipeline for style consistency.
 *
 * Usage:
 *   bun scripts/generate-wiki-updates.ts                    # Process top 20 pages
 *   bun scripts/generate-wiki-updates.ts --top-n 5          # Process top 5 pages
 *   bun scripts/generate-wiki-updates.ts --page-ids 123,456 # Specific pages
 *   bun scripts/generate-wiki-updates.ts --dry-run           # Generate but don't store
 *   bun scripts/generate-wiki-updates.ts --rate-limit 500    # 500ms between LLM calls
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   ANTHROPIC_API_KEY     - For LLM generation (or other provider keys)
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createWikiPageStore } from "../src/knowledge/wiki-store.ts";
import { createTaskRouter } from "../src/llm/task-router.ts";
import { createCostTracker } from "../src/llm/cost-tracker.ts";
import { createTelemetryStore } from "../src/telemetry/store.ts";
import { createUpdateGenerator } from "../src/knowledge/wiki-update-generator.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "top-n": { type: "string", default: "20" },
    "page-ids": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "rate-limit": { type: "string", default: "300" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/generate-wiki-updates.ts [options]

Options:
  --top-n <number>      Number of top pages to process (default: 20)
  --page-ids <ids>      Comma-separated page IDs to target (overrides --top-n)
  --dry-run             Generate suggestions but don't store in DB
  --rate-limit <ms>     Milliseconds between LLM calls (default: 300)
  --help                Show this help

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
  ANTHROPIC_API_KEY     Anthropic API key for LLM generation
  LOG_LEVEL             Logging level (default: info)
`);
  process.exit(0);
}

const topN = parseInt(values["top-n"]!, 10);
const dryRun = values["dry-run"]!;
const rateLimitMs = parseInt(values["rate-limit"]!, 10);
const pageIds = values["page-ids"]
  ?.split(",")
  .map(Number)
  .filter((n) => !isNaN(n));

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  logger.info(
    { topN, dryRun, rateLimitMs, pageIds: pageIds ?? "auto" },
    "Starting wiki update generation",
  );

  // Setup: DB client + migrations
  const db = createDbClient({ logger });
  await runMigrations(db.sql);

  // Setup: domain objects
  const wikiPageStore = createWikiPageStore({ sql: db.sql, logger });
  const taskRouter = createTaskRouter({ models: {} }, logger);
  const telemetryStore = createTelemetryStore({ sql: db.sql, logger });
  const costTracker = createCostTracker({ telemetryStore, logger });

  // Create generator
  const generator = createUpdateGenerator({
    sql: db.sql,
    wikiPageStore,
    taskRouter,
    costTracker,
    logger,
    githubOwner: "xbmc",
    githubRepo: "xbmc",
    rateLimitMs,
  });

  // Run
  const result = await generator.run({
    topN,
    dryRun,
    pageIds,
  });

  // Summary
  const durationSec = (result.durationMs / 1000).toFixed(1);
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Wiki Update Generation Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Pages processed:        ${result.pagesProcessed}
 Sections processed:     ${result.sectionsProcessed}
 Suggestions generated:  ${result.suggestionsGenerated}
 Suggestions dropped:    ${result.suggestionsDropped} (ungrounded)
 Voice mismatches:       ${result.voiceMismatches}
 Duration:               ${durationSec}s
 Mode:                   ${dryRun ? "dry-run" : "live"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  // Cleanup
  await db.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Wiki update generation failed");
    process.exit(1);
  });
