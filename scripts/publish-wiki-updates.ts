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
    "retrofit-preview": { type: "boolean", default: false },
    "issue-number": { type: "string" },
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
  --retrofit-preview    Scan issue for existing wiki comments, preview planned actions
                        (requires --issue-number; reads GitHub, does not post)
  --issue-number <n>    Target issue number for live publish or --retrofit-preview
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

const retrofitPreview = values["retrofit-preview"]!;

// Parse --issue-number unconditionally — applies to both --retrofit-preview and live publish
let liveIssueNumber: number | undefined;
if (values["issue-number"] != null) {
  liveIssueNumber = parseInt(values["issue-number"]!, 10);
  if (isNaN(liveIssueNumber)) {
    console.error(`Error: --issue-number must be an integer, got: ${values["issue-number"]}`);
    process.exit(1);
  }
}

if (retrofitPreview && liveIssueNumber == null) {
  console.error("Error: --retrofit-preview requires --issue-number <n>");
  process.exit(1);
}

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
      retrofitPreview,
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

  // Setup: GitHub App (only needed for live runs; retrofitPreview also needs live GitHub)
  let githubApp;
  if (!dryRun || retrofitPreview) {
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
      botUserPat: "",
      botUserLogin: "",
      addonRepos: [],
    };
    githubApp = createGitHubApp(config, logger);
    await githubApp.initialize();
  } else {
    // Dry-run (no retrofit-preview): create a stub GitHubApp — publish() won't call any GitHub APIs
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
    retrofitPreview,
    issueNumber: liveIssueNumber,
  });

  // ── Handle --retrofit-preview output ──────────────────────────────
  if (retrofitPreview && result.retrofitPreviewResult) {
    const { actions, issueNumber: scanIssue } = result.retrofitPreviewResult;

    console.log(`\nRetrofit Preview — Issue #${scanIssue}\n`);

    const ACTION_W = 8;
    const PAGE_W = 26;
    const COMMENT_W = 12;
    const URL_W = 40;

    const pad = (s: string, w: number) => s.length >= w ? s : s + " ".repeat(w - s.length);
    const header = `${pad("ACTION", ACTION_W)} | ${pad("PAGE", PAGE_W)} | ${pad("COMMENT ID", COMMENT_W)} | WIKI URL`;
    const separator = "-".repeat(ACTION_W) + "-+-" + "-".repeat(PAGE_W) + "-+-" + "-".repeat(COMMENT_W) + "-+-" + "-".repeat(URL_W);

    console.log(header);
    console.log(separator);

    for (const a of actions) {
      const wikiUrl = `https://kodi.wiki/view/${encodeURIComponent(a.pageTitle.replace(/ /g, "_"))}`;
      const commentCol = a.existingCommentId != null ? String(a.existingCommentId) : "(new)";
      console.log(`${pad(a.action, ACTION_W)} | ${pad(a.pageTitle, PAGE_W)} | ${pad(commentCol, COMMENT_W)} | ${wikiUrl}`);
    }

    console.log();
    await db.close();
    return;
  }

  // Handle --output for dry-run
  if (dryRun && values.output && result.dryRunOutput) {
    writeFileSync(values.output, result.dryRunOutput, "utf-8");
    logger.info({ path: values.output }, `Dry-run output written to ${values.output}`);
  }

  // Summary
  let issueInfo: string;
  if (result.issueNumber != null) {
    const supplied = liveIssueNumber != null && !dryRun;
    issueInfo = `#${result.issueNumber} (${supplied ? "supplied" : "created"}) — ${result.issueUrl}`;
  } else {
    issueInfo = "N/A";
  }

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
