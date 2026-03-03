/**
 * CLI script to re-embed all wiki page chunks with voyage-context-3.
 *
 * Usage:
 *   bun scripts/wiki-embedding-backfill.ts                    # Full backfill
 *   bun scripts/wiki-embedding-backfill.ts --model voyage-context-3
 *   bun scripts/wiki-embedding-backfill.ts --delay 1000       # 1s delay between pages
 *   bun scripts/wiki-embedding-backfill.ts --dry-run          # Calculate totals only
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   VOYAGE_API_KEY        - VoyageAI API key
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import {
  VoyageAIClient,
  contextualizedEmbedChunks,
  createContextualizedEmbeddingProvider,
} from "../src/knowledge/embeddings.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string", default: "voyage-context-3" },
    delay: { type: "string", default: "500" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/wiki-embedding-backfill.ts [options]

Options:
  --model <name>    Target embedding model (default: voyage-context-3)
  --delay <ms>      Delay between pages in ms (default: 500)
  --dry-run         Calculate totals without writing
  --help            Show this help

Environment:
  DATABASE_URL      PostgreSQL connection string (required)
  VOYAGE_API_KEY    VoyageAI API key (required)
`);
  process.exit(0);
}

const model = values.model!;
const delayMs = parseInt(values.delay!, 10);
const dryRun = values["dry-run"]!;

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

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a Float32Array to pgvector-compatible string format: [0.1,0.2,...]
 */
function float32ArrayToVectorString(arr: Float32Array): string {
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    parts[i] = String(arr[i]);
  }
  return `[${parts.join(",")}]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log(`Model:      ${model}`);
  console.log(`Delay:      ${delayMs}ms`);
  if (dryRun) console.log("DRY RUN: No data will be written.");
  console.log();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createDbClient({ logger });
  await runMigrations(db.sql);

  try {
    // ── Pre-flight ────────────────────────────────────────────────────────
    const [preflight] = await db.sql`
      SELECT
        COUNT(*)::int AS total_chunks,
        COALESCE(SUM(token_count), 0)::int AS total_tokens
      FROM wiki_pages
      WHERE deleted = false
    `;

    const totalChunks = preflight!.total_chunks as number;
    const totalTokens = preflight!.total_tokens as number;
    const estimatedCost = (totalTokens / 1_000_000) * 0.18;

    console.log("Pre-flight summary:");
    console.log(`  Total chunks:     ${totalChunks}`);
    console.log(`  Total tokens:     ${totalTokens.toLocaleString()}`);
    console.log(`  Estimated cost:   $${estimatedCost.toFixed(4)} ($0.18/1M tokens, first 200M free)`);
    console.log();

    if (dryRun) {
      console.log("Dry run complete. No embeddings were generated or written.");
      return;
    }

    // ── Get distinct pages ──────────────────────────────────────────────────
    const pageRows = await db.sql`
      SELECT DISTINCT page_id
      FROM wiki_pages
      WHERE deleted = false
      ORDER BY page_id
    `;

    const totalPages = pageRows.length;
    console.log(`Found ${totalPages} distinct pages to process.`);
    console.log();

    // ── Embedding client ────────────────────────────────────────────────────
    const client = new VoyageAIClient({ apiKey: voyageApiKey });
    const fallbackProvider = createContextualizedEmbeddingProvider({
      apiKey: voyageApiKey,
      model,
      dimensions: 1024,
      logger,
    });

    let chunksEmbedded = 0;
    let chunksFailed = 0;
    let pagesProcessed = 0;

    // ── Process each page ───────────────────────────────────────────────────
    for (const pageRow of pageRows) {
      const pageId = pageRow.page_id as number;

      // Load all chunks for this page
      const chunks = await db.sql`
        SELECT id, chunk_index, chunk_text
        FROM wiki_pages
        WHERE page_id = ${pageId} AND deleted = false
        ORDER BY chunk_index
      `;

      if (chunks.length === 0) {
        pagesProcessed++;
        continue;
      }

      const chunkTexts = chunks.map((c) => c.chunk_text as string);
      const chunkIds = chunks.map((c) => c.id as number);

      // Try batch embedding for the whole page
      let embeddings = await contextualizedEmbedChunks({
        client,
        chunks: chunkTexts,
        model,
        dimensions: 1024,
        logger,
      });

      // Fallback: if batch returned nothing (token limit error), embed individually
      if (embeddings.size === 0 && chunkTexts.length > 0) {
        logger.warn(
          { pageId, chunkCount: chunkTexts.length },
          "Batch embedding returned empty -- falling back to per-chunk embedding",
        );

        embeddings = new Map<number, Float32Array>();
        for (let i = 0; i < chunkTexts.length; i++) {
          const result = await fallbackProvider.generate(chunkTexts[i]!, "document");
          if (result) {
            embeddings.set(i, result.embedding);
          } else {
            logger.warn({ pageId, chunkIndex: i }, "Per-chunk fallback embedding failed");
          }
        }
      }

      // Update each chunk in DB
      for (let i = 0; i < chunkIds.length; i++) {
        const embedding = embeddings.get(i);
        if (embedding) {
          const vectorStr = float32ArrayToVectorString(embedding);
          await db.sql`
            UPDATE wiki_pages
            SET embedding = ${vectorStr}::vector,
                embedding_model = ${model},
                stale = false
            WHERE id = ${chunkIds[i]}
          `;
          chunksEmbedded++;
        } else {
          chunksFailed++;
          logger.warn({ pageId, chunkIndex: i, chunkId: chunkIds[i] }, "No embedding generated for chunk");
        }
      }

      pagesProcessed++;

      // Progress logging every 10 pages
      if (pagesProcessed % 10 === 0 || pagesProcessed === totalPages) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `Progress: ${pagesProcessed}/${totalPages} pages | ${chunksEmbedded} embedded | ${chunksFailed} failed | ${elapsed}s`,
        );
      }

      // Rate limit delay between pages
      if (pagesProcessed < totalPages) {
        await sleep(delayMs);
      }
    }

    console.log();

    // ── Post-backfill verification ──────────────────────────────────────────
    const [verification] = await db.sql`
      SELECT COUNT(*)::int AS remaining
      FROM wiki_pages
      WHERE embedding_model != ${model}
        AND deleted = false
        AND embedding IS NOT NULL
    `;

    const remaining = verification!.remaining as number;
    if (remaining > 0) {
      console.log(`WARNING: ${remaining} rows still have a different embedding_model.`);
      logger.warn({ remaining, expectedModel: model }, "Post-backfill verification: rows with old model remain");
    } else {
      console.log("Verification PASSED: zero rows with old embedding model.");
    }

    console.log();

    // ── Summary ─────────────────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("Backfill complete.");
    console.log(`  Pages processed:  ${pagesProcessed}`);
    console.log(`  Chunks embedded:  ${chunksEmbedded}`);
    console.log(`  Chunks failed:    ${chunksFailed}`);
    console.log(`  Elapsed time:     ${elapsed}s`);
    console.log();
    console.log("Post-migration: consider running REINDEX INDEX idx_wiki_pages_embedding_hnsw for optimal search quality.");
  } finally {
    await db.close();
  }
}

await main();
