import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const DEFAULT_TEAM = "ai-review";
const DEFAULT_ATTEMPTS = 45;
const DEFAULT_SLEEP_MS = 1_000;
const DEFAULT_KNOWLEDGE_DB_PATH = "./data/kodiai-knowledge.db";
const DEFAULT_TELEMETRY_DB_PATH = "./data/kodiai-telemetry.db";
const DEFAULT_LIMIT = 20;

type CliValues = {
  owner?: string;
  repo?: string;
  pr?: string;
  team?: string;
  attempts?: string;
  "sleep-ms"?: string;
  "knowledge-db"?: string;
  "telemetry-db"?: string;
  limit?: string;
  "dry-run"?: boolean;
  "skip-cache-clear"?: boolean;
  verbose?: boolean;
  help?: boolean;
};

type DegradedRow = {
  delivery_id: string;
  event_type: string;
  degradation_path: string;
  retry_attempts: number;
  created_at: string;
};

function printUsage(): void {
  console.log(`Phase 73 degraded-search trigger helper

Triggers repeated review_requested events to induce Search rate-limit degradation,
while clearing author cache between runs.

Usage:
  bun scripts/phase73-trigger-degraded-review.ts \\
    --owner <owner> --repo <repo> --pr <number> [options]

Required:
  --owner <value>                 GitHub owner/org
  --repo <value>                  GitHub repo name
  --pr <number>                   Pull request number

Options:
  --team <value>                  Team reviewer slug (default: ${DEFAULT_TEAM})
  --attempts <number>             Trigger iterations (default: ${DEFAULT_ATTEMPTS})
  --sleep-ms <number>             Delay between iterations (default: ${DEFAULT_SLEEP_MS})
  --knowledge-db <path>           Knowledge DB path (default: ${DEFAULT_KNOWLEDGE_DB_PATH})
  --telemetry-db <path>           Telemetry DB path (default: ${DEFAULT_TELEMETRY_DB_PATH})
  --limit <number>                Number of degraded rows to print (default: ${DEFAULT_LIMIT})
  --dry-run                       Print actions without mutating state
  --skip-cache-clear              Skip author_cache delete (use if knowledge DB unavailable)
  --verbose                       Print per-iteration command details
  -h, --help                      Show help

Examples:
  bun run trigger:phase73:degraded --owner kodiai --repo xbmc --pr 123
  bun run trigger:phase73:degraded --owner xbmc --repo kodiai --pr 42 --attempts 60 --sleep-ms 500`);
}

function requireNumber(raw: string | undefined, field: string, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function runGh(args: string[], options: { allowFailure?: boolean; verbose?: boolean } = {}): string {
  if (options.verbose) {
    console.log(`$ gh ${args.join(" ")}`);
  }

  const out = spawnSync("gh", args, { encoding: "utf8" });
  const stdout = out.stdout?.trim() ?? "";
  const stderr = out.stderr?.trim() ?? "";

  if (out.status !== 0 && !options.allowFailure) {
    const reason = stderr || stdout || "unknown gh error";
    throw new Error(`gh ${args[0] ?? ""} failed: ${reason}`);
  }

  return stdout;
}

function resolveAuthorLogin(owner: string, repo: string, pr: string, verbose: boolean): string {
  const output = runGh(["api", `repos/${owner}/${repo}/pulls/${pr}`, "--jq", ".user.login"], { verbose });
  if (!output) {
    throw new Error("Unable to resolve PR author login from GitHub API response");
  }
  return output;
}

function clearAuthorCache(knowledgeDbPath: string, repoSlug: string, authorLogin: string): void {
  const db = new Database(knowledgeDbPath);
  try {
    db.run(
      "DELETE FROM author_cache WHERE repo = ?1 AND author_login = ?2",
      [repoSlug, authorLogin],
    );
  } finally {
    db.close();
  }
}

function deleteRequestedTeam(owner: string, repo: string, pr: string, team: string, verbose: boolean): void {
  runGh(
    [
      "api",
      "-X",
      "DELETE",
      `repos/${owner}/${repo}/pulls/${pr}/requested_reviewers`,
      "-f",
      "reviewers[]=",
      "-f",
      `team_reviewers[]=${team}`,
    ],
    { allowFailure: true, verbose },
  );
}

function addRequestedTeam(owner: string, repo: string, pr: string, team: string, verbose: boolean): void {
  runGh(
    [
      "api",
      "-X",
      "POST",
      `repos/${owner}/${repo}/pulls/${pr}/requested_reviewers`,
      "-f",
      `team_reviewers[]=${team}`,
    ],
    { verbose },
  );
}

function printLatestDegradedRows(
  telemetryDbPath: string,
  repoSlug: string,
  limit: number,
): DegradedRow[] {
  const db = new Database(telemetryDbPath, { readonly: true });
  try {
    const rows = db
      .query<DegradedRow, [string, number]>(
        `SELECT delivery_id, event_type, degradation_path, retry_attempts, created_at
         FROM rate_limit_events
         WHERE repo = ?1 AND degradation_path = 'search-api-rate-limit'
         ORDER BY created_at DESC
         LIMIT ?2`,
      )
      .all(repoSlug, limit);

    if (rows.length === 0) {
      console.log("\nNo degraded rows found yet for this repo.");
      return rows;
    }

    console.log("\nRecent degraded telemetry rows:");
    console.log("delivery_id | event_type | retry_attempts | created_at");
    for (const row of rows) {
      console.log(`${row.delivery_id} | ${row.event_type} | ${row.retry_attempts} | ${row.created_at}`);
    }
    return rows;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      owner: { type: "string" },
      repo: { type: "string" },
      pr: { type: "string" },
      team: { type: "string", default: DEFAULT_TEAM },
      attempts: { type: "string", default: String(DEFAULT_ATTEMPTS) },
      "sleep-ms": { type: "string", default: String(DEFAULT_SLEEP_MS) },
      "knowledge-db": { type: "string", default: DEFAULT_KNOWLEDGE_DB_PATH },
      "telemetry-db": { type: "string", default: DEFAULT_TELEMETRY_DB_PATH },
      limit: { type: "string", default: String(DEFAULT_LIMIT) },
      "dry-run": { type: "boolean", default: false },
      "skip-cache-clear": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const values = parsed.values as CliValues;
  if (values.help) {
    printUsage();
    return;
  }

  const owner = values.owner?.trim();
  const repo = values.repo?.trim();
  const pr = values.pr?.trim();
  const team = values.team?.trim() || DEFAULT_TEAM;
  const attempts = requireNumber(values.attempts, "--attempts", DEFAULT_ATTEMPTS);
  const sleepMs = requireNumber(values["sleep-ms"], "--sleep-ms", DEFAULT_SLEEP_MS);
  const limit = requireNumber(values.limit, "--limit", DEFAULT_LIMIT);
  const knowledgeDbPath = resolve(values["knowledge-db"] ?? DEFAULT_KNOWLEDGE_DB_PATH);
  const telemetryDbPath = resolve(values["telemetry-db"] ?? DEFAULT_TELEMETRY_DB_PATH);
  const dryRun = Boolean(values["dry-run"]);
  const skipCacheClear = Boolean(values["skip-cache-clear"]);
  const verbose = Boolean(values.verbose);

  if (!owner || !repo || !pr) {
    throw new Error("Missing required args. Provide --owner, --repo, and --pr.");
  }

  if (!/^\d+$/.test(pr)) {
    throw new Error("--pr must be a numeric pull request number");
  }

  if (!dryRun && !skipCacheClear && !existsSync(knowledgeDbPath)) {
    throw new Error(`Knowledge DB not found at ${knowledgeDbPath}`);
  }
  if (!existsSync(telemetryDbPath)) {
    throw new Error(`Telemetry DB not found at ${telemetryDbPath}`);
  }

  runGh(["--version"], { verbose: false });

  const repoSlug = `${owner}/${repo}`;
  const authorLogin = resolveAuthorLogin(owner, repo, pr, verbose);

  console.log(`Repo: ${repoSlug}`);
  console.log(`PR: #${pr}`);
  console.log(`Author: ${authorLogin}`);
  console.log(`Team trigger: ${team}`);
  console.log(
    `Attempts: ${attempts}, Sleep: ${sleepMs}ms${dryRun ? " (dry-run)" : ""}${skipCacheClear ? " (skip-cache-clear)" : ""}`,
  );

  for (let i = 1; i <= attempts; i += 1) {
    console.log(`\n[${i}/${attempts}] Triggering review_requested`);
    if (!dryRun) {
      if (!skipCacheClear) {
        clearAuthorCache(knowledgeDbPath, repoSlug, authorLogin);
      }
      deleteRequestedTeam(owner, repo, pr, team, verbose);
      addRequestedTeam(owner, repo, pr, team, verbose);
      await Bun.sleep(sleepMs);
    } else {
      if (!skipCacheClear) {
        console.log(`Would clear author_cache for ${repoSlug}:${authorLogin}`);
      } else {
        console.log("Would skip author_cache clear");
      }
      console.log(`Would DELETE requested_reviewers team ${team}`);
      console.log(`Would POST requested_reviewers team ${team}`);
    }
  }

  const rows = printLatestDegradedRows(telemetryDbPath, repoSlug, limit);
  console.log(
    rows.length > 0
      ? "\nNext: inspect latest published review summary and confirm exactly one 'Analysis is partial due to API limits.' line."
      : "\nNo degraded row observed yet. Increase --attempts, reduce --sleep-ms, or run against busier traffic windows.",
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Phase 73 trigger failed: ${message}`);
    process.exit(1);
  });
}
