import type { MentionEvent } from "../handlers/mention-types.ts";
import { sanitizeContent } from "../lib/sanitizer.ts";

/**
 * Build the prompt for a mention-triggered execution.
 *
 * Includes conversation context, the user's question (with @mention stripped),
 * response instructions, and optional custom instructions from .kodiai.yml.
 */
export function buildMentionPrompt(params: {
  mention: MentionEvent;
  mentionContext: string;
  userQuestion: string;
  customInstructions?: string;
}): string {
  const { mention, mentionContext, userQuestion, customInstructions } = params;
  const lines: string[] = [];

  // Context header
  lines.push(`You are assisting with a question in ${mention.owner}/${mention.repo}.`);
  if (mention.prNumber !== undefined) {
    lines.push(`This is about Pull Request #${mention.prNumber}.`);
  } else {
    lines.push(`This is about Issue #${mention.issueNumber}.`);
  }

  if (mention.surface === "pr_review_comment") {
    lines.push(
      `This mention was triggered by an inline PR review comment (review comment id: ${mention.commentId}).`,
    );
  }
  lines.push("");

  // Context (optional)
  if (mentionContext.trim().length > 0) {
    lines.push(mentionContext);
    lines.push("");
  }

  // User's question
  lines.push("## User's Question");
  lines.push("");
  lines.push(`@${mention.commentAuthor} asked:`);
  lines.push(sanitizeContent(userQuestion));
  lines.push("");

  // Response instructions
  lines.push("## How to respond");
  lines.push("");
  lines.push(
    "Important: The handler already added an eyes reaction for tracking. Do not post a separate tracking/ack comment.",
  );
  lines.push(
    "Only post a reply if you have something concrete to contribute (a direct answer, a specific suggestion, or a clear next step).",
  );
  lines.push(
    "If you cannot provide a useful answer with the information available, DO NOT create a comment (do not call any commenting tools).",
  );
  lines.push("");

  if (mention.surface === "pr_review_comment") {
    lines.push(
      "Write your response by replying in the same inline thread using the `mcp__reviewCommentThread__reply_to_pr_review_comment` tool.",
    );
    lines.push(
      `Use: pullRequestNumber=${mention.prNumber} and commentId=${mention.commentId}.`,
    );
  } else {
    lines.push(
      `Write your response by creating a new top-level comment using the \`mcp__github_comment__create_comment\` tool on issue/PR #${mention.issueNumber}.`,
    );
  }
  lines.push("");
  lines.push("Your response should be:");
  lines.push("- Direct and helpful -- answer the question with specific code references where possible");
  lines.push("- Aware of the conversation context above -- don't repeat what's already been discussed");
  lines.push("- Formatted in GitHub-flavored markdown");
  lines.push(
    "- When listing items, use (1), (2), (3) format -- NEVER #1, #2, #3 (GitHub treats those as issue links)",
  );
  lines.push(
    "- ALWAYS wrap your ENTIRE response body in `<details>` tags to reduce noise in the thread:",
    "  ```",
    "  <details>",
    '  <summary>kodiai response</summary>',
    "  ",
    "  Your response content here...",
    "  ",
    "  </details>",
    "  ```",
    "- Important: include a blank line after `<summary>` and before `</details>` for proper markdown rendering",
  );

  // Custom instructions
  if (customInstructions) {
    lines.push("");
    lines.push("## Custom Instructions");
    lines.push("");
    lines.push(customInstructions);
  }

  return lines.join("\n");
}
