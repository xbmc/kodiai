import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { MentionEvent } from "./mention-types.ts";

export async function postMentionEyesReaction(params: {
  octokit: Octokit;
  mention: MentionEvent;
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  const { octokit, mention, logger } = params;

  try {
    if (mention.surface === "pr_review_comment") {
      await octokit.rest.reactions.createForPullRequestReviewComment({
        owner: mention.owner,
        repo: mention.repo,
        comment_id: mention.commentId,
        content: "eyes",
      });
      return;
    }

    if (mention.surface === "pr_review_body") {
      return;
    }

    await octokit.rest.reactions.createForIssueComment({
      owner: mention.owner,
      repo: mention.repo,
      comment_id: mention.commentId,
      content: "eyes",
    });
  } catch (err) {
    logger.warn({ err, surface: mention.surface }, "Failed to add eyes reaction");
  }
}
