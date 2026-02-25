/**
 * CLI entry point for backfilling PR review comments from GitHub API.
 *
 * Usage:
 *   bun scripts/backfill-review-comments.ts                          # Full 18-month backfill for xbmc/xbmc
 *   bun scripts/backfill-review-comments.ts --repo xbmc/xbmc         # Explicit repo
 *   bun scripts/backfill-review-comments.ts --months 6               # Custom lookback
 *   bun scripts/backfill-review-comments.ts --pr 1234                # Sync single PR
 *   bun scripts/backfill-review-comments.ts --dry-run                # Fetch and log, don't store
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   GITHUB_APP_ID         - GitHub App ID
 *   GITHUB_PRIVATE_KEY    - GitHub App private key (PEM, file path, or base64)
 *   VOYAGE_API_KEY        - VoyageAI API key (optional, embeddings disabled without it)
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createReviewCommentStore } from "../src/knowledge/review-comment-store.ts";
import { createEmbeddingProvider, createNoOpEmbeddingProvider } from "../src/knowledge/embeddings.ts";
import { createGitHubApp } from "../src/auth/github-app.ts";
import { backfillReviewComments, syncSinglePR } from "../src/knowledge/review-comment-backfill.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    repo: { type: "string", default: "xbmc/xbmc" },
    months: { type: "string", default: "18" },
    pr: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/backfill-review-comments.ts [options]

Options:
  --repo <owner/repo>   Repository to backfill (default: xbmc/xbmc)
  --months <n>          Months of history to fetch (default: 18)
  --pr <number>         Sync a single PR instead of full backfill
  --dry-run             Fetch and log but don't store
  --help                Show this help

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
  GITHUB_APP_ID         GitHub App ID (required)
  GITHUB_PRIVATE_KEY    GitHub App private key (required)
  VOYAGE_API_KEY        VoyageAI API key (optional)
`);
  process.exit(0);
}

const repo = values.repo!;
const monthsBack = parseInt(values.months!, 10);
const prNumber = values.pr ? parseInt(values.pr, 10) : undefined;
const dryRun = values["dry-run"]!;

// ── Validate environment ────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

if (!process.env.GITHUB_APP_ID) {
  console.error("ERROR: GITHUB_APP_ID environment variable is required.");
  process.exit(1);
}

if (!process.env.GITHUB_PRIVATE_KEY) {
  console.error("ERROR: GITHUB_PRIVATE_KEY environment variable is required.");
  process.exit(1);
}

// ── Load private key ────────────────────────────────────────────────────────

async function loadPrivateKey(): Promise<string> {
  const keyEnv = process.env.GITHUB_PRIVATE_KEY!;

  // Inline PEM string
  if (keyEnv.startsWith("-----BEGIN")) {
    return keyEnv;
  }

  // File path
  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    return await Bun.file(keyEnv).text();
  }

  // Base64-encoded
  return atob(keyEnv);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error(`ERROR: Invalid repo format "${repo}". Expected "owner/repo".`);
    process.exit(1);
  }

  console.log(`Repository:  ${repo}`);
  console.log(`Months back: ${monthsBack}`);
  if (prNumber) console.log(`Single PR:   #${prNumber}`);
  if (dryRun) console.log("DRY RUN: No data will be written.");
  console.log();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createDbClient({ logger });
  await runMigrations(db.sql);
  const store = createReviewCommentStore({ sql: db.sql, logger });

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

  // ── GitHub App ────────────────────────────────────────────────────────────
  const privateKey = await loadPrivateKey();
  const githubApp = createGitHubApp(
    {
      githubAppId: process.env.GITHUB_APP_ID!,
      githubPrivateKey: privateKey,
      webhookSecret: "unused",
      slackSigningSecret: "unused",
      slackBotToken: "unused",
      slackBotUserId: "unused",
      slackKodiaiChannelId: "unused",
      slackDefaultRepo: repo,
      slackAssistantModel: "unused",
      port: 0,
      logLevel: "info",
      botAllowList: [],
    },
    logger,
  );

  await githubApp.initialize();

  // Resolve installation for the target repo
  const installCtx = await githubApp.getRepoInstallationContext(owner, repoName);
  if (!installCtx) {
    console.error(`ERROR: GitHub App is not installed on ${repo}.`);
    await db.close();
    process.exit(1);
  }

  const octokit = await githubApp.getInstallationOctokit(installCtx.installationId);

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    if (prNumber) {
      const result = await syncSinglePR({
        octokit,
        store,
        embeddingProvider,
        repo,
        prNumber,
        logger,
        dryRun,
      });

      console.log();
      console.log(`Single PR #${prNumber} sync complete.`);
      console.log(`  Chunks written: ${result.chunksWritten}`);
    } else {
      const result = await backfillReviewComments({
        octokit,
        store,
        embeddingProvider,
        repo,
        monthsBack,
        logger,
        dryRun,
      });

      console.log();
      console.log("Backfill complete.");
      console.log(`  Total comments: ${result.totalComments}`);
      console.log(`  Total chunks:   ${result.totalChunks}`);
      console.log(`  Total embeddings: ${result.totalEmbeddings}`);
      console.log(`  Pages processed:  ${result.pagesProcessed}`);
      console.log(`  Duration:         ${(result.durationMs / 1000).toFixed(1)}s`);
      console.log(`  Resumed:          ${result.resumed}`);
    }
  } finally {
    await db.close();
  }
}

await main();
