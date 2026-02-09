import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { buildReviewPrompt } from "../execution/review-prompt.ts";
import { classifyError, formatErrorComment, postOrUpdateErrorComment } from "../lib/errors.ts";
import {
  buildReviewOutputKey,
  ensureReviewOutputNotPublished,
} from "./review-idempotency.ts";
import { $ } from "bun";

function isReviewTriggerEnabled(
  action: string,
  triggers: {
    onOpened: boolean;
    onReadyForReview: boolean;
    onReviewRequested: boolean;
  },
): boolean {
  if (action === "opened") return triggers.onOpened;
  if (action === "ready_for_review") return triggers.onReadyForReview;
  if (action === "review_requested") return triggers.onReviewRequested;
  return false;
}

function normalizeReviewerLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/i, "");
}

/**
 * Create the review handler and register it with the event router.
 *
 * Handles `pull_request.opened`, `pull_request.ready_for_review`, and
 * `pull_request.review_requested` events.
 *
 * Trigger model: initial review events plus explicit re-request only.
 * Re-requested reviews run only when kodiai itself is the requested reviewer.
 * Clones the repo, builds a review prompt, runs Claude via the executor,
 * and optionally submits a silent approval if no issues were found.
 */
export function createReviewHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, workspaceManager, githubApp, executor, logger } = deps;

  async function handleReview(event: WebhookEvent): Promise<void> {
    const payload = event.payload as unknown as
      | PullRequestOpenedEvent
      | PullRequestReadyForReviewEvent
      | PullRequestReviewRequestedEvent;

    const pr = payload.pull_request;
    const action = payload.action;
    const baseLog = {
      deliveryId: event.id,
      installationId: event.installationId,
      action,
      prNumber: pr.number,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
    };
    const reviewOutputKey = buildReviewOutputKey({
      installationId: event.installationId,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: pr.number,
      action,
      deliveryId: event.id,
      headSha: pr.head.sha ?? "unknown-head-sha",
    });

    // Skip draft PRs (the opened event fires for drafts too)
    if (pr.draft) {
      logger.debug(
        baseLog,
        "Skipping draft PR",
      );
      return;
    }

    if (action === "review_requested") {
      const reviewRequestedPayload = payload as PullRequestReviewRequestedEvent;
      const requestedReviewer =
        "requested_reviewer" in reviewRequestedPayload
          ? reviewRequestedPayload.requested_reviewer
          : undefined;
      const requestedTeam =
        "requested_team" in reviewRequestedPayload
          ? reviewRequestedPayload.requested_team
          : undefined;
      const requestedReviewerLogin =
        typeof requestedReviewer?.login === "string"
          ? requestedReviewer.login
          : undefined;
      const requestedTeamName =
        typeof requestedTeam?.name === "string"
          ? requestedTeam.name
          : undefined;
      const appSlug = githubApp.getAppSlug();
      const normalizedAppSlug = normalizeReviewerLogin(appSlug);

      if (requestedReviewerLogin) {
        const normalizedRequestedReviewer = normalizeReviewerLogin(requestedReviewerLogin);
        if (normalizedRequestedReviewer !== normalizedAppSlug) {
          logger.info(
            {
              ...baseLog,
              gate: "review_requested_reviewer",
              gateResult: "skipped",
              skipReason: "non-kodiai-reviewer",
              requestedReviewer: requestedReviewerLogin,
              normalizedRequestedReviewer,
              normalizedAppSlug,
              requestedTeam: requestedTeamName ?? null,
            },
            "Skipping review_requested event for non-kodiai reviewer",
          );
          return;
        }

        logger.info(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "accepted",
            requestedReviewer: requestedReviewerLogin,
            normalizedRequestedReviewer,
            normalizedAppSlug,
          },
          "Accepted review_requested event for kodiai reviewer",
        );
      } else if (requestedTeamName) {
        logger.info(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "skipped",
            skipReason: "team-only-request",
            requestedReviewer: null,
            requestedTeam: requestedTeamName,
          },
          "Skipping review_requested event because only a team was requested",
        );
        return;
      } else {
        logger.warn(
          {
            ...baseLog,
            gate: "review_requested_reviewer",
            gateResult: "skipped",
            skipReason: "missing-or-malformed-reviewer-payload",
            hasRequestedReviewerField: "requested_reviewer" in reviewRequestedPayload,
            hasRequestedTeamField: "requested_team" in reviewRequestedPayload,
          },
          "Skipping review_requested event due to missing reviewer payload",
        );
        return;
      }
    }

    // API target is always the base (upstream) repo
    const apiOwner = payload.repository.owner.login;
    const apiRepo = payload.repository.name;

    // Fork PR support: clone from head.repo (the fork), post comments to base repo
    const headRepo = pr.head.repo;
    const isFork = headRepo?.full_name !== payload.repository.full_name;

    let cloneOwner: string;
    let cloneRepo: string;
    let cloneRef: string;
    let usesPrRef = false;

    if (headRepo) {
      cloneOwner = headRepo.owner.login;
      cloneRepo = headRepo.name;
      cloneRef = pr.head.ref;
    } else {
      // Deleted fork -- fall back to PR ref from base repo
      cloneOwner = apiOwner;
      cloneRepo = apiRepo;
      cloneRef = pr.base.ref; // Clone base branch, then fetch PR ref
      usesPrRef = true;
    }

    logger.info(
      {
        prNumber: pr.number,
        apiOwner,
        apiRepo,
        cloneOwner,
        cloneRepo,
        cloneRef,
        isFork,
        usesPrRef,
        action,
        deliveryId: event.id,
        installationId: event.installationId,
      },
      "Processing PR review",
    );

    logger.info(
      { ...baseLog, gate: "enqueue", gateResult: "started" },
      "Review enqueue started",
    );

    await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      try {
        // Create workspace with depth 50 for diff context
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef,
          depth: 50,
        });

        // Handle deleted fork: fetch PR ref from base repo
        if (usesPrRef) {
          await $`git -C ${workspace.dir} fetch origin pull/${pr.number}/head:pr-review`.quiet();
          await $`git -C ${workspace.dir} checkout pr-review`.quiet();
        }

        // Fetch base branch so git diff origin/BASE...HEAD works.
        // Explicit refspec needed because --single-branch clones don't track other branches.
        await $`git -C ${workspace.dir} fetch origin ${pr.base.ref}:refs/remotes/origin/${pr.base.ref} --depth=1`.quiet();

        // Load repo config (.kodiai.yml) with defaults
        const config = await loadRepoConfig(workspace.dir);

        logger.info(
          {
            ...baseLog,
            gate: "trigger-config",
            reviewEnabled: config.review.enabled,
            triggers: config.review.triggers,
          },
          "Evaluating review trigger configuration",
        );

        // Check review.enabled
        if (!config.review.enabled) {
          logger.info(
            {
              ...baseLog,
              gate: "review-enabled",
              gateResult: "skipped",
              skipReason: "review-disabled",
              apiOwner,
              apiRepo,
            },
            "Review disabled in config, skipping",
          );
          return;
        }

        // Check whether this event action is enabled in review.triggers
        if (!isReviewTriggerEnabled(action, config.review.triggers)) {
          logger.info(
            {
              ...baseLog,
              gate: "review-trigger",
              gateResult: "skipped",
              skipReason: "trigger-disabled",
              triggers: config.review.triggers,
            },
            "Review trigger disabled in config, skipping",
          );
          return;
        }

        const idempotencyOctokit = await githubApp.getInstallationOctokit(event.installationId);
        const idempotencyCheck = await ensureReviewOutputNotPublished({
          octokit: idempotencyOctokit,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          reviewOutputKey,
        });

        if (!idempotencyCheck.shouldPublish) {
          logger.info(
            {
              ...baseLog,
              gate: "review-output-idempotency",
              gateResult: "skipped",
              skipReason: "already-published",
              reviewOutputKey,
              existingLocation: idempotencyCheck.existingLocation,
            },
            "Skipping review execution because output already published for key",
          );
          return;
        }

        logger.info(
          {
            ...baseLog,
            gate: "review-output-idempotency",
            gateResult: "accepted",
            reviewOutputKey,
          },
          "Review output idempotency check passed",
        );

        // Add eyes reaction to PR description for immediate acknowledgment
        try {
          const reactionOctokit = await githubApp.getInstallationOctokit(event.installationId);
          await reactionOctokit.rest.reactions.createForIssue({
            owner: apiOwner,
            repo: apiRepo,
            issue_number: pr.number,
            content: "eyes",
          });
        } catch (err) {
          // Non-fatal: don't block processing if reaction fails
          logger.warn({ err, prNumber: pr.number }, "Failed to add eyes reaction to PR");
        }

        // Check skipAuthors
        if (config.review.skipAuthors.includes(pr.user.login)) {
          logger.info(
            { prNumber: pr.number, author: pr.user.login },
            "PR author in skipAuthors, skipping review",
          );
          return;
        }

        // Build changed files list, filtering out skipPaths
        const diffOutput =
          await $`git -C ${workspace.dir} diff origin/${pr.base.ref}...HEAD --name-only`.quiet();
        const allChangedFiles = diffOutput.text().trim().split("\n").filter(Boolean);

        const changedFiles = allChangedFiles.filter((file) => {
          return !config.review.skipPaths.some((pattern) => {
            // Directory pattern (ends with /): file starts with pattern
            if (pattern.endsWith("/")) {
              return file.startsWith(pattern);
            }
            // Extension pattern (starts with *.): file ends with suffix
            if (pattern.startsWith("*.")) {
              return file.endsWith(pattern.slice(1));
            }
            // Exact match or suffix match
            return file === pattern || file.endsWith(pattern);
          });
        });

        if (changedFiles.length === 0) {
          logger.info(
            { prNumber: pr.number, totalFiles: allChangedFiles.length },
            "All changed files matched skipPaths, skipping review",
          );
          return;
        }

        // Build review prompt
        const reviewPrompt = buildReviewPrompt({
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          prTitle: pr.title,
          prBody: pr.body ?? "",
          prAuthor: pr.user.login,
          baseBranch: pr.base.ref,
          headBranch: pr.head.ref,
          changedFiles,
          customInstructions: config.review.prompt,
        });

        // Execute review via Claude
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: apiOwner,
          repo: apiRepo,
          prNumber: pr.number,
          commentId: undefined,
          eventType: `pull_request.${payload.action}`,
          triggerBody: reviewPrompt,
          prompt: reviewPrompt,
          reviewOutputKey,
          deliveryId: event.id,
        });

        logger.info(
          {
            prNumber: pr.number,
            conclusion: result.conclusion,
            costUsd: result.costUsd,
            numTurns: result.numTurns,
            durationMs: result.durationMs,
            sessionId: result.sessionId,
          },
          "Review execution completed",
        );

        // Post error comment if execution failed or timed out
        if (result.conclusion === "error") {
          const category = result.isTimeout
            ? "timeout"
            : classifyError(new Error(result.errorMessage ?? "Unknown error"), false);
          const errorBody = formatErrorComment(
            category,
            result.errorMessage ?? "An unexpected error occurred during review.",
          );
          const octokit = await githubApp.getInstallationOctokit(event.installationId);
          await postOrUpdateErrorComment(octokit, {
            owner: apiOwner,
            repo: apiRepo,
            issueNumber: pr.number,
          }, errorBody, logger);
        }

        // Silent approval: only when autoApprove is enabled and execution succeeded
        if (config.review.autoApprove && result.conclusion === "success") {
          try {
            const octokit = await githubApp.getInstallationOctokit(event.installationId);
            const appSlug = githubApp.getAppSlug();

            // Check for bot inline comments on this PR
            const { data: comments } = await octokit.rest.pulls.listReviewComments({
              owner: apiOwner,
              repo: apiRepo,
              pull_number: pr.number,
            });

            const botComments = comments.filter(
              (c) => c.user?.login === `${appSlug}[bot]`,
            );

            if (botComments.length === 0) {
              // No issues found -- submit silent approval
              await octokit.rest.pulls.createReview({
                owner: apiOwner,
                repo: apiRepo,
                pull_number: pr.number,
                event: "APPROVE",
                body: idempotencyCheck.marker,
              });
              logger.info(
                { prNumber: pr.number, reviewOutputKey },
                "Submitted silent approval (no issues found)",
              );
            } else {
              logger.info(
                { prNumber: pr.number, botCommentCount: botComments.length },
                "Issues found, skipping approval",
              );
            }
          } catch (err) {
            logger.error(
              { err, prNumber: pr.number },
              "Failed to submit approval",
            );
          }
        }
      } catch (err) {
        logger.error(
          { err, prNumber: pr.number },
          "Review handler failed",
        );

        // Post error comment to PR so the user knows something went wrong
        const category = classifyError(err, false);
        const detail = err instanceof Error ? err.message : "An unexpected error occurred";
        const errorBody = formatErrorComment(category, detail);
        try {
          const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
          await postOrUpdateErrorComment(errOctokit, {
            owner: apiOwner,
            repo: apiRepo,
            issueNumber: pr.number,
          }, errorBody, logger);
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment to PR");
        }
      } finally {
        if (workspace) {
          await workspace.cleanup();
        }
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action,
      jobType: "pull-request-review",
      prNumber: pr.number,
    });

    logger.info(
      { ...baseLog, gate: "enqueue", gateResult: "completed" },
      "Review enqueue completed",
    );
  }

  // Register for review trigger events
  eventRouter.register("pull_request.opened", handleReview);
  eventRouter.register("pull_request.ready_for_review", handleReview);
  eventRouter.register("pull_request.review_requested", handleReview);
}
