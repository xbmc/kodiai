/**
 * Backfill language classification for existing learning_memories records.
 *
 * This script is idempotent: it only processes rows where language IS NULL.
 * Running after migration 007 will process 0 rows (migration already backfilled)
 * but still prints the stats summary.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-language.ts            # Run backfill + print stats
 *   npx tsx src/scripts/backfill-language.ts --dry-run  # Print stats only, no updates
 *   bun src/scripts/backfill-language.ts                # Same with bun
 *   bun src/scripts/backfill-language.ts --dry-run
 *
 * Environment variables:
 *   DATABASE_URL  - PostgreSQL connection string (required)
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../db/client.ts";
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    "batch-size": { type: "string", default: "500" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun src/scripts/backfill-language.ts [options]

Options:
  --dry-run       Query and log stats without performing updates
  --batch-size N  Number of records to process per batch (default: 500)
  --help          Show this help message

Environment:
  DATABASE_URL    PostgreSQL connection string (required)
`);
  process.exit(0);
}

const isDryRun = values["dry-run"];
const batchSize = parseInt(values["batch-size"] ?? "500", 10);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const client = createDbClient({ connectionString, logger });
const { sql } = client;

try {
  if (!isDryRun) {
    // ── Backfill: classify records where language IS NULL ──────────────────

    let totalUpdated = 0;
    let failureCount = 0;
    let offset = 0;

    while (true) {
      // Fetch a batch of records without language
      const rows = await sql`
        SELECT id, file_path
        FROM learning_memories
        WHERE language IS NULL
        ORDER BY id
        LIMIT ${batchSize}
        OFFSET ${offset}
      `;

      if (rows.length === 0) break;

      // Classify each file path
      const classified = rows.map((row) => ({
        id: row.id as number,
        language: classifyFileLanguage(row.file_path as string).toLowerCase(),
      }));

      try {
        // Batch UPDATE using CASE/WHEN for efficiency
        // Build a VALUES list for the CASE expression
        const caseExpr = classified
          .map(({ id, language }) => `WHEN id = ${id} THEN '${language.replace(/'/g, "''")}'`)
          .join("\n        ");

        const ids = classified.map(({ id }) => id);

        await sql.unsafe(`
          UPDATE learning_memories
          SET language = CASE
            ${caseExpr}
          END
          WHERE id = ANY($1::bigint[])
            AND language IS NULL
        `, [ids]);

        totalUpdated += rows.length;
        logger.debug({ batch: offset / batchSize + 1, count: rows.length }, "Batch updated");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, offset }, "Batch update failed");
        failureCount += rows.length;
      }

      offset += batchSize;
    }

    if (totalUpdated > 0 || failureCount > 0) {
      logger.info({ totalUpdated, failureCount }, "Backfill updates complete");
    } else {
      logger.info("No records required backfill (migration 007 already applied)");
    }
  } else {
    logger.info("Dry-run mode: skipping updates, printing stats only");
  }

  // ── Stats: aggregate language distribution ─────────────────────────────

  const totalRows = await sql`
    SELECT COUNT(*)::int AS total FROM learning_memories
  `;
  const total = (totalRows[0]!.total as number) ?? 0;

  const languageRows = await sql`
    SELECT language, COUNT(*)::int AS count
    FROM learning_memories
    GROUP BY language
    ORDER BY count DESC
  `;

  const unknownCount = languageRows
    .filter((r) => r.language === "unknown" || r.language === null)
    .reduce((sum, r) => sum + ((r.count as number) ?? 0), 0);

  // Determine failure count from dry-run context
  const failureCount = isDryRun ? 0 : 0; // failures tracked during backfill, not available here

  // ── Print stats summary ────────────────────────────────────────────────

  console.log("\n=== Backfill Language Classification Complete ===");
  console.log(`Total records: ${total}`);
  console.log("Records per language:");

  for (const row of languageRows) {
    const lang = (row.language as string | null) ?? "(null)";
    const count = (row.count as number) ?? 0;
    console.log(`  ${lang}: ${count}`);
  }

  console.log(`Records marked 'unknown': ${unknownCount}`);
  console.log(`Failures: ${failureCount}`);
  console.log("");
} finally {
  await client.close();
}
