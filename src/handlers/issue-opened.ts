/**
 * Handler for issues.opened webhook events.
 *
 * Triggers auto-triage with duplicate detection when autoTriageOnOpen is enabled.
 * Uses four-layer idempotency:
 *   Layer 1: Delivery ID dedup (handled by webhook route's Deduplicator)
 *   Layer 2: Atomic DB INSERT ... ON CONFLICT with cooldown window
 *   Layer 3: Comment marker scan fallback
 *   Layer 4: Per-issue cooldown via triage.cooldownMinutes config (default: 30min)
 *
 * This is a SEPARATE handler file per project constraint:
 * "issue-opened.ts must be a separate handler, not added to the 2000+ line mention handler"
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { RepoConfig } from "../execution/config.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { findDuplicateCandidates } from "../triage/duplicate-detector.ts";
import { getEffectiveThreshold } from "../triage/threshold-learner.ts";
import {
  formatTriageComment,
  buildTriageMarker,
  TRIAGE_MARKER_PREFIX,
} from "../triage/triage-comment.ts";
import type { WorkspaceManager } from "../jobs/types.ts";

export function createIssueOpenedHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  workspaceManager: WorkspaceManager;
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  sql: Sql;
  logger: Logger;
}): void {
  const {
    eventRouter,
    jobQueue,
    githubApp,
    workspaceManager,
    issueStore,
    embeddingProvider,
    sql,
    logger,
  } = deps;

  async function handleIssueOpened(event: WebhookEvent): Promise<void> {
    try {
      // 1. Extract issue from payload
      const payload = event.payload as {
        issue?: {
          number: number;
          title: string;
          body: string | null;
          user?: { login: string };
        };
        repository?: {
          full_name: string;
          name: string;
          owner?: { login: string };
          default_branch?: string;
        };
      };

      const issue = payload.issue;
      const repository = payload.repository;

      if (!issue || !repository || !repository.owner) {
        logger.debug({ deliveryId: event.id }, "Missing issue or repo in payload");
        return;
      }

      const repo = repository.full_name;
      const owner = repository.owner.login;
      const repoName = repository.name;
      const issueNumber = issue.number;
      const defaultBranch = repository.default_branch ?? "main";

      const handlerLogger = logger.child({
        handler: "issue-opened",
        repo,
        issueNumber,
        deliveryId: event.id,
      });

      // 2. Load repo config via workspace clone
      let config: RepoConfig;
      let workspace: Awaited<ReturnType<WorkspaceManager["create"]>> | null = null;
      try {
        workspace = await workspaceManager.create(event.installationId, {
          owner,
          repo: repoName,
          ref: defaultBranch,
          depth: 1,
        });
        const { config: loadedConfig } = await loadRepoConfig(workspace.dir);
        config = loadedConfig;
      } catch (err) {
        handlerLogger.warn({ err }, "Failed to load repo config, using defaults");
        config = {} as RepoConfig;
        // Without config we can't determine if triage is enabled, bail
        if (workspace) await workspace.cleanup();
        return;
      }

      // Clean up workspace immediately -- we only needed the config
      if (workspace) await workspace.cleanup();

      // 3. Check triage.enabled and autoTriageOnOpen
      if (!config.triage?.enabled) {
        handlerLogger.debug("Triage disabled, skipping");
        return;
      }

      if (!config.triage?.autoTriageOnOpen) {
        handlerLogger.debug("autoTriageOnOpen disabled, skipping");
        return;
      }

      const octokit = await githubApp.getInstallationOctokit(event.installationId);

      // Layer 3 idempotency: Comment marker scan fallback
      try {
        const { data: comments } = await octokit.rest.issues.listComments({
          owner,
          repo: repoName,
          issue_number: issueNumber,
          per_page: 10,
        });
        const alreadyTriaged = comments.some(
          (c) => c.body && c.body.includes(TRIAGE_MARKER_PREFIX),
        );
        if (alreadyTriaged) {
          handlerLogger.info("Triage comment already exists (marker found), skipping");
          return;
        }
      } catch (err) {
        // Fail-open: if we can't check comments, continue to DB claim
        handlerLogger.warn({ err }, "Comment scan failed (fail-open, continuing to DB claim)");
      }

      // Layer 2 idempotency: Atomic DB claim with cooldown window
      const cooldownMinutes = config.triage.cooldownMinutes ?? 30;
      const claimed = await claimIssueTriage(sql, repo, issueNumber, event.id, cooldownMinutes);
      if (!claimed) {
        handlerLogger.info("Issue already triaged within cooldown window (DB claim failed), skipping");
        return;
      }

      // 5. Resolve effective threshold (Bayesian learned or config fallback)
      let effectiveThreshold: number;
      try {
        const thresholdResult = await getEffectiveThreshold({
          sql,
          repo,
          configThreshold: config.triage.duplicateThreshold ?? 75,
          logger: handlerLogger,
        });
        effectiveThreshold = thresholdResult.threshold;

        // Structured logging on threshold resolution (LEARN-04)
        handlerLogger.info({
          thresholdSource: thresholdResult.source,
          effectiveThreshold: thresholdResult.threshold,
          configThreshold: config.triage.duplicateThreshold ?? 75,
          ...(thresholdResult.source === "learned" ? {
            alpha: thresholdResult.alpha,
            beta: thresholdResult.beta,
            sampleCount: thresholdResult.sampleCount,
          } : {}),
        }, "Duplicate detection threshold resolved");
      } catch (err) {
        // Fail-open: if threshold learning fails, use config value
        effectiveThreshold = config.triage.duplicateThreshold ?? 75;
        handlerLogger.warn({ err }, "Threshold learning failed, using config fallback");
      }

      // 6. Run duplicate detection
      const candidates = await findDuplicateCandidates({
        issueStore,
        embeddingProvider,
        title: issue.title,
        body: issue.body,
        repo,
        excludeIssueNumber: issueNumber,
        threshold: effectiveThreshold,
        maxCandidates: config.triage.maxDuplicateCandidates ?? 3,
        logger: handlerLogger,
      });

      // 7. Check results: if no candidates, no comment (zero noise)
      if (candidates.length === 0) {
        handlerLogger.info("No duplicate candidates found, skipping comment");
        return;
      }

      // 8. Format comment
      const marker = buildTriageMarker(repo, issueNumber);
      const commentBody = formatTriageComment(candidates, marker);

      // 9. Post comment
      const commentResponse = await octokit.rest.issues.createComment({
        owner,
        repo: repoName,
        issue_number: issueNumber,
        body: commentBody,
      });

      // 9b. Store the comment GitHub ID for future reaction tracking (REACT-01)
      try {
        await sql`
          UPDATE issue_triage_state
          SET comment_github_id = ${commentResponse.data.id}
          WHERE repo = ${repo} AND issue_number = ${issueNumber}
        `;
      } catch (err) {
        handlerLogger.warn({ err, commentGithubId: commentResponse.data.id }, "Failed to store comment GitHub ID (non-fatal)");
      }

      // 10. Apply label (fail-open)
      const duplicateLabel = config.triage.duplicateLabel ?? "possible-duplicate";
      try {
        await octokit.rest.issues.addLabels({
          owner,
          repo: repoName,
          issue_number: issueNumber,
          labels: [duplicateLabel],
        });
      } catch (err) {
        handlerLogger.warn({ err, label: duplicateLabel }, "Failed to apply duplicate label (continuing)");
      }

      // 11. Update triage state with duplicate count
      try {
        await sql`
          UPDATE issue_triage_state
          SET duplicate_count = ${candidates.length}
          WHERE repo = ${repo} AND issue_number = ${issueNumber}
        `;
      } catch (err) {
        handlerLogger.warn({ err }, "Failed to update triage state duplicate count");
      }

      // 12. Log completion
      handlerLogger.info(
        { candidateCount: candidates.length },
        "Issue triage complete",
      );
    } catch (err) {
      logger.error(
        { err, deliveryId: event.id },
        "Issue opened handler failed (non-fatal)",
      );
    }
  }

  eventRouter.register("issues.opened", handleIssueOpened);
}

/**
 * Atomically claim an issue for triage with cooldown enforcement.
 * Returns true if claimed (we should process), false if already claimed within cooldown window.
 *
 * Uses INSERT ... ON CONFLICT DO UPDATE with a WHERE clause that only updates
 * if the previous triage is older than cooldownMinutes. This is atomic and
 * prevents re-triage within the cooldown window even under concurrent delivery.
 */
async function claimIssueTriage(
  sql: Sql,
  repo: string,
  issueNumber: number,
  deliveryId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  const result = await sql`
    INSERT INTO issue_triage_state (repo, issue_number, delivery_id)
    VALUES (${repo}, ${issueNumber}, ${deliveryId})
    ON CONFLICT (repo, issue_number) DO UPDATE
      SET delivery_id = ${deliveryId},
          triaged_at = now(),
          duplicate_count = 0
      WHERE issue_triage_state.triaged_at < now() - ${cooldownMinutes + ' minutes'}::interval
    RETURNING id
  `;
  return result.length > 0;
}
