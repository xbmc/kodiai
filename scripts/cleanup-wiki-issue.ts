/**
 * One-time cleanup script for comments on a GitHub issue.
 *
 * Lists all comments on a given issue and deletes those that lack the
 * `<!-- kodiai:wiki-modification:` marker (default) or ALL comments
 * when `--delete-all` is passed.
 *
 * Usage:
 *   bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run
 *   bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --no-dry-run
 *   bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --delete-all --dry-run
 *   bun scripts/cleanup-wiki-issue.ts --help
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
    "issue-number": { type: "string" },
    "delete-all": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: true },
    "no-dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/cleanup-wiki-issue.ts [options]

Options:
  --owner <owner>           GitHub owner/organization (required)
  --repo <repo>             GitHub repository name (required)
  --issue-number <number>   Issue number to clean up (required, positive integer)
  --delete-all              Delete ALL comments regardless of marker (default: delete only non-marked)
  --dry-run                 List comments that would be deleted without deleting (default)
  --no-dry-run              Actually delete the comments
  --help                    Show this help

Environment:
  GITHUB_APP_ID         GitHub App ID (required)
  GITHUB_PRIVATE_KEY    GitHub App private key (PEM, file path, or base64) (required)

Default mode (no --delete-all):
  Targets comments that do NOT contain the marker: <!-- kodiai:wiki-modification:

--delete-all mode:
  Targets ALL comments regardless of marker presence.

Examples:
  bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run
  bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --no-dry-run
  bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --delete-all --dry-run
`);
  process.exit(0);
}

if (!values.owner) {
  console.error("ERROR: --owner is required. Use --help for usage.");
  process.exit(1);
}

if (!values.repo) {
  console.error("ERROR: --repo is required. Use --help for usage.");
  process.exit(1);
}

if (!values["issue-number"]) {
  console.error("ERROR: --issue-number is required. Use --help for usage.");
  process.exit(1);
}

const issueNumber = parseInt(values["issue-number"], 10);
if (!Number.isInteger(issueNumber) || issueNumber <= 0 || String(issueNumber) !== values["issue-number"]) {
  console.error(`ERROR: --issue-number must be a positive integer, got: ${values["issue-number"]}`);
  process.exit(1);
}

const owner = values.owner;
const repo = values.repo;
const deleteAll = values["delete-all"] ?? false;
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

// ── Comment classification ──────────────────────────────────────────────────

const MODIFICATION_MARKER = "<!-- kodiai:wiki-modification:";

function hasModificationMarker(body: string): boolean {
  return body.includes(MODIFICATION_MARKER);
}

function shouldDelete(body: string | null | undefined, deleteAllMode: boolean): boolean {
  if (deleteAllMode) return true;
  // Default: delete comments that do NOT have the marker
  return !hasModificationMarker(body ?? "");
}

function deletionReason(body: string | null | undefined, deleteAllMode: boolean): string {
  if (deleteAllMode) return "delete-all mode";
  if (!hasModificationMarker(body ?? "")) return "no modification marker";
  return "unknown";
}

function bodySnippet(body: string | null | undefined): string {
  const text = body ?? "";
  return text.length > 80 ? text.slice(0, 80) : text;
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
    mcpInternalBaseUrl: "",
    acaJobImage: "",
    acaResourceGroup: "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  } satisfies AppConfig;

  const githubApp = createGitHubApp(appConfig, logger);
  await githubApp.initialize();

  const context = await githubApp.getRepoInstallationContext(owner, repo);
  if (!context) {
    console.error(`ERROR: No GitHub App installation found for ${owner}/${repo}. Is the app installed?`);
    process.exit(1);
  }

  const octokit = await githubApp.getInstallationOctokit(context.installationId);

  console.log(`\nScanning comments on ${owner}/${repo}#${issueNumber}...`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no deletions)" : "DELETE"}`);
  console.log(`Target: ${deleteAll ? "ALL comments" : "comments without modification marker"}\n`);

  // ── Paginated comment listing ───────────────────────────────────────────

  type IssueComment = Awaited<ReturnType<typeof octokit.rest.issues.listComments>>["data"][number];
  const allComments: IssueComment[] = [];

  logger.debug({ owner, repo, issueNumber }, "Fetching comments (paginated)");

  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
      page,
      sort: "created",
      direction: "asc",
    });

    if (data.length === 0) break;
    allComments.push(...data);
    logger.debug({ page, fetched: data.length, total: allComments.length }, "Fetched comment page");
    if (data.length < 100) break;
  }

  logger.debug({ totalComments: allComments.length }, "Finished fetching comments");

  // ── Classify and process ────────────────────────────────────────────────

  const targets = allComments.filter((c) => shouldDelete(c.body, deleteAll));
  let deleted = 0;
  let errors = 0;

  for (const comment of targets) {
    const reason = deletionReason(comment.body, deleteAll);
    const snippet = bodySnippet(comment.body);

    if (dryRun) {
      console.log(`[DRY RUN] would delete comment ${comment.id} (${reason}) body_snippet="${snippet}"`);
    } else {
      try {
        await octokit.rest.issues.deleteComment({
          owner,
          repo,
          comment_id: comment.id,
        });
        console.log(`[DELETED]  comment ${comment.id}`);
        deleted++;
      } catch (error) {
        console.error(`[FAILED]   comment ${comment.id}: ${error}`);
        errors++;
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log("\n--- Summary ---");
  console.log(`Total comments found:  ${allComments.length}`);
  console.log(`Deletion targets:      ${targets.length}`);
  if (dryRun) {
    console.log(`Would delete:          ${targets.length} (pass --no-dry-run to delete)`);
  } else {
    console.log(`Deleted:               ${deleted}`);
    console.log(`Errors:                ${errors}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
