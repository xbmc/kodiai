/**
 * CLI entry point for backfilling GitHub issues and comments into the corpus.
 *
 * Usage:
 *   bun scripts/backfill-issues.ts                          # Full backfill for xbmc/xbmc
 *   bun scripts/backfill-issues.ts --repo xbmc/xbmc         # Explicit repo
 *   bun scripts/backfill-issues.ts --sync                   # Incremental sync (nightly mode)
 *   bun scripts/backfill-issues.ts --dry-run                # Fetch and log, don't store
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
import { createIssueStore } from "../src/knowledge/issue-store.ts";
import { createEmbeddingProvider, createNoOpEmbeddingProvider } from "../src/knowledge/embeddings.ts";
import { createGitHubApp } from "../src/auth/github-app.ts";
import { backfillIssues, backfillIssueComments } from "../src/knowledge/issue-backfill.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    repo: { type: "string", default: "xbmc/xbmc" },
    sync: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/backfill-issues.ts [options]

Options:
  --repo <owner/repo>   Repository to backfill (default: xbmc/xbmc)
  --sync                Incremental sync (only issues updated since last sync)
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
const syncMode = values.sync!;
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

  if (keyEnv.startsWith("-----BEGIN")) return keyEnv;
  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    return await Bun.file(keyEnv).text();
  }
  return atob(keyEnv);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error(`ERROR: Invalid repo format "${repo}". Expected "owner/repo".`);
    process.exit(1);
  }

  const mode = syncMode ? "incremental sync" : "full backfill";
  console.log(`Mode:        ${mode}`);
  console.log(`Repository:  ${repo}`);
  if (dryRun) console.log("DRY RUN: No data will be written.");
  console.log();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createDbClient({ logger });
  await runMigrations(db.sql);
  const store = createIssueStore({ sql: db.sql, logger });

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

  const installCtx = await githubApp.getRepoInstallationContext(owner, repoName);
  if (!installCtx) {
    console.error(`ERROR: GitHub App is not installed on ${repo}.`);
    await db.close();
    process.exit(1);
  }

  const octokit = await githubApp.getInstallationOctokit(installCtx.installationId);

  // ── Execute ───────────────────────────────────────────────────────────────
  const startTime = Date.now();

  try {
    if (syncMode) {
      logger.info({ repo }, "Starting incremental sync...");
    } else {
      logger.info({ repo }, "Starting full backfill...");
    }

    // Both modes use the same engine — sync state determines behavior
    const issueResult = await backfillIssues({
      octokit,
      store,
      sql: db.sql,
      embeddingProvider,
      repo,
      dryRun,
      logger,
    });

    const commentResult = await backfillIssueComments({
      octokit,
      store,
      sql: db.sql,
      embeddingProvider,
      repo,
      dryRun,
      logger,
    });

    const totalDuration = Date.now() - startTime;

    // Summary report
    console.log();
    console.log("═══════════════════════════════════════");
    console.log(`  ${syncMode ? "Sync" : "Backfill"} Complete`);
    console.log("═══════════════════════════════════════");
    console.log(`  Issues processed:     ${issueResult.totalIssues}`);
    console.log(`  Comments processed:   ${commentResult.totalComments}`);
    console.log(`  Comment chunks:       ${commentResult.totalChunks}`);
    console.log(`  Embeddings created:   ${issueResult.totalEmbeddings}`);
    console.log(`  Failed embeddings:    ${issueResult.failedEmbeddings + commentResult.failedEmbeddings}`);
    console.log(`  Pages fetched:        ${issueResult.pagesProcessed}`);
    console.log(`  Duration:             ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`  Resumed:              ${issueResult.resumed}`);
    console.log("═══════════════════════════════════════");
  } finally {
    await db.close();
  }
}

await main();
