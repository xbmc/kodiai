import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import { loadRepoConfig } from "../execution/config.ts";
import {
  type MentionEvent,
  normalizeIssueComment,
  normalizeReviewComment,
  normalizeReviewBody,
  containsMention,
  stripMention,
} from "./mention-types.ts";
import {
  buildConversationContext,
  buildMentionPrompt,
} from "../execution/mention-prompt.ts";
import { classifyError, formatErrorComment, postOrUpdateErrorComment } from "../lib/errors.ts";
import { wrapInDetails } from "../lib/formatting.ts";

const TRACKING_INITIAL = [
  "> **Kodiai** is thinking...",
  "",
  "_Working on your request. This comment will be updated with the response._",
].join("\n");

/**
 * Create the mention handler and register it with the event router.
 *
 * Handles @kodiai mentions across all four comment surfaces:
 * - issue_comment.created (issues and PR general comments)
 * - pull_request_review_comment.created (inline diff comments)
 * - pull_request_review.submitted (review body)
 */
export function createMentionHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  workspaceManager: WorkspaceManager;
  githubApp: GitHubApp;
  executor: ReturnType<typeof createExecutor>;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, workspaceManager, githubApp, executor, logger } = deps;

  async function handleMention(event: WebhookEvent): Promise<void> {
    const appSlug = githubApp.getAppSlug();

    // Normalize payload based on event type
    let mention: MentionEvent;

    if (event.name === "issue_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeIssueComment(event.payload as unknown as IssueCommentCreatedEvent);
    } else if (event.name === "pull_request_review_comment") {
      if ((event.payload as Record<string, unknown>).action !== "created") return;
      mention = normalizeReviewComment(
        event.payload as unknown as PullRequestReviewCommentCreatedEvent,
      );
    } else if (event.name === "pull_request_review") {
      if ((event.payload as Record<string, unknown>).action !== "submitted") return;
      const payload = event.payload as unknown as PullRequestReviewSubmittedEvent;
      // Review body can be null (e.g. approval with no comment)
      if (!payload.review.body) return;
      mention = normalizeReviewBody(payload);
    } else {
      return;
    }

    // Check for @kodiai mention
    if (!containsMention(mention.commentBody, appSlug)) return;

    const userQuestion = stripMention(mention.commentBody, appSlug);

    logger.info(
      {
        surface: mention.surface,
        owner: mention.owner,
        repo: mention.repo,
        issueNumber: mention.issueNumber,
        prNumber: mention.prNumber,
        commentAuthor: mention.commentAuthor,
      },
      "Processing @kodiai mention",
    );

    // Add eyes reaction to trigger comment for immediate visual acknowledgment
    try {
      const reactionOctokit = await githubApp.getInstallationOctokit(event.installationId);
      if (mention.surface === "pr_review_comment") {
        await reactionOctokit.rest.reactions.createForPullRequestReviewComment({
          owner: mention.owner,
          repo: mention.repo,
          comment_id: mention.commentId,
          content: "eyes",
        });
      } else if (mention.surface === "pr_review_body") {
        // PR review bodies don't support reactions -- skip silently
        // (the review ID is not a comment ID, so the reaction endpoints would 404)
      } else {
        // issue_comment and pr_comment both use the issue comment reaction endpoint
        await reactionOctokit.rest.reactions.createForIssueComment({
          owner: mention.owner,
          repo: mention.repo,
          comment_id: mention.commentId,
          content: "eyes",
        });
      }
    } catch (err) {
      // Non-fatal: don't block processing if reaction fails
      logger.warn({ err, surface: mention.surface }, "Failed to add eyes reaction");
    }

    // Post tracking comment BEFORE enqueue (immediate user feedback)
    let trackingCommentId: number | undefined;
    try {
      const octokit = await githubApp.getInstallationOctokit(event.installationId);
      const { data: trackingComment } = await octokit.rest.issues.createComment({
        owner: mention.owner,
        repo: mention.repo,
        issue_number: mention.issueNumber,
        body: TRACKING_INITIAL,
      });
      trackingCommentId = trackingComment.id;
    } catch (err) {
      logger.error({ err }, "Failed to post tracking comment, continuing without tracking");
    }

    await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        // Determine clone parameters
        let cloneOwner = mention.owner;
        let cloneRepo = mention.repo;
        let cloneRef: string | undefined;
        let cloneDepth = 1;

        if (mention.prNumber !== undefined) {
          cloneDepth = 50; // PR mentions need diff context

          if (mention.headRef) {
            // Review comment or review body -- PR details available in payload
            cloneRef = mention.headRef;
            if (mention.headRepoOwner && mention.headRepoName) {
              cloneOwner = mention.headRepoOwner;
              cloneRepo = mention.headRepoName;
            }
          } else {
            // issue_comment on PR -- must fetch PR details (Pitfall 2)
            const { data: pr } = await octokit.rest.pulls.get({
              owner: mention.owner,
              repo: mention.repo,
              pull_number: mention.prNumber,
            });
            cloneRef = pr.head.ref;
            if (pr.head.repo) {
              cloneOwner = pr.head.repo.owner.login;
              cloneRepo = pr.head.repo.name;
            }
            // Populate mention with fetched data for context builder
            mention.headRef = pr.head.ref;
            mention.baseRef = pr.base.ref;
            mention.headRepoOwner = pr.head.repo?.owner.login;
            mention.headRepoName = pr.head.repo?.name;
          }
        } else {
          // Pure issue mention -- clone default branch
          const repoPayload = event.payload as Record<string, unknown>;
          const repository = repoPayload.repository as Record<string, unknown> | undefined;
          cloneRef = (repository?.default_branch as string) ?? "main";
        }

        // Clone workspace
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef!,
          depth: cloneDepth,
        });

        // Load repo config
        const config = await loadRepoConfig(workspace.dir);

        // Check mention.enabled
        if (!config.mention.enabled) {
          logger.info(
            { owner: mention.owner, repo: mention.repo },
            "Mentions disabled in config, skipping",
          );
          return;
        }

        // Build conversation context
        const conversationContext = await buildConversationContext(octokit, mention);

        // Build mention prompt
        const mentionPrompt = buildMentionPrompt({
          mention,
          conversationContext,
          userQuestion,
          trackingCommentId,
          customInstructions: config.mention.prompt,
        });

        // Execute via Claude
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: mention.owner,
          repo: mention.repo,
          prNumber: mention.prNumber,
          commentId: trackingCommentId,
          eventType: `${event.name}.${(event.payload as Record<string, unknown>).action as string}`,
          triggerBody: mention.commentBody,
          prompt: mentionPrompt,
        });

        logger.info(
          {
            surface: mention.surface,
            issueNumber: mention.issueNumber,
            conclusion: result.conclusion,
            costUsd: result.costUsd,
            numTurns: result.numTurns,
            durationMs: result.durationMs,
            sessionId: result.sessionId,
          },
          "Mention execution completed",
        );

        // If execution errored, post or update error comment with classified message
        if (result.conclusion === "error") {
          const category = result.isTimeout
            ? "timeout"
            : classifyError(new Error(result.errorMessage ?? "Unknown error"), false);
          const errorBody = wrapInDetails(
            formatErrorComment(
              category,
              result.errorMessage ?? "An unexpected error occurred while processing your request.",
            ),
            "Kodiai encountered an error",
          );
          const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
          await postOrUpdateErrorComment(errOctokit, {
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            trackingCommentId,
          }, errorBody, logger);
        }
      } catch (err) {
        logger.error(
          { err, surface: mention.surface, issueNumber: mention.issueNumber },
          "Mention handler failed",
        );

        // Post or update error comment with classified message
        const category = classifyError(err, false);
        const detail = err instanceof Error ? err.message : "An unexpected error occurred";
        const errorBody = wrapInDetails(formatErrorComment(category, detail), "Kodiai encountered an error");
        try {
          const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
          await postOrUpdateErrorComment(errOctokit, {
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            trackingCommentId,
          }, errorBody, logger);
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment");
        }
      } finally {
        if (workspace) {
          await workspace.cleanup();
        }
      }
    });
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
