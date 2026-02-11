import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import { $ } from "bun";
import { createHash } from "node:crypto";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager, Workspace } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { createExecutor } from "../execution/executor.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import { loadRepoConfig } from "../execution/config.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
  getGitStatusPorcelain,
  createBranchCommitAndPush,
  commitAndPushToRemoteRef,
  pushHeadToRemoteRef,
  WritePolicyError,
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
  telemetryStore: TelemetryStore;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, workspaceManager, githubApp, executor, telemetryStore, logger } = deps;

  // Basic in-memory rate limiter for write-mode requests.
  // Keyed by installation+repo; resets on process restart.
  const lastWriteAt = new Map<string, number>();

  const inFlightWriteKeys = new Set<string>();

  function buildWriteOutputKey(input: {
    installationId: number;
    owner: string;
    repo: string;
    prNumber: number;
    commentId: number;
    keyword: string;
  }): string {
    const normalizedOwner = input.owner.trim().toLowerCase();
    const normalizedRepo = input.repo.trim().toLowerCase();
    const normalizedKeyword = input.keyword.trim().toLowerCase();

    return [
      "kodiai-write-output",
      "v1",
      `inst-${input.installationId}`,
      `${normalizedOwner}/${normalizedRepo}`,
      `pr-${input.prNumber}`,
      `comment-${input.commentId}`,
      `keyword-${normalizedKeyword}`,
    ].join(":");
  }

  function buildWriteBranchName(params: {
    prNumber: number;
    commentId: number;
    writeOutputKey: string;
  }): string {
    const hash = createHash("sha256").update(params.writeOutputKey).digest("hex").slice(0, 12);
    return `kodiai/apply/pr-${params.prNumber}-comment-${params.commentId}-${hash}`;
  }

  function pruneRateLimiter(now: number): void {
    // Defense-in-depth: prevent unbounded growth in long-lived processes.
    // Keep recent entries only; this limiter is best-effort and not durable.
    const ttlMs = 24 * 60 * 60 * 1000; // 24h
    for (const [key, ts] of lastWriteAt.entries()) {
      if (now - ts > ttlMs) {
        lastWriteAt.delete(key);
      }
    }

    // Hard cap: if still large, drop oldest entries.
    const maxEntries = 10_000;
    if (lastWriteAt.size <= maxEntries) return;

    const entries = [...lastWriteAt.entries()].sort((a, b) => a[1] - b[1]);
    const toDelete = entries.length - maxEntries;
    for (let i = 0; i < toDelete; i++) {
      const k = entries[i]?.[0];
      if (k) lastWriteAt.delete(k);
    }
  }

  function parseWriteIntent(userQuestion: string): {
    writeIntent: boolean;
    keyword: "apply" | "change" | "plan" | undefined;
    request: string;
  } {
    const trimmed = userQuestion.trimStart();
    const lower = trimmed.toLowerCase();

    for (const keyword of ["apply", "change", "plan"] as const) {
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
      let acquiredWriteKey: string | undefined;
      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        async function postMentionReply(replyBody: string): Promise<void> {
          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await octokit.rest.pulls.createReplyForReviewComment({
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

          await octokit.rest.issues.createComment({
            owner: mention.owner,
            repo: mention.repo,
            issue_number: mention.issueNumber,
            body: replyBody,
          });
        }

        async function postMentionError(errorBody: string): Promise<void> {
          // Prefer replying in-thread for inline review comment mentions.
          if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
            try {
              await octokit.rest.pulls.createReplyForReviewComment({
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
            octokit,
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
        const { config, warnings } = await loadRepoConfig(workspace.dir);
        for (const w of warnings) {
          logger.warn(
            { section: w.section, issues: w.issues },
            "Config section invalid, using defaults",
          );
        }

        // Check mention.enabled
        if (!config.mention.enabled) {
          logger.info(
            { owner: mention.owner, repo: mention.repo },
            "Mentions disabled in config, skipping",
          );
          return;
        }

        // Check mention.allowedUsers (CONFIG-07)
        if (config.mention.allowedUsers.length > 0) {
          const normalizedAuthor = mention.commentAuthor.toLowerCase();
          const allowed = config.mention.allowedUsers.map((u) => u.toLowerCase());
          if (!allowed.includes(normalizedAuthor)) {
            logger.info(
              {
                owner: mention.owner,
                repo: mention.repo,
                commentAuthor: mention.commentAuthor,
                gate: "mention-allowed-users",
                gateResult: "skipped",
                skipReason: "user-not-allowlisted",
              },
              "Mention author not in allowedUsers, skipping",
            );
            return;
          }
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
        const normalizedQuestion = userQuestion.trim().toLowerCase();
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
        const isPlanOnly = writeIntent.keyword === "plan";
        const writeEnabled = isWriteRequest && !isPlanOnly && config.write.enabled;

        const writeKeyword = writeIntent.keyword ?? "apply";
        const writeOutputKey =
          writeEnabled && mention.prNumber !== undefined
            ? buildWriteOutputKey({
                installationId: event.installationId,
                owner: mention.owner,
                repo: mention.repo,
                prNumber: mention.prNumber,
                commentId: mention.commentId,
                keyword: writeKeyword,
              })
            : undefined;

        const writeBranchName =
          writeOutputKey && mention.prNumber !== undefined
            ? buildWriteBranchName({
                prNumber: mention.prNumber,
                commentId: mention.commentId,
                writeOutputKey,
              })
            : undefined;

        const triggerCommentUrl =
          mention.prNumber !== undefined
            ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}#issuecomment-${mention.commentId}`
            : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}#issuecomment-${mention.commentId}`;

        if (writeEnabled && writeOutputKey && writeBranchName && mention.prNumber !== undefined) {
          // Idempotency: if a PR already exists for this deterministic head branch, reuse it.
          try {
            const { data: prs } = await octokit.rest.pulls.list({
              owner: mention.owner,
              repo: mention.repo,
              state: "all",
              head: `${mention.owner}:${writeBranchName}`,
              per_page: 5,
            });

            const existing = prs[0];
            if (existing?.html_url) {
              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "reused-pr",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  sourcePrNumber: mention.prNumber,
                  triggerCommentId: mention.commentId,
                  triggerCommentUrl,
                  writeOutputKey,
                  branchName: writeBranchName,
                  prUrl: existing.html_url,
                },
                "Evidence bundle",
              );

              const replyBody = wrapInDetails(
                [`Existing PR: ${existing.html_url}`].join("\n"),
                "kodiai response",
              );
              await postMentionReply(replyBody);
              return;
            }
          } catch (err) {
            logger.warn(
              { err, writeBranchName, writeOutputKey, prNumber: mention.prNumber },
              "Failed to look up existing PR for write idempotency; continuing",
            );
          }

          // Best-effort lock: prevent duplicate work for the same trigger.
          if (inFlightWriteKeys.has(writeOutputKey)) {
            const replyBody = wrapInDetails(
              [
                "Write request already in progress.",
                "",
                "If no PR appears shortly, retry the same comment.",
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }
          inFlightWriteKeys.add(writeOutputKey);
          acquiredWriteKey = writeOutputKey;
        }

        if (writeEnabled && config.write.minIntervalSeconds > 0) {
          const key = `${event.installationId}:${mention.owner}/${mention.repo}`;
          const now = Date.now();
          pruneRateLimiter(now);
          const last = lastWriteAt.get(key);
          const minMs = config.write.minIntervalSeconds * 1000;

          if (last !== undefined && now - last < minMs) {
            const replyBody = wrapInDetails(
              [
                "Write request rate-limited.",
                "",
                `Try again in ${Math.ceil((minMs - (now - last)) / 1000)}s.`,
              ].join("\n"),
              "kodiai response",
            );
            await postMentionReply(replyBody);
            return;
          }
        }

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

        if (isWriteRequest && !isPlanOnly && !config.write.enabled) {
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
          if (mention.surface === "pr_review_comment") {
            await octokit.rest.reactions.createForPullRequestReviewComment({
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
            await octokit.rest.reactions.createForIssueComment({
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

        const planOnlyInstructions = isPlanOnly
          ? [
              "Plan-only request detected (plan:).",
              "In this run:",
              "- Do NOT edit files.",
              "- Do NOT run git commands.",
              "- Do NOT propose opening a PR.",
              "- Do NOT claim any change was completed.",
              "- Never use status phrases like: 'Done', 'Implemented', 'Updated', or 'Appended'.",
              "Return a concise plan with 3-7 steps and a list of files you would touch.",
              "End by asking the user to proceed with `apply:` if they want you to implement it.",
            ].join("\n")
          : undefined;

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
          customInstructions: [config.mention.prompt, planOnlyInstructions, writeInstructions]
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

        // Fire-and-forget telemetry capture (TELEM-03, TELEM-05, CONFIG-10)
        if (config.telemetry.enabled) {
          try {
            telemetryStore.record({
              deliveryId: event.id,
              repo: `${mention.owner}/${mention.repo}`,
              prNumber: mention.prNumber,
              eventType: `${event.name}.${action ?? ""}`.replace(/\.$/, ""),
              model: result.model ?? "unknown",
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              cacheReadTokens: result.cacheReadTokens,
              cacheCreationTokens: result.cacheCreationTokens,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              conclusion: result.conclusion,
              sessionId: result.sessionId,
              numTurns: result.numTurns,
              stopReason: result.stopReason,
            });
          } catch (err) {
            logger.warn({ err }, "Telemetry write failed (non-blocking)");
          }

          // Cost warning (CONFIG-11)
          if (
            config.telemetry.costWarningUsd > 0 &&
            result.costUsd !== undefined &&
            result.costUsd > config.telemetry.costWarningUsd
          ) {
            logger.warn(
              {
                costUsd: result.costUsd,
                threshold: config.telemetry.costWarningUsd,
                repo: `${mention.owner}/${mention.repo}`,
                prNumber: mention.prNumber,
              },
              "Execution cost exceeded warning threshold",
            );
            try {
              const warnOctokit = await githubApp.getInstallationOctokit(event.installationId);
              await warnOctokit.rest.issues.createComment({
                owner: mention.owner,
                repo: mention.repo,
                issue_number: mention.issueNumber,
                body: `> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, exceeding the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``,
              });
            } catch (err) {
              logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
            }
          }
        }

        // Write-mode: trusted code publishes the branch + PR and replies with a link.
        if (writeEnabled && mention.prNumber !== undefined && writeOutputKey && writeBranchName) {
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

          const sourcePrUrl = `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`;

          const normalizeName = (s: string | undefined): string => (s ?? "").trim().toLowerCase();
          const sameRepoHead =
            normalizeName(mention.headRepoOwner) === normalizeName(mention.owner) &&
            normalizeName(mention.headRepoName) === normalizeName(mention.repo) &&
            typeof mention.headRef === "string" &&
            mention.headRef.length > 0;

          // Preferred path: update existing PR branch when possible.
          if (sameRepoHead && mention.headRef) {
            const headRef = mention.headRef;
            const idempotencyMarker = `kodiai-write-output-key: ${writeOutputKey}`;

            // NOTE: The in-flight lock is acquired earlier for all write-mode requests.
            // It is in-process only; in multi-replica deployments, two replicas can still
            // do duplicate work concurrently. This project currently deploys with max-replicas=1.

            try {
              await $`git -C ${workspace.dir} fetch origin ${headRef}:refs/remotes/origin/${headRef} --depth=50`.quiet();
              const recentMessages = (
                await $`git -C ${workspace.dir} log -n 50 --pretty=%B refs/remotes/origin/${headRef}`.quiet()
              )
                .text();
              if (recentMessages.includes(idempotencyMarker)) {
                logger.info(
                  {
                    evidenceType: "write-mode",
                    outcome: "skipped-idempotent",
                    deliveryId: event.id,
                    installationId: event.installationId,
                    owner: mention.owner,
                    repoName: mention.repo,
                    repo: `${mention.owner}/${mention.repo}`,
                    sourcePrNumber: mention.prNumber,
                    triggerCommentId: mention.commentId,
                    triggerCommentUrl,
                    writeOutputKey,
                    prUrl: sourcePrUrl,
                  },
                  "Evidence bundle",
                );

                const replyBody = wrapInDetails(
                  [`Already applied (idempotent): ${sourcePrUrl}`].join("\n"),
                  "kodiai response",
                );
                await postMentionReply(replyBody);
                return;
              }
            } catch (err) {
              logger.warn(
                { err, prNumber: mention.prNumber, headRef },
                "Failed to check idempotency marker on head ref; continuing",
              );
            }

            try {
              await $`git -C ${workspace.dir} checkout -B pr-head refs/remotes/origin/${headRef}`.quiet();

              const commitMessage = [
                `kodiai: apply requested changes (pr #${mention.prNumber})`,
                "",
                idempotencyMarker,
                `deliveryId: ${event.id}`,
              ].join("\n");

              const pushed = await commitAndPushToRemoteRef({
                dir: workspace.dir,
                remoteRef: headRef,
                commitMessage,
                policy: {
                  allowPaths: config.write.allowPaths,
                  denyPaths: config.write.denyPaths,
                  secretScanEnabled: config.write.secretScan.enabled,
                },
              });

              logger.info(
                {
                  evidenceType: "write-mode",
                  outcome: "updated-pr-branch",
                  deliveryId: event.id,
                  installationId: event.installationId,
                  owner: mention.owner,
                  repoName: mention.repo,
                  repo: `${mention.owner}/${mention.repo}`,
                  sourcePrNumber: mention.prNumber,
                  triggerCommentId: mention.commentId,
                  triggerCommentUrl,
                  writeOutputKey,
                  headRef,
                  commitSha: pushed.headSha,
                  prUrl: sourcePrUrl,
                },
                "Evidence bundle",
              );

              const replyBody = wrapInDetails(
                [`Updated PR: ${sourcePrUrl}`].join("\n"),
                "kodiai response",
              );
              try {
                await postMentionReply(replyBody);
              } catch (replyErr) {
                logger.warn(
                  { err: replyErr, prNumber: mention.prNumber, headRef },
                  "Applied changes but failed to post confirmation reply",
                );
              }
              return;
            } catch (err) {
              if (err instanceof WritePolicyError) {
                const refusal = buildWritePolicyRefusalMessage(err, config.write.allowPaths);
                const replyBody = wrapInDetails(refusal, "kodiai response");
                await postMentionReply(replyBody);
                return;
              }

              // If another concurrent run already pushed an idempotent commit, treat this as a no-op.
              try {
                await $`git -C ${workspace.dir} fetch origin ${headRef}:refs/remotes/origin/${headRef} --depth=50`.quiet();
                const recentMessages = (
                  await $`git -C ${workspace.dir} log -n 50 --pretty=%B refs/remotes/origin/${headRef}`.quiet()
                )
                  .text();
                if (recentMessages.includes(idempotencyMarker)) {
                  logger.info(
                    {
                      evidenceType: "write-mode",
                      outcome: "skipped-idempotent",
                      deliveryId: event.id,
                      installationId: event.installationId,
                      owner: mention.owner,
                      repoName: mention.repo,
                      repo: `${mention.owner}/${mention.repo}`,
                      sourcePrNumber: mention.prNumber,
                      triggerCommentId: mention.commentId,
                      triggerCommentUrl,
                      writeOutputKey,
                      prUrl: sourcePrUrl,
                    },
                    "Evidence bundle",
                  );

                  const replyBody = wrapInDetails(
                    [`Already applied (idempotent): ${sourcePrUrl}`].join("\n"),
                    "kodiai response",
                  );
                  await postMentionReply(replyBody);
                  return;
                }
              } catch (lookupErr) {
                logger.warn(
                  { err: lookupErr, prNumber: mention.prNumber, headRef },
                  "Failed to re-check idempotency marker after push failure",
                );
              }

              logger.warn(
                { err, prNumber: mention.prNumber, headRef },
                "Failed to push to PR head branch; falling back to bot PR",
              );

              // Fallback: push current HEAD to deterministic bot branch and open bot PR.
              try {
                await pushHeadToRemoteRef({
                  dir: workspace.dir,
                  remoteRef: writeBranchName,
                });
              } catch (pushErr) {
                logger.error(
                  { err: pushErr, prNumber: mention.prNumber, branchName: writeBranchName },
                  "Fallback push to bot branch failed",
                );
                throw err;
              }
              // Continue into bot PR creation below.
            }
          }

          const branchName = writeBranchName;
          const commitMessage = [
            `kodiai: apply requested changes (pr #${mention.prNumber})`,
            "",
            `kodiai-write-output-key: ${writeOutputKey}`,
            `deliveryId: ${event.id}`,
          ].join("\n");

          let pushed: { branchName: string; headSha: string };
          try {
            pushed = await createBranchCommitAndPush({
              dir: workspace.dir,
              branchName,
              commitMessage,
              policy: {
                allowPaths: config.write.allowPaths,
                denyPaths: config.write.denyPaths,
                secretScanEnabled: config.write.secretScan.enabled,
              },
            });
          } catch (err) {
            if (err instanceof WritePolicyError) {
              const refusal = buildWritePolicyRefusalMessage(err, config.write.allowPaths);
              const replyBody = wrapInDetails(refusal, "kodiai response");
              await postMentionReply(replyBody);
              return;
            }

            // If the branch already exists (e.g. replay), try to find the existing PR.
            if (err instanceof Error) {
              const msg = err.message.toLowerCase();
              const looksLikeBranchExists =
                msg.includes("non-fast-forward") ||
                msg.includes("fetch first") ||
                msg.includes("rejected") ||
                msg.includes("already exists");
              if (looksLikeBranchExists) {
                try {
                  const { data: prs } = await octokit.rest.pulls.list({
                    owner: mention.owner,
                    repo: mention.repo,
                    state: "all",
                    head: `${mention.owner}:${branchName}`,
                    per_page: 5,
                  });
                  const existing = prs[0];
                  if (existing?.html_url) {
                    const replyBody = wrapInDetails(
                      [`Existing PR: ${existing.html_url}`].join("\n"),
                      "kodiai response",
                    );
                    await postMentionReply(replyBody);
                    return;
                  }
                } catch (lookupErr) {
                  logger.warn(
                    { err: lookupErr, prNumber: mention.prNumber, branchName },
                    "Failed to look up existing PR after push failure",
                  );
                }
              }
            }
            throw err;
          }

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

          logger.info(
            {
              evidenceType: "write-mode",
              outcome: "created-pr",
              deliveryId: event.id,
              installationId: event.installationId,
              owner: mention.owner,
              repoName: mention.repo,
              repo: `${mention.owner}/${mention.repo}`,
              sourcePrNumber: mention.prNumber,
              triggerCommentId: mention.commentId,
              triggerCommentUrl,
              writeOutputKey,
              branchName,
              prUrl: createdPr.html_url,
              commitSha: pushed.headSha,
            },
            "Evidence bundle",
          );

          // Record successful publish time for rate limiting.
          if (config.write.minIntervalSeconds > 0) {
            const key = `${event.installationId}:${mention.owner}/${mention.repo}`;
            lastWriteAt.set(key, Date.now());
          }

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
        if (acquiredWriteKey) {
          inFlightWriteKeys.delete(acquiredWriteKey);
        }
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

  function buildWritePolicyRefusalMessage(
    err: WritePolicyError,
    allowPaths: string[],
  ): string {
    const yamlSingleQuote = (s: string): string => s.replaceAll("'", "''");

    const lines: string[] = [];
    lines.push("Write request refused.");
    lines.push("");
    lines.push(`Reason: ${err.code}`);
    if (err.rule) lines.push(`Rule: ${err.rule}`);
    if (err.path) lines.push(`File: ${err.path}`);
    if (err.pattern) lines.push(`Matched pattern: ${err.pattern}`);
    if (err.detector) lines.push(`Detector: ${err.detector}`);
    lines.push("");
    lines.push(err.message);

    // Suggest the smallest config change when it's reasonably safe.
    // For secret detection, do not suggest bypassing policy by default.
    if (err.code === "write-policy-not-allowed" && err.path) {
      const escapedPath = yamlSingleQuote(err.path);
      lines.push("");
      lines.push("Smallest config change (if intended):");
      lines.push("```yml");
      lines.push("write:");
      lines.push("  allowPaths:");
      lines.push(`    - '${escapedPath}'`);
      lines.push("```");

      if (allowPaths.length > 0) {
        lines.push("");
        lines.push(
          `Current allowPaths: ${allowPaths
            .map((p) => `'${yamlSingleQuote(p)}'`)
            .join(", ")}`,
        );
      }
    } else if (err.code === "write-policy-denied-path") {
      lines.push("");
      lines.push("Config change required to allow this path is potentially risky.");
      lines.push("If you explicitly want to allow it, narrow or remove the matching denyPaths entry.");
    } else if (err.code === "write-policy-secret-detected") {
      lines.push("");
      lines.push("No safe config bypass suggested.");
      lines.push("Remove/redact the secret-like content and retry.");
      lines.push("(If this is a false positive, you can disable secretScan, but that reduces safety.)");
    } else if (err.code === "write-policy-no-changes") {
      lines.push("");
      lines.push("No file changes were produced.");
      lines.push("Restate the change request with a concrete file + edit.");
    }

    return lines.join("\n");
  }

  // Register for all three mention-triggering events
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
