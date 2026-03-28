/**
 * One-time cleanup script for legacy kodiai/* branches in target repositories.
 *
 * Deletes branches matching `kodiai/write-*` and `kodiai/slack/*` that were
 * created by the old direct-push approach (before fork-based write mode).
 *
 * Usage:
 *   bun scripts/cleanup-legacy-branches.ts --owner xbmc --dry-run
 *   bun scripts/cleanup-legacy-branches.ts --owner xbmc --repo xbmc --no-dry-run
 *   bun scripts/cleanup-legacy-branches.ts --help
 *
 * Environment variables required:
 *   GITHUB_APP_ID         - GitHub App ID
 *   GITHUB_PRIVATE_KEY    - GitHub App private key (PEM, file path, or base64)
 */

import { parseArgs } from "node:util";
import pino from "pino";
import { createGitHubApp } from "../src/auth/github-app.ts";
import type { AppConfig } from "../src/config.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    owner: { type: "string" },
    repo: { type: "string" },
    "dry-run": { type: "boolean", default: true },
    "no-dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/cleanup-legacy-branches.ts [options]

Options:
  --owner <owner>     GitHub owner/organization (required)
  --repo <repo>       Specific repository (optional, defaults to all repos for the installation)
  --dry-run           List branches that would be deleted without deleting (default)
  --no-dry-run        Actually delete the branches
  --help              Show this help

Environment:
  GITHUB_APP_ID         GitHub App ID (required)
  GITHUB_PRIVATE_KEY    GitHub App private key (required)

Examples:
  bun scripts/cleanup-legacy-branches.ts --owner xbmc --dry-run
  bun scripts/cleanup-legacy-branches.ts --owner xbmc --repo xbmc --no-dry-run
`);
  process.exit(0);
}

if (!values.owner) {
  console.error("ERROR: --owner is required. Use --help for usage.");
  process.exit(1);
}

const owner = values.owner;
const specificRepo = values.repo;
const dryRun = !values["no-dry-run"];

// ── Validate environment ────────────────────────────────────────────────────

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

// ── Legacy branch patterns ──────────────────────────────────────────────────

const LEGACY_BRANCH_PATTERNS = [
  /^refs\/heads\/kodiai\/write-/,
  /^refs\/heads\/kodiai\/slack\//,
];

function isLegacyBranch(ref: string): boolean {
  return LEGACY_BRANCH_PATTERNS.some((pattern) => pattern.test(ref));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = await loadPrivateKey();

  // Build a minimal AppConfig for createGitHubApp
  const appConfig = {
    githubAppId: process.env.GITHUB_APP_ID!,
    githubPrivateKey: privateKey,
    webhookSecret: "unused",
    slackSigningSecret: "unused",
    slackBotToken: "unused",
    slackBotUserId: "unused",
    slackKodiaiChannelId: "unused",
    slackDefaultRepo: "unused",
    slackAssistantModel: "unused",
    port: 3000,
    logLevel: "info",
    botAllowList: [],
    slackWikiChannelId: "",
    wikiStalenessThresholdDays: 30,
    wikiGithubOwner: "",
    wikiGithubRepo: "",
    botUserPat: "",
    botUserLogin: "",
    addonRepos: [],
  } satisfies AppConfig;

  const githubApp = createGitHubApp(appConfig, logger);
  await githubApp.initialize();

  // Determine which repos to scan
  const repos: string[] = [];

  if (specificRepo) {
    repos.push(specificRepo);
  } else {
    // List all repos accessible to the installation for this owner
    const context = await githubApp.getRepoInstallationContext(owner, owner);
    if (!context) {
      console.error(`ERROR: No GitHub App installation found for ${owner}. Is the app installed?`);
      process.exit(1);
    }

    const octokit = await githubApp.getInstallationOctokit(context.installationId);
    const iterator = octokit.paginate.iterator(octokit.rest.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });

    for await (const response of iterator) {
      for (const repo of response.data) {
        if (repo.owner?.login === owner) {
          repos.push(repo.name);
        }
      }
    }
  }

  console.log(`\nScanning ${repos.length} repo(s) for owner "${owner}"...`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no deletions)" : "DELETE"}\n`);

  let totalFound = 0;
  let totalDeleted = 0;

  for (const repo of repos) {
    const repoContext = await githubApp.getRepoInstallationContext(owner, repo);
    if (!repoContext) {
      logger.warn({ owner, repo }, "Skipping repo -- no installation context");
      continue;
    }

    const octokit = await githubApp.getInstallationOctokit(repoContext.installationId);

    // List all refs matching kodiai/ prefix
    let refs: Array<{ ref: string }>;
    try {
      const response = await octokit.rest.git.listMatchingRefs({
        owner,
        repo,
        ref: "heads/kodiai/",
      });
      refs = response.data;
    } catch (error) {
      logger.warn({ owner, repo, error }, "Failed to list refs");
      continue;
    }

    // Filter to legacy patterns only
    const legacyRefs = refs.filter((r) => isLegacyBranch(r.ref));

    if (legacyRefs.length === 0) {
      continue;
    }

    totalFound += legacyRefs.length;
    console.log(`${owner}/${repo}: ${legacyRefs.length} legacy branch(es)`);

    for (const ref of legacyRefs) {
      const branchName = ref.ref.replace("refs/heads/", "");

      if (dryRun) {
        console.log(`  [DRY RUN] would delete: ${branchName}`);
      } else {
        try {
          await octokit.rest.git.deleteRef({
            owner,
            repo,
            ref: ref.ref.replace("refs/", ""),
          });
          console.log(`  [DELETED] ${branchName}`);
          totalDeleted++;
        } catch (error) {
          console.error(`  [FAILED] ${branchName}: ${error}`);
        }
      }
    }
  }

  // Summary
  console.log("\n--- Summary ---");
  console.log(`Total legacy branches found: ${totalFound}`);
  if (dryRun) {
    console.log(`Would delete: ${totalFound} (pass --no-dry-run to delete)`);
  } else {
    console.log(`Deleted: ${totalDeleted}`);
    if (totalDeleted < totalFound) {
      console.log(`Failed: ${totalFound - totalDeleted}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
