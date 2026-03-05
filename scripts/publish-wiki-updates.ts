/**
 * CLI script for publishing wiki update suggestions to GitHub.
 *
 * Posts generated suggestions (from Phase 123) as structured comments
 * on a tracking issue in xbmc/wiki. Each page gets one comment with
 * all its section suggestions. Rate-limit safe.
 *
 * Usage:
 *   bun scripts/publish-wiki-updates.ts                     # Publish all unpublished
 *   bun scripts/publish-wiki-updates.ts --dry-run            # Preview without posting
 *   bun scripts/publish-wiki-updates.ts --dry-run --output out.md  # Write preview to file
 *   bun scripts/publish-wiki-updates.ts --page-ids 123,456   # Specific pages only
 *   bun scripts/publish-wiki-updates.ts --grounded-only       # Skip voice mismatches
 *   bun scripts/publish-wiki-updates.ts --owner myorg --repo mywiki  # Custom target
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   GITHUB_APP_ID         - GitHub App ID
 *   GITHUB_PRIVATE_KEY    - GitHub App private key (PEM string, file path, or base64)
 */

import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createGitHubApp } from "../src/auth/github-app.ts";
import { createWikiPublisher } from "../src/knowledge/wiki-publisher.ts";
import type { AppConfig } from "../src/config.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    "page-ids": { type: "string" },
    "grounded-only": { type: "boolean", default: false },
    owner: { type: "string", default: "xbmc" },
    repo: { type: "string", default: "wiki" },
    output: { type: "string" },
    "comment-delay": { type: "string", default: "3000" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/publish-wiki-updates.ts [options]

Options:
  --dry-run             Preview formatted markdown without posting to GitHub
  --output <file>       Write dry-run output to file (requires --dry-run)
  --page-ids <ids>      Comma-separated page IDs to publish (default: all unpublished)
  --grounded-only       Skip suggestions with voice mismatch warnings
  --owner <owner>       Target repo owner (default: xbmc)
  --repo <repo>         Target wiki repo name (default: wiki)
  --comment-delay <ms>  Milliseconds between comment API calls (default: 3000)
  --help                Show this help

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
  GITHUB_APP_ID         GitHub App ID (required for live runs)
  GITHUB_PRIVATE_KEY    GitHub App private key — PEM string, file path, or base64
  LOG_LEVEL             Logging level (default: info)
`);
  process.exit(0);
}

const dryRun = values["dry-run"]!;
const groundedOnly = values["grounded-only"]!;
const commentDelayMs = parseInt(values["comment-delay"]!, 10);
const pageIds = values["page-ids"]
  ?.split(",")
  .map(Number)
  .filter((n) => !isNaN(n));

// ── Private key loader (reuse config.ts logic) ──────────────────────────

async function loadPrivateKey(): Promise<string> {
  const keyEnv =
    process.env.GITHUB_PRIVATE_KEY ?? process.env.GITHUB_PRIVATE_KEY_BASE64;
  if (!keyEnv) {
    throw new Error(
      "GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_BASE64 environment variable is required",
    );
  }

  if (keyEnv.startsWith("-----BEGIN")) return keyEnv;

  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    return await Bun.file(keyEnv).text();
  }

  return atob(keyEnv);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  logger.info(
    {
      dryRun,
      groundedOnly,
      pageIds: pageIds ?? "all",
      owner: values.owner,
      repo: values.repo,
      commentDelayMs,
    },
    "Starting wiki update publishing",
  );

  // Setup: DB client + migrations
  const db = createDbClient({ logger });
  await runMigrations(db.sql);

  // Setup: GitHub App (only needed for live runs)
  let githubApp;
  if (!dryRun) {
    const privateKey = await loadPrivateKey();
    // Build minimal AppConfig — only GitHub fields are used by the publisher
    const config: AppConfig = {
      githubAppId: process.env.GITHUB_APP_ID!,
      githubPrivateKey: privateKey,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "unused",
      slackSigningSecret: "unused",
      slackBotToken: "unused",
      slackBotUserId: "unused",
      slackKodiaiChannelId: "unused",
      slackDefaultRepo: "xbmc/xbmc",
      slackAssistantModel: "unused",
      port: 0,
      logLevel: process.env.LOG_LEVEL ?? "info",
      botAllowList: [],
      slackWikiChannelId: "",
      wikiStalenessThresholdDays: 30,
      wikiGithubOwner: values.owner!,
      wikiGithubRepo: values.repo!,
    };
    githubApp = createGitHubApp(config, logger);
    await githubApp.initialize();
  } else {
    // Dry-run: create a stub GitHubApp — publish() won't call any GitHub APIs
    githubApp = {
      getInstallationOctokit: async () => {
        throw new Error("Dry-run: no Octokit available");
      },
      getAppSlug: () => "kodiai",
      initialize: async () => {},
      checkConnectivity: async () => false,
      getInstallationToken: async () => "",
      getRepoInstallationContext: async () => null,
    } as unknown as ReturnType<typeof createGitHubApp>;
  }

  // Create publisher
  const publisher = createWikiPublisher({
    sql: db.sql,
    githubApp,
    logger,
    owner: values.owner,
    repo: values.repo,
    commentDelayMs,
  });

  // Run
  const result = await publisher.publish({
    dryRun,
    pageIds,
    groundedOnly,
  });

  // Handle --output for dry-run
  if (dryRun && values.output && result.dryRunOutput) {
    writeFileSync(values.output, result.dryRunOutput, "utf-8");
    logger.info({ path: values.output }, `Dry-run output written to ${values.output}`);
  }

  // Summary
  const issueInfo =
    result.issueNumber != null
      ? `#${result.issueNumber} (${result.issueUrl})`
      : "N/A";

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Wiki Update Publishing Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Issue:                  ${issueInfo}
 Pages posted:           ${result.pagesPosted}
 Pages skipped:          ${result.pagesSkipped}
 Suggestions published:  ${result.suggestionsPublished}
 Mode:                   ${dryRun ? "dry-run" : "live"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  if (result.skippedPages.length > 0) {
    console.log("Skipped pages:");
    for (const sp of result.skippedPages) {
      console.log(`  - ${sp.pageTitle}: ${sp.reason}`);
    }
    console.log();
  }

  // Cleanup
  await db.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Wiki update publishing failed");
    process.exit(1);
  });
