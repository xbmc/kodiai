/**
 * Nightly sync script for triage comment reactions.
 *
 * Polls GitHub reactions on recent triage comments and feeds them into
 * the Bayesian threshold learning system as a secondary signal.
 *
 * Usage:
 *   bun scripts/sync-triage-reactions.ts                # Sync last 30 days
 *   bun scripts/sync-triage-reactions.ts --days 7       # Sync last 7 days
 *   bun scripts/sync-triage-reactions.ts --dry-run      # Fetch and log, don't store
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
import { recordObservation } from "../src/triage/threshold-learner.ts";
import type { Sql } from "../src/db/client.ts";
import type { Logger } from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

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

// ── Parse arguments ─────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    days: { type: "string", default: "30" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: bun scripts/sync-triage-reactions.ts [options]

Options:
  --days <number>       Look-back window in days (default: 30)
  --dry-run             Fetch and log but don't store
  --help                Show this help

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
  GITHUB_APP_ID         GitHub App ID (required)
  GITHUB_PRIVATE_KEY    GitHub App private key (required)
`);
  process.exit(0);
}

const lookbackDays = parseInt(values.days!, 10) || 30;
const dryRun = values["dry-run"]!;

// ── Reaction filtering ──────────────────────────────────────────────────────

type ReactionEntry = {
  id: number;
  content: string;
  user?: { login?: string; type?: string } | null;
};

function normalizeLogin(login: string | undefined): string {
  return (login ?? "").trim().toLowerCase().replace(/\[bot\]$/i, "");
}

function isHumanThumbReaction(reaction: ReactionEntry, appSlug: string): boolean {
  if (reaction.content !== "+1" && reaction.content !== "-1") return false;

  const userType = (reaction.user?.type ?? "").toLowerCase();
  if (userType === "bot") return false;

  const reactorLogin = normalizeLogin(reaction.user?.login);
  if (reactorLogin.length === 0) return false;
  if (reactorLogin === normalizeLogin(appSlug)) return false;

  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Initialize database
  const db = createDbClient({ logger });
  const { sql } = db;

  try {
    await runMigrations(sql);

    // 2. Initialize GitHub App
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
        slackDefaultRepo: "xbmc/xbmc",
        slackAssistantModel: "unused",
        port: 0,
        logLevel: "info",
        botAllowList: [],
      },
      logger,
    );
    await githubApp.initialize();
    const appSlug = githubApp.getAppSlug();

    // 3. Query triage records with comment_github_id from the lookback window
    const triageRecords = await sql`
      SELECT
        ts.id AS triage_id,
        ts.repo,
        ts.issue_number,
        ts.comment_github_id,
        ts.duplicate_count
      FROM issue_triage_state ts
      WHERE ts.comment_github_id IS NOT NULL
        AND ts.triaged_at > now() - make_interval(days => ${lookbackDays})
      ORDER BY ts.repo, ts.issue_number
    `;

    logger.info(
      { triageCount: triageRecords.length, lookbackDays, dryRun },
      "Fetched triage records for reaction sync",
    );

    if (triageRecords.length === 0) {
      logger.info("No triage records with comment IDs found, nothing to sync");
      return;
    }

    // 4. Group by repo for efficient octokit reuse
    const byRepo = new Map<string, typeof triageRecords>();
    for (const record of triageRecords) {
      const repo = record.repo as string;
      if (!byRepo.has(repo)) byRepo.set(repo, []);
      byRepo.get(repo)!.push(record);
    }

    let synced = 0;
    let observationsRecorded = 0;
    let skippedNoReactions = 0;
    let skippedAmbiguous = 0;
    let skippedAlreadyRecorded = 0;
    let skippedClosureExists = 0;
    let errors = 0;

    // 5. Process each repo
    for (const [repo, records] of byRepo) {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        logger.warn({ repo }, "Invalid repo format, skipping");
        continue;
      }

      let octokit;
      try {
        const ctx = await githubApp.getRepoInstallationContext(owner, repoName);
        if (!ctx) {
          logger.warn({ repo }, "No installation found for repo, skipping");
          continue;
        }
        octokit = await githubApp.getInstallationOctokit(ctx.installationId);
      } catch (err) {
        logger.error({ err, repo }, "Failed to get octokit for repo, skipping");
        errors++;
        continue;
      }

      for (const record of records) {
        const commentGithubId = record.comment_github_id as number;
        const issueNumber = record.issue_number as number;
        const triageId = record.triage_id as number;

        try {
          // 5a. Fetch reactions on the triage comment
          const response = await octokit.rest.reactions.listForIssueComment({
            owner,
            repo: repoName,
            comment_id: commentGithubId,
            per_page: 100,
          });

          // 5b. Filter to human thumbs reactions
          const humanReactions = response.data.filter((r: any) =>
            isHumanThumbReaction(r as ReactionEntry, appSlug),
          );

          const thumbsUp = humanReactions.filter((r: any) => r.content === "+1").length;
          const thumbsDown = humanReactions.filter((r: any) => r.content === "-1").length;

          logger.debug(
            { repo, issueNumber, commentGithubId, thumbsUp, thumbsDown, totalReactions: response.data.length },
            "Fetched reactions for triage comment",
          );

          if (dryRun) {
            logger.info(
              { repo, issueNumber, thumbsUp, thumbsDown },
              "[DRY RUN] Would sync reaction counts",
            );
            synced++;
            continue;
          }

          // 5c. UPSERT reaction counts
          await sql`
            INSERT INTO triage_comment_reactions (
              repo, issue_number, triage_id, comment_github_id,
              thumbs_up, thumbs_down, synced_at
            )
            VALUES (
              ${repo}, ${issueNumber}, ${triageId}, ${commentGithubId},
              ${thumbsUp}, ${thumbsDown}, now()
            )
            ON CONFLICT (repo, issue_number) DO UPDATE SET
              thumbs_up = ${thumbsUp},
              thumbs_down = ${thumbsDown},
              synced_at = now()
          `;

          synced++;

          // 5d. Determine if we should record a threshold observation
          const shouldRecord = await shouldRecordObservation({
            sql,
            repo,
            issueNumber,
            thumbsUp,
            thumbsDown,
            logger,
          });

          if (!shouldRecord.record) {
            switch (shouldRecord.reason) {
              case "no_reactions": skippedNoReactions++; break;
              case "ambiguous": skippedAmbiguous++; break;
              case "already_recorded": skippedAlreadyRecorded++; break;
              case "closure_exists": skippedClosureExists++; break;
            }
            continue;
          }

          // 5e. Record observation into threshold learner
          // kodiaiPredictedDuplicate is always true (triage comment exists = duplicates were found)
          const confirmedDuplicate = shouldRecord.direction === "up";

          await recordObservation({
            sql,
            repo,
            kodiaiPredictedDuplicate: true,
            confirmedDuplicate,
            logger,
          });

          // 5f. Mark observation as recorded with direction
          await sql`
            UPDATE triage_comment_reactions
            SET observation_recorded = true,
                observation_direction = ${shouldRecord.direction}
            WHERE repo = ${repo} AND issue_number = ${issueNumber}
          `;

          observationsRecorded++;

          logger.info(
            { repo, issueNumber, thumbsUp, thumbsDown, direction: shouldRecord.direction, confirmedDuplicate },
            "Reaction-based threshold observation recorded",
          );
        } catch (err) {
          logger.error(
            { err, repo, issueNumber, commentGithubId },
            "Failed to sync reactions for triage comment (non-fatal)",
          );
          errors++;
        }
      }
    }

    logger.info(
      {
        synced,
        observationsRecorded,
        skippedNoReactions,
        skippedAmbiguous,
        skippedAlreadyRecorded,
        skippedClosureExists,
        errors,
        totalTriageRecords: triageRecords.length,
      },
      "Reaction sync complete",
    );
  } finally {
    await db.close();
  }
}

// ── Observation decision logic ──────────────────────────────────────────────

type ObservationDecision =
  | { record: false; reason: "no_reactions" | "ambiguous" | "already_recorded" | "closure_exists" }
  | { record: true; direction: "up" | "down" };

async function shouldRecordObservation(params: {
  sql: Sql;
  repo: string;
  issueNumber: number;
  thumbsUp: number;
  thumbsDown: number;
  logger: Logger;
}): Promise<ObservationDecision> {
  const { sql, repo, issueNumber, thumbsUp, thumbsDown, logger: _logger } = params;

  // No reactions = no signal
  if (thumbsUp === 0 && thumbsDown === 0) {
    return { record: false, reason: "no_reactions" };
  }

  // Ambiguous = equal votes, skip
  if (thumbsUp === thumbsDown) {
    return { record: false, reason: "ambiguous" };
  }

  const direction: "up" | "down" = thumbsUp > thumbsDown ? "up" : "down";

  // Check if we already recorded an observation with the same direction
  const existing = await sql`
    SELECT observation_recorded, observation_direction
    FROM triage_comment_reactions
    WHERE repo = ${repo} AND issue_number = ${issueNumber}
  `;

  if (
    existing.length > 0 &&
    existing[0].observation_recorded === true &&
    existing[0].observation_direction === direction
  ) {
    return { record: false, reason: "already_recorded" };
  }

  // Check if a closure-based outcome already exists (primary signal takes precedence)
  const outcomeRows = await sql`
    SELECT id FROM issue_outcome_feedback
    WHERE repo = ${repo} AND issue_number = ${issueNumber}
  `;

  if (outcomeRows.length > 0) {
    return { record: false, reason: "closure_exists" };
  }

  return { record: true, direction };
}

main().catch((err) => {
  logger.fatal({ err }, "Reaction sync failed");
  process.exit(1);
});
