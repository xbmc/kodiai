import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import { $ } from "bun";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import { loadRepoConfig } from "../execution/config.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
  getGitStatusPorcelain,
  createBranchCommitAndPush,
} from "../jobs/workspace.ts";
import {
  type MentionEvent,
  normalizeIssueComment,
  normalizeReviewComment,
  normalizeReviewBody,
  containsMention,
  stripMention,
} from "./mention-types.ts";
import { buildMentionContext } from "../execution/mention-context.ts";
import { buildMentionPrompt } from "../execution/mention-prompt.ts";
import { classifyError, formatErrorComment, postOrUpdateErrorComment } from "../lib/errors.ts";
import { wrapInDetails } from "../lib/formatting.ts";

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

  function parseWriteIntent(userQuestion: string): {
    writeIntent: boolean;
    keyword: "apply" | "change" | undefined;
    request: string;
  } {
    const trimmed = userQuestion.trimStart();
    const lower = trimmed.toLowerCase();

    for (const keyword of ["apply", "change"] as const) {
      const prefix = `${keyword}:`;
      if (lower.startsWith(prefix)) {
        return {
          writeIntent: true,
          keyword,
          request: trimmed.slice(prefix.length).trim(),
        };
      }
    }

    return { writeIntent: false, keyword: undefined, request: userQuestion.trim() };
  }

  async function handleMention(event: WebhookEvent): Promise<void> {
    const appSlug = githubApp.getAppSlug();
    const possibleHandles = [appSlug, "claude"];

    const action = (event.payload as Record<string, unknown>).action as string | undefined;

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

    // Fast filter: ignore if neither @appSlug nor @claude appear.
    // NOTE: Use a simple substring check here to avoid regex edge cases.
    // We still do the authoritative accepted-handles check inside the job after loading config.
    const bodyLower = mention.commentBody.toLowerCase();
    const appHandle = `@${appSlug.toLowerCase()}`;
    if (!bodyLower.includes(appHandle) && !bodyLower.includes("@claude")) return;

    // No tracking comment. Tracking is via eyes reaction only.
    // The response will be posted as a new comment.

    await jobQueue.enqueue(event.installationId, async () => {
      let workspace: Workspace | undefined;
      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        async function postMentionReply(replyBody: string): Promise<void> {
          const replyOctokit = await githubApp.getInstallationOctokit(event.installationId);

          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await replyOctokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: replyBody,
              });
              return;
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, commentId: mention.commentId },
                "Failed to post in-thread reply; falling back to top-level comment",
              );
            }
          }

          await replyOctokit.rest.issues.createComment({
            owner: mention.owner,
            repo: mention.repo,
            issue_number: mention.issueNumber,
            body: replyBody,
          });
        }

        async function postMentionError(errorBody: string): Promise<void> {
          const errOctokit = await githubApp.getInstallationOctokit(event.installationId);

          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await errOctokit.rest.pulls.createReplyForReviewComment({
                owner: mention.owner,
                repo: mention.repo,
                pull_number: mention.prNumber,
                comment_id: mention.commentId,
                body: errorBody,
              });
              return;
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, commentId: mention.commentId },
                "Failed to post in-thread error reply; falling back to top-level error comment",
              );
            }
          }

          await postOrUpdateErrorComment(
            errOctokit,
            {
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
            },
            errorBody,
            logger,
          );
        }

        // Determine clone parameters
        let cloneOwner = mention.owner;
        let cloneRepo = mention.repo;
        let cloneRef: string | undefined;
        let cloneDepth = 1;
        let usesPrRef = false;

        if (mention.prNumber !== undefined) {
          cloneDepth = 50; // PR mentions need diff context

          // Ensure PR details are available (issue_comment on PR requires a pulls.get fetch).
          if (!mention.baseRef || !mention.headRef) {
            const { data: pr } = await octokit.rest.pulls.get({
              owner: mention.owner,
              repo: mention.repo,
              pull_number: mention.prNumber,
            });
            mention.headRef = pr.head.ref;
            mention.baseRef = pr.base.ref;
            mention.headRepoOwner = pr.head.repo?.owner.login;
            mention.headRepoName = pr.head.repo?.name;
          }

          // Fork-safe workspace strategy: clone base repo at base ref, then fetch+checkout
          // refs/pull/<n>/head from the base repo.
          // This avoids relying on access to contributor forks and mirrors the review handler.
          cloneOwner = mention.owner;
          cloneRepo = mention.repo;
          cloneRef = mention.baseRef;
          usesPrRef = true;
        } else {
          // Pure issue mention -- clone default branch
          const repoPayload = event.payload as Record<string, unknown>;
          const repository = repoPayload.repository as Record<string, unknown> | undefined;
          cloneRef = (repository?.default_branch as string) ?? "main";
        }

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            cloneOwner,
            cloneRepo,
            cloneRef,
            cloneDepth,
            usesPrRef,
            workspaceStrategy: usesPrRef
              ? "base-clone+pull-ref-fetch"
              : "direct-branch-clone",
          },
          "Creating workspace for mention execution",
        );

        // Clone workspace
        workspace = await workspaceManager.create(event.installationId, {
          owner: cloneOwner,
          repo: cloneRepo,
          ref: cloneRef!,
          depth: cloneDepth,
        });

        // PR mentions: fetch and checkout PR head ref from base repo.
        if (usesPrRef && mention.prNumber !== undefined) {
          await fetchAndCheckoutPullRequestHeadRef({
            dir: workspace.dir,
            prNumber: mention.prNumber,
            localBranch: "pr-mention",
          });

          // Ensure base branch exists as a remote-tracking ref so git diff tools can compare
          // origin/BASE...HEAD even in --single-branch workspaces.
          if (mention.baseRef) {
            await $`git -C ${workspace.dir} fetch origin ${mention.baseRef}:refs/remotes/origin/${mention.baseRef} --depth=1`.quiet();
          }
        }

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

        // Global alias: treat @claude as an always-on alias for mentions.
        // (Repo-level opt-out remains possible via mention.acceptClaudeAlias=false,
        // but the alias is enabled by default to support immediate cutover.)
        const acceptClaudeAlias = config.mention.acceptClaudeAlias !== false;
        const acceptedHandles = acceptClaudeAlias ? [appSlug, "claude"] : [appSlug];

        // Ensure the mention is actually allowed for this repo (e.g. @claude opt-out).
        // Use substring match to align with the fast filter.
        const acceptedBodyLower = mention.commentBody.toLowerCase();
        const accepted = acceptedHandles
          .map((h) => (h.startsWith("@") ? h : `@${h}`))
          .map((h) => h.toLowerCase());
        if (!accepted.some((h) => acceptedBodyLower.includes(h))) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention does not match accepted handles for repo; skipping",
          );
          return;
        }

        const userQuestion = stripMention(mention.commentBody, acceptedHandles);
        if (userQuestion.trim().length === 0) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              acceptClaudeAlias,
            },
            "Mention contained no question after stripping mention; skipping",
          );
          return;
        }

        const writeIntent = parseWriteIntent(userQuestion);

        const isWriteRequest = writeIntent.writeIntent;
        const writeEnabled = isWriteRequest && config.write.enabled;

        if (isWriteRequest && mention.prNumber === undefined) {
          const replyBody = wrapInDetails(
            [
              "I can only apply changes in a PR context.",
              "",
              "Try mentioning me on a pull request (top-level comment or inline diff thread).",
            ].join("\n"),
            "kodiai response",
          );
          await postMentionReply(replyBody);
          return;
        }

        if (isWriteRequest && !config.write.enabled) {
          logger.info(
            {
              surface: mention.surface,
              owner: mention.owner,
              repo: mention.repo,
              issueNumber: mention.issueNumber,
              prNumber: mention.prNumber,
              commentAuthor: mention.commentAuthor,
              keyword: writeIntent.keyword,
              gate: "write-mode",
              gateResult: "skipped",
              skipReason: "write-disabled",
            },
            "Write intent detected but write-mode disabled; refusing to apply changes",
          );

          const replyBody = wrapInDetails(
            [
              "Write mode is disabled for this repo.",
              "",
              "To enable:",
              "```yml",
              "write:",
              "  enabled: true",
              "```",
              "",
              "Then re-run your request starting with `apply:` or `change:`.",
            ].join("\n"),
            "kodiai response",
          );

          await postMentionReply(replyBody);
          return;
        }

        logger.info(
          {
            surface: mention.surface,
            owner: mention.owner,
            repo: mention.repo,
            issueNumber: mention.issueNumber,
            prNumber: mention.prNumber,
            commentAuthor: mention.commentAuthor,
            acceptClaudeAlias,
          },
          "Processing mention",
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

        // Build mention context (conversation + PR metadata + inline diff context)
        // Non-fatal: if context fails to load, still attempt an answer with minimal prompt.
        let mentionContext = "";
        try {
          mentionContext = await buildMentionContext(octokit, mention);
        } catch (err) {
          logger.warn(
            { err, surface: mention.surface, issueNumber: mention.issueNumber },
            "Failed to build mention context; proceeding with empty context",
          );
        }

        const writeInstructions = writeEnabled
          ? [
              "Write-intent request detected (apply/change).",
              "Write-mode is enabled.",
              "",
              "In this run:",
              "- Make the requested changes by editing files in the workspace.",
              "- Do NOT run git commands (no branch/commit/push).",
              "- Do NOT publish any GitHub comments/reviews; publish tools are disabled.",
              "- Keep changes minimal and focused on the request.",
            ].join("\n")
          : isWriteRequest
            ? [
                "Write-intent request detected (apply/change).",
                "In this run: do NOT create branches/commits/PRs and do NOT push changes.",
                "Instead, propose a concrete, minimal plan (files + steps) and ask for confirmation.",
                "Keep it concise.",
              ].join("\n")
            : undefined;

        // Build mention prompt
        const mentionPrompt = buildMentionPrompt({
          mention,
          mentionContext,
          userQuestion: writeIntent.request,
          customInstructions: [config.mention.prompt, writeInstructions]
            .filter((s) => (s ?? "").trim().length > 0)
            .join("\n\n"),
        });

        // Execute via Claude
        const result = await executor.execute({
          workspace,
          installationId: event.installationId,
          owner: mention.owner,
          repo: mention.repo,
          prNumber: mention.prNumber,
          // For inline review comment mentions, provide the triggering review comment id
          // so the executor can enable the in-thread reply MCP tool.
          commentId: mention.surface === "pr_review_comment" ? mention.commentId : undefined,
          deliveryId: event.id,
          writeMode: writeEnabled,
          eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
          triggerBody: mention.commentBody,
          prompt: mentionPrompt,
        });

        logger.info(
          {
            surface: mention.surface,
            issueNumber: mention.issueNumber,
            conclusion: result.conclusion,
            published: result.published,
            writeEnabled,
            costUsd: result.costUsd,
            numTurns: result.numTurns,
            durationMs: result.durationMs,
            sessionId: result.sessionId,
          },
          "Mention execution completed",
        );

        // Write-mode: trusted code publishes the branch + PR and replies with a link.
        if (writeEnabled && mention.prNumber !== undefined) {
          const status = await getGitStatusPorcelain(workspace.dir);
          if (status.trim().length === 0) {
            const replyBody = wrapInDetails(
              [
                "I didn't end up making any file changes.",
                "",
                "If you still want a change, re-run with a more specific request.",
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }

          const shortDelivery = event.id.slice(0, 8);
          const branchName = `kodiai/apply/pr-${mention.prNumber}-${shortDelivery}`;
          const commitMessage = `kodiai: apply requested changes (pr #${mention.prNumber})`;

          const pushed = await createBranchCommitAndPush({
            dir: workspace.dir,
            branchName,
            commitMessage,
          });

          const prTitle = `kodiai: apply changes for PR #${mention.prNumber}`;
          const prBody = [
            "Requested via mention write intent.",
            "",
            `Keyword: ${writeIntent.keyword ?? "apply/change"}`,
            "",
            `Request: ${writeIntent.request}`,
            "",
            `Source PR: #${mention.prNumber}`,
            `Delivery: ${event.id}`,
            `Commit: ${pushed.headSha}`,
          ].join("\n");

          const { data: createdPr } = await octokit.rest.pulls.create({
            owner: mention.owner,
            repo: mention.repo,
            title: prTitle,
            head: pushed.branchName,
            base: mention.baseRef ?? "main",
            body: prBody,
          });

          const replyBody = wrapInDetails(
            [`Opened PR: ${createdPr.html_url}`].join("\n"),
            "kodiai response",
          );
          await postMentionReply(replyBody);
          return;
        }

        // If Claude finished successfully but did not publish any output, post a fallback reply.
        // This prevents "silent success" where the model chose not to call any comment tools.
        if (!writeEnabled && result.conclusion === "success" && !result.published) {
          const fallbackBody = wrapInDetails(
            [
              "I saw your mention, but I didn't publish a reply automatically.",
              "",
              "Can you clarify what you want me to do?",
              "- (1) What outcome are you aiming for?",
              "- (2) Which file(s) / line(s) should I focus on?",
            ].join("\n"),
            "kodiai response",
          );

          const replyOctokit = await githubApp.getInstallationOctokit(event.installationId);
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            await replyOctokit.rest.pulls.createReplyForReviewComment({
              owner: mention.owner,
              repo: mention.repo,
              pull_number: mention.prNumber,
              comment_id: mention.commentId,
              body: fallbackBody,
            });
          } else {
            await replyOctokit.rest.issues.createComment({
              owner: mention.owner,
              repo: mention.repo,
              issue_number: mention.issueNumber,
              body: fallbackBody,
            });
          }
        }

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
          await postMentionError(errorBody);
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
          // Prefer in-thread reply for inline review comments.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
            await errOctokit.rest.pulls.createReplyForReviewComment({
              owner: mention.owner,
              repo: mention.repo,
              pull_number: mention.prNumber,
              comment_id: mention.commentId,
              body: errorBody,
            });
          } else {
            const errOctokit = await githubApp.getInstallationOctokit(event.installationId);
            await postOrUpdateErrorComment(
              errOctokit,
              {
                owner: mention.owner,
                repo: mention.repo,
                issueNumber: mention.issueNumber,
              },
              errorBody,
              logger,
            );
          }
        } catch (commentErr) {
          logger.error({ err: commentErr }, "Failed to post error comment");
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
      jobType: "mention",
      prNumber: mention.prNumber,
    });
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
