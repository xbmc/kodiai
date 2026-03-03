/**
 * Reusable benchmark comparing retrieval results between two embedding models.
 *
 * Usage:
 *   bun scripts/embedding-comparison.ts                              # Default: voyage-code-3 vs voyage-context-3
 *   bun scripts/embedding-comparison.ts --old-model voyage-code-3    # Explicit models
 *   bun scripts/embedding-comparison.ts --top-k 10                   # More results per query
 *   bun scripts/embedding-comparison.ts --output results.json        # Custom output path
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   VOYAGE_API_KEY        - VoyageAI API key
 *
 * Note: Before backfill, DB has voyage-code-3 embeddings. The "new model" query
 * embeddings will be generated on the fly but searched against old DB vectors,
 * so new-model results will appear degraded until the backfill completes.
 */

import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  createEmbeddingProvider,
  createContextualizedEmbeddingProvider,
} from "../src/knowledge/embeddings.ts";
import { createWikiPageStore } from "../src/knowledge/wiki-store.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "warn" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "old-model": { type: "string", default: "voyage-code-3" },
    "new-model": { type: "string", default: "voyage-context-3" },
    "top-k": { type: "string", default: "5" },
    output: { type: "string", default: "data/embedding-comparison.json" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/embedding-comparison.ts [options]

Options:
  --old-model <name>   Old embedding model (default: voyage-code-3)
  --new-model <name>   New embedding model (default: voyage-context-3)
  --top-k <n>          Results per query (default: 5)
  --output <path>      JSON output path (default: data/embedding-comparison.json)
  --help               Show this help

Environment:
  DATABASE_URL         PostgreSQL connection string (required)
  VOYAGE_API_KEY       VoyageAI API key (required)
`);
  process.exit(0);
}

const oldModel = values["old-model"]!;
const newModel = values["new-model"]!;
const topK = parseInt(values["top-k"]!, 10);
const outputPath = values.output!;

// ── Validate environment ────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

if (!process.env.VOYAGE_API_KEY) {
  console.error("ERROR: VOYAGE_API_KEY environment variable is required.");
  process.exit(1);
}

const voyageApiKey = process.env.VOYAGE_API_KEY;

// ── Eval query set ──────────────────────────────────────────────────────────

const EVAL_QUERIES = [
  "How to install Kodi on Windows",
  "PVR setup with TVHeadend",
  "Audio passthrough configuration",
  "Kodi Python addon development",
  "Skin development XML structure",
  "MySQL shared database setup",
  "HDR video playback settings",
  "Kodi remote control setup",
  "Log file location and debugging",
  "Add-on repository configuration",
  "Kodi keyboard shortcuts and hotkeys",
  "NFO file scraper configuration",
  "Kodi network streaming DLNA UPnP",
] as const;

// ── Types ───────────────────────────────────────────────────────────────────

type ResultEntry = {
  pageTitle: string;
  distance: number;
  section: string | null;
};

type QueryResult = {
  query: string;
  oldResults: ResultEntry[];
  newResults: ResultEntry[];
};

type ComparisonOutput = {
  timestamp: string;
  oldModel: string;
  newModel: string;
  topK: number;
  queries: QueryResult[];
  summary: {
    avgDistanceOld: number;
    avgDistanceNew: number;
    improvement: string;
    top1Changed: number;
    queriesImproved: number;
  };
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Old model:  ${oldModel}`);
  console.log(`New model:  ${newModel}`);
  console.log(`Top-K:      ${topK}`);
  console.log(`Output:     ${outputPath}`);
  console.log();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createDbClient({ logger });
  await runMigrations(db.sql);
  const store = createWikiPageStore({ sql: db.sql, logger });

  // ── Embedding providers ───────────────────────────────────────────────────
  const oldProvider = createEmbeddingProvider({
    apiKey: voyageApiKey,
    model: oldModel,
    dimensions: 1024,
    logger,
  });

  const newProvider = createContextualizedEmbeddingProvider({
    apiKey: voyageApiKey,
    model: newModel,
    dimensions: 1024,
    logger,
  });

  const queryResults: QueryResult[] = [];
  let totalOldDistance = 0;
  let totalNewDistance = 0;
  let totalResults = 0;
  let top1Changed = 0;
  let queriesImproved = 0;

  try {
    for (const query of EVAL_QUERIES) {
      // Generate query embeddings with both models
      const oldEmbedding = await oldProvider.generate(query, "query");
      const newEmbedding = await newProvider.generate(query, "query");

      if (!oldEmbedding || !newEmbedding) {
        console.log(`SKIP: "${query}" -- embedding generation failed`);
        continue;
      }

      // Search with both embeddings
      const oldResults = await store.searchByEmbedding({
        queryEmbedding: oldEmbedding.embedding,
        topK,
      });

      const newResults = await store.searchByEmbedding({
        queryEmbedding: newEmbedding.embedding,
        topK,
      });

      const oldEntries: ResultEntry[] = oldResults.map((r) => ({
        pageTitle: r.record.pageTitle,
        distance: Math.round(r.distance * 10000) / 10000,
        section: r.record.sectionHeading,
      }));

      const newEntries: ResultEntry[] = newResults.map((r) => ({
        pageTitle: r.record.pageTitle,
        distance: Math.round(r.distance * 10000) / 10000,
        section: r.record.sectionHeading,
      }));

      queryResults.push({ query, oldResults: oldEntries, newResults: newEntries });

      // Accumulate stats
      const oldAvg = oldEntries.reduce((sum, e) => sum + e.distance, 0) / (oldEntries.length || 1);
      const newAvg = newEntries.reduce((sum, e) => sum + e.distance, 0) / (newEntries.length || 1);
      totalOldDistance += oldAvg;
      totalNewDistance += newAvg;
      totalResults++;

      if (oldEntries[0]?.pageTitle !== newEntries[0]?.pageTitle) {
        top1Changed++;
      }
      if (newAvg < oldAvg) {
        queriesImproved++;
      }

      // ── Console output ──────────────────────────────────────────────────
      console.log(`Query: "${query}"`);
      console.log();

      const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
      const header = `  ${pad(`Old (${oldModel})`, 40)} | New (${newModel})`;
      const divider = `  ${"─".repeat(40)}┼${"─".repeat(40)}`;

      console.log(header);
      console.log(divider);

      const maxRows = Math.max(oldEntries.length, newEntries.length);
      for (let i = 0; i < maxRows; i++) {
        const oldCol = oldEntries[i]
          ? `${i + 1}. ${oldEntries[i].pageTitle} (${oldEntries[i].distance.toFixed(4)})`
          : "";
        const newCol = newEntries[i]
          ? `${i + 1}. ${newEntries[i].pageTitle} (${newEntries[i].distance.toFixed(4)})`
          : "";
        console.log(`  ${pad(oldCol, 40)} | ${newCol}`);
      }

      console.log();
    }

    // ── Summary stats ─────────────────────────────────────────────────────
    const avgOld = totalResults > 0 ? totalOldDistance / totalResults : 0;
    const avgNew = totalResults > 0 ? totalNewDistance / totalResults : 0;
    const improvementPct = avgOld > 0 ? (((avgOld - avgNew) / avgOld) * 100).toFixed(1) : "0.0";

    console.log("=== Summary ===");
    console.log(`  Queries evaluated:        ${totalResults}`);
    console.log(`  Avg distance (old):       ${avgOld.toFixed(4)}`);
    console.log(`  Avg distance (new):       ${avgNew.toFixed(4)}`);
    console.log(`  Distance improvement:     ${improvementPct}%`);
    console.log(`  Top-1 result changed:     ${top1Changed}/${totalResults}`);
    console.log(`  Queries with improvement: ${queriesImproved}/${totalResults}`);
    console.log();

    // ── JSON output ─────────────────────────────────────────────────────────
    const output: ComparisonOutput = {
      timestamp: new Date().toISOString(),
      oldModel,
      newModel,
      topK,
      queries: queryResults,
      summary: {
        avgDistanceOld: Math.round(avgOld * 10000) / 10000,
        avgDistanceNew: Math.round(avgNew * 10000) / 10000,
        improvement: `${improvementPct}%`,
        top1Changed,
        queriesImproved,
      },
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`Results written to ${outputPath}`);
  } finally {
    await db.close();
  }
}

await main();
