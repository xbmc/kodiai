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
import { isHumanThumbReaction, type ReactionEntry } from "../src/lib/github-reactions.ts";
import { syncTriageReactionRecords, syncTriageReactionRepos } from "./triage-reaction-sync.ts";

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
const TRIAGE_RECORD_PAGE_SIZE = 250;

type TriageReactionRecord = {
  triage_id: number;
  repo: string;
  issue_number: number;
  comment_github_id: number;
  duplicate_count: number | null;
  observation_recorded: boolean;
  observation_direction: "up" | "down" | null;
  closure_exists: boolean;
};

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
      slackWebhookRelaySources: [],
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
    const appSlug = githubApp.getAppSlug();

    async function fetchTriageRecordPage(cursor: {
      repo: string | null;
      issueNumber: number | null;
    }): Promise<TriageReactionRecord[]> {
      const rows = await sql`
      SELECT
        ts.id AS triage_id,
        ts.repo,
        ts.issue_number,
        ts.comment_github_id,
        ts.duplicate_count,
        COALESCE(tcr.observation_recorded, false) AS observation_recorded,
        tcr.observation_direction,
        (outcome.id IS NOT NULL) AS closure_exists
      FROM issue_triage_state ts
      LEFT JOIN triage_comment_reactions tcr
        ON tcr.repo = ts.repo
       AND tcr.issue_number = ts.issue_number
      LEFT JOIN LATERAL (
        SELECT id
        FROM issue_outcome_feedback
        WHERE repo = ts.repo
          AND issue_number = ts.issue_number
        LIMIT 1
      ) outcome ON true
      WHERE ts.comment_github_id IS NOT NULL
        AND ts.triaged_at > now() - make_interval(days => ${lookbackDays})
        AND (
          ${cursor.repo}::text IS NULL
          OR (ts.repo, ts.issue_number) > (${cursor.repo}::text, ${cursor.issueNumber}::int)
        )
      ORDER BY ts.repo, ts.issue_number
      LIMIT ${TRIAGE_RECORD_PAGE_SIZE}
    `;
      return rows as unknown as TriageReactionRecord[];
    }

    let totalTriageRecords = 0;
    let synced = 0;
    let observationsRecorded = 0;
    let skippedNoReactions = 0;
    let skippedAmbiguous = 0;
    let skippedAlreadyRecorded = 0;
    let skippedClosureExists = 0;
    let errors = 0;

    async function processRepoRecords([repo, records]: [string, TriageReactionRecord[]]): Promise<void> {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        logger.warn({ repo }, "Invalid repo format, skipping");
        return;
      }

      let octokit;
      try {
        const ctx = await githubApp.getRepoInstallationContext(owner, repoName);
        if (!ctx) {
          logger.warn({ repo }, "No installation found for repo, skipping");
          return;
        }
        octokit = await githubApp.getInstallationOctokit(ctx.installationId);
      } catch (err) {
        logger.error({ err, repo }, "Failed to get octokit for repo, skipping");
        errors++;
        return;
      }

      await syncTriageReactionRecords(records, async (record) => {
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
            return;
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
            thumbsUp,
            thumbsDown,
            existingObservationRecorded: record.observation_recorded === true,
            existingObservationDirection: record.observation_direction as "up" | "down" | null,
            closureExists: record.closure_exists === true,
          });

          if (!shouldRecord.record) {
            switch (shouldRecord.reason) {
              case "no_reactions": skippedNoReactions++; break;
              case "ambiguous": skippedAmbiguous++; break;
              case "already_recorded": skippedAlreadyRecorded++; break;
              case "closure_exists": skippedClosureExists++; break;
            }
            return;
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
      });
    }

    let cursor = { repo: null as string | null, issueNumber: null as number | null };
    while (true) {
      const triageRecords = await fetchTriageRecordPage(cursor);
      if (triageRecords.length === 0) {
        break;
      }

      totalTriageRecords += triageRecords.length;
      logger.info(
        { triageCount: triageRecords.length, totalTriageRecords, lookbackDays, dryRun },
        "Fetched triage record page for reaction sync",
      );

      const byRepo = new Map<string, TriageReactionRecord[]>();
      for (const record of triageRecords) {
        const repo = record.repo;
        if (!byRepo.has(repo)) byRepo.set(repo, []);
        byRepo.get(repo)!.push(record);
      }

      // Process repos with small bounded concurrency. Each repo still uses
      // record-level bounded concurrency, so keep this cap conservative.
      await syncTriageReactionRepos(Array.from(byRepo), processRepoRecords);

      const lastRecord = triageRecords[triageRecords.length - 1]!;
      cursor = { repo: lastRecord.repo, issueNumber: lastRecord.issue_number };
    }

    if (totalTriageRecords === 0) {
      logger.info("No triage records with comment IDs found, nothing to sync");
      return;
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
        totalTriageRecords,
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
  thumbsUp: number;
  thumbsDown: number;
  existingObservationRecorded: boolean;
  existingObservationDirection: "up" | "down" | null;
  closureExists: boolean;
}): Promise<ObservationDecision> {
  const {
    thumbsUp,
    thumbsDown,
    existingObservationRecorded,
    existingObservationDirection,
    closureExists,
  } = params;

  // No reactions = no signal
  if (thumbsUp === 0 && thumbsDown === 0) {
    return { record: false, reason: "no_reactions" };
  }

  // Ambiguous = equal votes, skip
  if (thumbsUp === thumbsDown) {
    return { record: false, reason: "ambiguous" };
  }

  const direction: "up" | "down" = thumbsUp > thumbsDown ? "up" : "down";

  if (existingObservationRecorded && existingObservationDirection === direction) {
    return { record: false, reason: "already_recorded" };
  }

  // Check if a closure-based outcome already exists (primary signal takes precedence)
  if (closureExists) {
    return { record: false, reason: "closure_exists" };
  }

  return { record: true, direction };
}

main().catch((err) => {
  logger.fatal({ err }, "Reaction sync failed");
  process.exit(1);
});
