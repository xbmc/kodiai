/**
 * Troubleshooting agent handler.
 *
 * When @kodiai is mentioned on an open issue with troubleshooting intent
 * and triage.troubleshooting.enabled is true, retrieves similar resolved
 * issues, synthesizes guidance via LLM, and posts a comment with citations
 * and provenance disclosure.
 *
 * Separate handler file per project constraint (not added to 2000+ line mention handler).
 * Registers on issue_comment.created alongside the mention handler -- the event
 * router runs all handlers via Promise.allSettled.
 */

import type { Logger } from "pino";
import type { IssueCommentCreatedEvent } from "@octokit/webhooks-types";
import type { Sql } from "../db/client.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { WikiPageStore } from "../knowledge/wiki-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue, WorkspaceManager } from "../jobs/types.ts";
import type { TaskRouter } from "../llm/task-router.ts";
import type { CostTracker } from "../llm/cost-tracker.ts";
import type { TroubleshootingResult } from "../knowledge/troubleshooting-retrieval.ts";
import { loadRepoConfig } from "../execution/config.ts";
import { containsMention, stripMention } from "./mention-types.ts";
import {
  classifyTroubleshootingIntent,
  buildTroubleshootMarker,
  hasTroubleshootMarker,
} from "./troubleshooting-intent.ts";
import { retrieveTroubleshootingContext } from "../knowledge/troubleshooting-retrieval.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { sanitizeOutgoingMentions } from "../lib/sanitizer.ts";

export function createTroubleshootingHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  workspaceManager: WorkspaceManager;
  issueStore: IssueStore;
  wikiPageStore?: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  sql: Sql;
  logger: Logger;
}): void {
  const {
    eventRouter,
    githubApp,
    workspaceManager,
    issueStore,
    wikiPageStore,
    embeddingProvider,
    taskRouter,
    costTracker,
    logger,
  } = deps;

  async function handleTroubleshootingMention(event: WebhookEvent): Promise<void> {
    try {
      // 1. Extract payload
      const payload = event.payload as unknown as IssueCommentCreatedEvent;
      const issue = payload.issue;
      const comment = payload.comment;
      const repository = payload.repository;

      if (!issue || !comment || !repository) {
        return;
      }

      const owner = repository.owner.login;
      const repoName = repository.name;
      const fullRepo = repository.full_name;
      const defaultBranch = repository.default_branch ?? "main";

      // 2. Skip PRs -- troubleshooting is issues only
      if ((issue as Record<string, unknown>).pull_request) {
        return;
      }

      // 3. Skip closed issues
      if (issue.state !== "open") {
        return;
      }

      // 4. Check for @kodiai mention
      const appSlug = githubApp.getAppSlug();
      if (!containsMention(comment.body, [appSlug])) {
        return;
      }

      // 5. Skip bot self-mentions
      if (comment.user.type === "Bot") {
        return;
      }

      // 6. Strip mention and classify intent
      const mentionText = stripMention(comment.body, [appSlug]);
      const isTroubleshooting = classifyTroubleshootingIntent({
        mentionText,
        issueTitle: issue.title,
        issueBody: issue.body ?? null,
      });
      if (!isTroubleshooting) {
        return;
      }

      const handlerLogger = logger.child({
        handler: "troubleshooting-agent",
        repo: fullRepo,
        issueNumber: issue.number,
        triggerCommentId: comment.id,
        deliveryId: event.id,
      });

      handlerLogger.info("Troubleshooting intent detected, processing");

      // 7. Load repo config via workspace clone
      let workspace: Awaited<ReturnType<WorkspaceManager["create"]>> | null = null;
      try {
        workspace = await workspaceManager.create(event.installationId, {
          owner,
          repo: repoName,
          ref: defaultBranch,
          depth: 1,
        });
        const { config } = await loadRepoConfig(workspace.dir);

        // Clean up workspace immediately -- we only needed the config
        await workspace.cleanup();
        workspace = null;

        // 8. Check config gate (TSHOOT-07)
        if (!config.triage?.troubleshooting?.enabled) {
          handlerLogger.debug("Troubleshooting disabled in config, skipping");
          return;
        }

        // 9. Get Octokit
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        // 10. Marker dedup check (TSHOOT-08)
        const { data: existingComments } = await octokit.rest.issues.listComments({
          owner,
          repo: repoName,
          issue_number: issue.number,
          per_page: 50,
        });
        if (hasTroubleshootMarker(existingComments, comment.id)) {
          handlerLogger.info("Troubleshoot marker already exists for this trigger comment, skipping");
          return;
        }

        // 11. Retrieve troubleshooting context
        const result = await retrieveTroubleshootingContext({
          issueStore,
          wikiPageStore,
          embeddingProvider,
          repo: fullRepo,
          queryTitle: issue.title,
          queryBody: issue.body ?? null,
          config: config.triage.troubleshooting,
          logger: handlerLogger,
        });

        if (!result) {
          handlerLogger.info("No troubleshooting matches found, skipping comment");
          return;
        }

        // 12. Synthesize guidance
        const prompt = buildTroubleshootingSynthesisPrompt(result, issue.title, issue.body ?? null);
        const resolved = taskRouter.resolve(TASK_TYPES.TROUBLESHOOTING_SYNTHESIS);
        const genResult = await generateWithFallback({
          taskType: TASK_TYPES.TROUBLESHOOTING_SYNTHESIS,
          resolved,
          prompt,
          system:
            "You are a troubleshooting assistant for a software project. Synthesize actionable guidance from the provided resolved issues and wiki pages. Be concise and specific. Do not invent solutions not grounded in the sources.",
          costTracker,
          repo: fullRepo,
          deliveryId: event.id,
          logger: handlerLogger,
        });

        // 13. Format comment
        const marker = buildTroubleshootMarker(fullRepo, issue.number, comment.id);
        const commentBody = formatTroubleshootingComment({
          synthesizedGuidance: genResult.text,
          result,
          marker,
        });

        // 14. Sanitize outgoing mentions
        const sanitizedBody = sanitizeOutgoingMentions(commentBody, [appSlug]);

        // 15. Post comment
        await octokit.rest.issues.createComment({
          owner,
          repo: repoName,
          issue_number: issue.number,
          body: sanitizedBody,
        });

        // 16. Log success
        handlerLogger.info(
          {
            matchCount: result.matches.length,
            wikiCount: result.wikiResults.length,
            model: genResult.model,
            durationMs: genResult.durationMs,
          },
          "Troubleshooting guidance posted",
        );
      } catch (err) {
        // Clean up workspace if still open
        if (workspace) {
          try {
            await workspace.cleanup();
          } catch {
            // ignore cleanup errors
          }
        }
        throw err;
      }
    } catch (err) {
      // Fail-open: log error but do not throw (do not break the event router)
      logger.error(
        { err, deliveryId: event.id },
        "Troubleshooting handler failed (non-fatal)",
      );
    }
  }

  eventRouter.register("issue_comment.created", handleTroubleshootingMention);
}

/**
 * Build the prompt for LLM synthesis of troubleshooting guidance.
 * Exported for testing.
 */
export function buildTroubleshootingSynthesisPrompt(
  result: TroubleshootingResult,
  queryTitle: string,
  queryBody: string | null,
): string {
  const lines: string[] = [];

  lines.push("## Current Issue");
  lines.push(`Title: ${queryTitle}`);
  if (queryBody) {
    lines.push(`Description: ${queryBody.slice(0, 1000)}`);
  }
  lines.push("");

  if (result.matches.length > 0) {
    lines.push("## Similar Resolved Issues");
    for (const match of result.matches) {
      lines.push(
        `### Issue #${match.issueNumber}: ${match.title} (${Math.round(match.similarity * 100)}% match)`,
      );
      lines.push(match.body.slice(0, 500));
      if (match.tailComments.length > 0) {
        lines.push("\nResolution comments:");
        for (const comment of match.tailComments) {
          lines.push(`- ${comment.slice(0, 300)}`);
        }
      }
      if (match.semanticComments.length > 0) {
        lines.push("\nRelevant discussion:");
        for (const comment of match.semanticComments) {
          lines.push(`- ${comment.slice(0, 300)}`);
        }
      }
      lines.push("");
    }
  }

  if (result.wikiResults.length > 0) {
    lines.push("## Related Wiki Pages");
    for (const wiki of result.wikiResults) {
      lines.push(`### ${wiki.pageTitle}`);
      lines.push(wiki.rawText.slice(0, 500));
      lines.push("");
    }
  }

  lines.push("## Instructions");
  lines.push("1. Synthesize a concise troubleshooting guide (3-8 bullet points).");
  lines.push("2. Focus on actionable steps the user can try.");
  lines.push("3. Reference specific resolved issues by number when citing solutions.");
  lines.push("4. If wiki pages provide relevant procedures, mention them.");
  lines.push("5. Do NOT invent solutions not grounded in the provided sources.");
  lines.push("6. Keep the response under 500 words.");

  return lines.join("\n");
}

/**
 * Format the troubleshooting comment with citations and provenance disclosure.
 * Exported for testing. (TSHOOT-05)
 */
export function formatTroubleshootingComment(params: {
  synthesizedGuidance: string;
  result: TroubleshootingResult;
  marker: string;
}): string {
  const { synthesizedGuidance, result, marker } = params;
  const lines: string[] = [];

  lines.push("## Troubleshooting Guidance");
  lines.push("");
  lines.push(synthesizedGuidance);
  lines.push("");

  const hasMatches = result.matches.length > 0;
  const hasWiki = result.wikiResults.length > 0;

  if (hasMatches || hasWiki) {
    lines.push("<details>");
    lines.push("<summary>Sources</summary>");
    lines.push("");

    if (hasMatches) {
      lines.push("| Issue | Title | Match |");
      lines.push("|-------|-------|-------|");
      for (const match of result.matches) {
        lines.push(
          `| #${match.issueNumber} | ${match.title} | ${Math.round(match.similarity * 100)}% |`,
        );
      }
    }

    if (hasWiki) {
      lines.push("");
      for (const wiki of result.wikiResults) {
        if (wiki.pageUrl) {
          lines.push(`- [Wiki: ${wiki.pageTitle}](${wiki.pageUrl})`);
        } else {
          lines.push(`- Wiki: ${wiki.pageTitle}`);
        }
      }
    }

    lines.push("");
    lines.push("</details>");
  }

  lines.push("");
  lines.push(
    "> This guidance was synthesized from similar resolved issues. It may not directly apply to your situation.",
  );
  lines.push("");
  lines.push(marker);

  return lines.join("\n");
}
