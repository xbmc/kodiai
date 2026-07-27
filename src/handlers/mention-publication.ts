import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { mentionAdapter } from "../lib/guardrail/adapters/mention-adapter.ts";
import { runGuardrailPipeline } from "../lib/guardrail/pipeline.ts";
import {
  createIssueCommentWithPublicationPipeline,
  createReviewReplyWithPublicationPipeline,
  prepareGitHubPublication,
} from "../lib/github-publication.ts";
import { err as resultErr, ok as resultOk, toError } from "../lib/result.ts";
import { postOrUpdateErrorComment } from "../lib/errors.ts";
import type { MentionEvent } from "./mention-types.ts";
import type { MentionErrorPostResult } from "./mention-publication-state.ts";

export type MentionPublisher = {
  postMentionReply(
    replyBody: string,
    options?: { sanitizeMentions?: boolean },
  ): Promise<void>;
  postMentionError(errorBody: string): Promise<MentionErrorPostResult>;
};

export function createMentionPublisher(params: {
  octokit: Octokit;
  mention: MentionEvent;
  possibleHandles: string[];
  logger: Logger;
  guardrailAuditStore?: GuardrailAuditStore;
}): MentionPublisher {
  const { octokit, mention, possibleHandles, logger, guardrailAuditStore } = params;

  async function postMentionReply(
    replyBody: string,
    options?: { sanitizeMentions?: boolean },
  ): Promise<void> {
    const handles = options?.sanitizeMentions === false ? [] : possibleHandles;
    const initialPublication = prepareGitHubPublication(replyBody, {
      botHandles: handles,
      preserveKodiaiMarkers: true,
    });
    let blockedPublicationRuleId = initialPublication.blocked
      ? initialPublication.matchedPattern
      : undefined;
    let sanitizedBody = initialPublication.blocked
      ? "[Response blocked by security policy]"
      : initialPublication.body;

    const isTemplateBased = sanitizedBody.trimStart().startsWith("<details>") || sanitizedBody.length <= 500;
    if (!isTemplateBased) {
      try {
        const guardResult = await runGuardrailPipeline({
          adapter: mentionAdapter,
          input: {
            issueBody: mention.commentBody,
            prDescription: undefined,
            conversationHistory: [],
            retrievalResults: [],
          },
          output: sanitizedBody,
          config: { strictness: "standard" },
          repo: `${mention.owner}/${mention.repo}`,
          auditStore: guardrailAuditStore,
        });
        if (guardResult.output !== null && !guardResult.suppressed) {
          sanitizedBody = guardResult.output;
        }
      } catch {
        // Guardrail error: fail-open, use original sanitized body.
      }
    }

    const finalPublication = prepareGitHubPublication(sanitizedBody, {
      botHandles: handles,
      preserveKodiaiMarkers: true,
    });
    if (finalPublication.blocked) {
      blockedPublicationRuleId = finalPublication.matchedPattern;
    }
    if (blockedPublicationRuleId) {
      logger.warn(
        { secretScanRuleId: blockedPublicationRuleId },
        "Outgoing secret scan blocked original mention reply content; publishing placeholder",
      );
      sanitizedBody = "[Response blocked by security policy]";
    } else {
      sanitizedBody = finalPublication.body;
    }

    if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
      try {
        await createReviewReplyWithPublicationPipeline(octokit, {
          owner: mention.owner,
          repo: mention.repo,
          pull_number: mention.prNumber,
          comment_id: mention.commentId,
          body: sanitizedBody,
          botHandles: handles,
          preserveKodiaiMarkers: true,
        });
        return;
      } catch (err) {
        logger.warn(
          { err, prNumber: mention.prNumber, commentId: mention.commentId },
          "Failed to post in-thread reply; falling back to top-level comment",
        );
      }
    }

    await createIssueCommentWithPublicationPipeline(octokit, {
      owner: mention.owner,
      repo: mention.repo,
      issue_number: mention.issueNumber,
      body: sanitizedBody,
      botHandles: handles,
      preserveKodiaiMarkers: true,
    });
  }

  async function postMentionError(errorBody: string): Promise<MentionErrorPostResult> {
    const sanitizedBody = prepareGitHubPublication(errorBody, {
      botHandles: possibleHandles,
      preserveKodiaiMarkers: true,
    }).body;

    if (mention.surface === "pr_review_comment" && mention.prNumber !== undefined) {
      let parentReviewCommentExists = true;
      try {
        await octokit.rest.pulls.getReviewComment({
          owner: mention.owner,
          repo: mention.repo,
          comment_id: mention.commentId,
        });
      } catch (err) {
        const status = typeof err === "object" && err !== null
          ? (err as { status?: unknown }).status
          : undefined;
        if (status === 404) {
          parentReviewCommentExists = false;
          logger.info(
            { prNumber: mention.prNumber, commentId: mention.commentId },
            "Skipping in-thread error reply because parent review comment no longer exists",
          );
        } else {
          logger.warn(
            { err, prNumber: mention.prNumber, commentId: mention.commentId },
            "Could not verify parent review comment before posting error reply; falling back to top-level error comment",
          );
          parentReviewCommentExists = false;
        }
      }

      if (parentReviewCommentExists) {
        try {
          await createReviewReplyWithPublicationPipeline(octokit, {
            owner: mention.owner,
            repo: mention.repo,
            pull_number: mention.prNumber,
            comment_id: mention.commentId,
            body: sanitizedBody,
            botHandles: possibleHandles,
            preserveKodiaiMarkers: true,
          });
          return resultOk("review-thread-reply");
        } catch (err) {
          logger.warn(
            { err, prNumber: mention.prNumber, commentId: mention.commentId },
            "Failed to post in-thread error reply; falling back to top-level error comment",
          );
        }
      }
    }

    const commentStatus = await postOrUpdateErrorComment(
      octokit,
      {
        owner: mention.owner,
        repo: mention.repo,
        issueNumber: mention.issueNumber,
      },
      sanitizedBody,
      logger,
    );

    if (commentStatus.ok) {
      return resultOk(
        commentStatus.value.resolution === "updated"
          ? "error-comment-updated"
          : "error-comment-created",
      );
    }

    return resultErr(toError(commentStatus.err));
  }

  return { postMentionReply, postMentionError };
}

export async function postMentionHandlerError(params: {
  githubApp: GitHubApp;
  installationId: number;
  mention: MentionEvent;
  possibleHandles: string[];
  logger: Logger;
  guardrailAuditStore?: GuardrailAuditStore;
  errorBody: string;
}): Promise<void> {
  const errOctokit = await params.githubApp.getInstallationOctokit(params.installationId);
  const publisher = createMentionPublisher({
    octokit: errOctokit,
    mention: params.mention,
    possibleHandles: params.possibleHandles,
    logger: params.logger,
    guardrailAuditStore: params.guardrailAuditStore,
  });
  await publisher.postMentionError(params.errorBody);
}
