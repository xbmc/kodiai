/**
 * CLI entry point for backfilling PR evidence for wiki staleness detection.
 *
 * Scans merged PRs from the last N days (default 90), runs heuristic matching
 * against wiki pages, and stores evidence rows for the staleness detector.
 *
 * Usage:
 *   bun scripts/backfill-pr-evidence.ts                  # 90-day backfill
 *   bun scripts/backfill-pr-evidence.ts --days 30        # 30-day backfill
 *   bun scripts/backfill-pr-evidence.ts --help           # Show help
 *
 * Environment variables required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   GITHUB_APP_ID         - GitHub App ID
 *   GITHUB_PRIVATE_KEY    - GitHub App private key (PEM, file path, or base64)
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createGitHubApp } from "../src/auth/github-app.ts";
import {
  hasTokenOverlap,
  scoreWikiTokens,
  tokenizeFilePath,
  tokenizeWikiTexts,
  wikiTokenUnion,
  type WikiTextTokens,
} from "../src/knowledge/wiki-evidence-scoring.ts";
import { storeWikiPrEvidence } from "../src/knowledge/wiki-pr-evidence-store.ts";
import { mapWithConcurrency } from "../src/lib/concurrency.ts";
import { fetchAllPullRequestFiles } from "../src/lib/github-pr-files.ts";
import { retryGitHubTransient } from "../src/lib/github-retry.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    days: { type: "string", default: "90" },
    repo: { type: "string", default: "xbmc/xbmc" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/backfill-pr-evidence.ts [options]

Options:
  --days <number>       Number of days to scan (default: 90)
  --repo <owner/repo>   Repository to scan (default: xbmc/xbmc)
  --help                Show this help

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
  GITHUB_APP_ID         GitHub App ID (required)
  GITHUB_PRIVATE_KEY    GitHub App private key (required)
`);
  process.exit(0);
}

const days = parseInt(values.days!, 10) || 90;
const repo = values.repo!;

// ── Validate environment ────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

if (!process.env.GITHUB_APP_ID) {
  console.error("ERROR: GITHUB_APP_ID environment variable is required.");
  process.exit(1);
}

if (!process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_PRIVATE_KEY_BASE64) {
  process.env.GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY_BASE64;
}

if (!process.env.GITHUB_PRIVATE_KEY) {
  console.error("ERROR: GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_BASE64 environment variable is required.");
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

type PRFileDetail = {
  filename: string;
  patch: string | undefined;
  additions: number;
  deletions: number;
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error(`ERROR: Invalid repo format "${repo}". Expected "owner/repo".`);
    process.exit(1);
  }

  console.log(`Backfill PR Evidence`);
  console.log(`  Repository:  ${repo}`);
  console.log(`  Window:      ${days} days`);
  console.log();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createDbClient({ logger });
  await runMigrations(db.sql);

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
      slackWebhookRelaySources: [],
      port: 0,
      logLevel: "info",
      botAllowList: [],
      slackWikiChannelId: "",
      wikiStalenessThresholdDays: 30,
      wikiGithubOwner: "",
      wikiGithubRepo: "",
      botUserPat: "",
      botUserLogin: "",
      addonRepos: [],
      mcpInternalBaseUrl: "",
      acaJobImage: "",
      acaResourceGroup: "rg-kodiai",
      acaJobName: "caj-kodiai-agent",
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

  // ── Load wiki pages once ──────────────────────────────────────────────────
  const pageRows = await db.sql`
    SELECT page_id, page_title, page_url, chunk_text, chunk_index
    FROM wiki_pages
    WHERE deleted = false AND stale = false
    ORDER BY page_id, chunk_index
    LIMIT 5000
  `;

  const pageMap = new Map<
    number,
    { pageTitle: string; pageUrl: string; chunkTexts: string[]; chunkTokens: WikiTextTokens; tokenUnion?: Set<string> }
  >();

  for (const row of pageRows) {
    const pageId = row.page_id as number;
    if (!pageMap.has(pageId)) {
      pageMap.set(pageId, {
        pageTitle: row.page_title as string,
        pageUrl: row.page_url as string,
        chunkTexts: [],
        chunkTokens: { regularTokens: new Set(), headingTokens: new Set() },
      });
    }
    const page = pageMap.get(pageId)!;
    if (page.chunkTexts.length < 3) {
      page.chunkTexts.push(row.chunk_text as string);
    }
  }
  for (const page of pageMap.values()) {
    page.chunkTokens = tokenizeWikiTexts(page.chunkTexts);
  }

  console.log(`Loaded ${pageMap.size} wiki pages for matching`);
  if (pageMap.size === 0) {
    console.log("No wiki pages found -- nothing to match against.");
    await db.close();
    process.exit(0);
  }

  // ── Fetch and process PRs ─────────────────────────────────────────────────
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const MAX_PAGES = 10;
  let totalPRs = 0;
  let totalEvidence = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let prs;
    try {
      const response = await retryGitHubTransient(() =>
        octokit.rest.pulls.list({
          owner,
          repo: repoName,
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page,
        })
      );
      prs = response.data;
    } catch (err) {
      logger.error({ err, page }, "Failed to list PRs");
      break;
    }

    if (prs.length === 0) break;

    const mergedPRs = prs.filter(
      (pr) => pr.merged_at && new Date(pr.merged_at) >= since,
    );

    const prFileResults = await mapWithConcurrency(mergedPRs, 6, async (pr) => {
      try {
        const files = await fetchAllPullRequestFiles({
          octokit,
          owner,
          repo: repoName,
          pullNumber: pr.number,
        });
        return {
          pr,
          files: files.map((f) => ({
            filename: f.filename,
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
          })),
        };
      } catch (err) {
        logger.warn({ err, prNumber: pr.number }, "Failed to get PR file details (skipping)");
        return { pr, files: null };
      }
    });

    for (const { pr, files } of prFileResults) {
      totalPRs++;

      if (totalPRs % 10 === 0) {
        console.log(`Processing PR ${totalPRs}: #${pr.number} ${pr.title}`);
      }

      if (!files) {
        continue;
      }

      const tokenizedFiles = files.map((file) => ({
        file,
        tokens: tokenizeFilePath(file.filename),
      }));
      const changedFileTokenSets = tokenizedFiles.map(({ tokens }) => tokens);

      // Match against each wiki page
      const prEvidence = {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? null,
        author: pr.user?.login ?? "unknown",
        mergedAt: new Date(pr.merged_at!),
      };

      for (const [pageId, page] of pageMap) {
        const score = scoreWikiTokens(page.chunkTokens, changedFileTokenSets);
        if (score === 0) continue;

        // Find which specific files matched (have token overlap)
        page.tokenUnion ??= wikiTokenUnion(page.chunkTokens);

        const matches: Array<{ filePath: string; patch: string; pageId: number; pageTitle: string; score: number }> = [];

        for (const { file, tokens } of tokenizedFiles) {
          if (!file.patch) continue;
          const hasOverlap = hasTokenOverlap(tokens, page.tokenUnion);
          if (hasOverlap) {
            matches.push({
              filePath: file.filename,
              patch: file.patch,
              pageId,
              pageTitle: page.pageTitle,
              score,
            });
          }
        }

        if (matches.length > 0) {
          totalEvidence += await storeWikiPrEvidence({
            sql: db.sql,
            pr: prEvidence,
            matches,
            logger,
          });
        }
      }
    }

    // Stop pagination when oldest PR on page is before our window
    const oldestPR = prs[prs.length - 1];
    if (oldestPR && new Date(oldestPR.updated_at) < since) break;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log();
  console.log("========================================");
  console.log("  PR Evidence Backfill Complete");
  console.log("========================================");
  console.log(`  PRs processed:       ${totalPRs}`);
  console.log(`  Evidence rows:       ${totalEvidence}`);
  console.log(`  Wiki pages matched:  ${pageMap.size}`);
  console.log(`  Window:              ${days} days`);
  console.log("========================================");

  await db.close();
}

await main();
process.exit(0);
