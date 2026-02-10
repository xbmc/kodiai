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
    "Do NOT create a 'thinking'/'working on it' comment. Create at most ONE comment total, and only when you are ready to provide the final response.",
  );
  lines.push(
    "Do NOT update comments (avoid using update_comment); post a single final response instead.",
  );
  lines.push(
    "You MUST post a reply when you are mentioned. If you do not have enough information to fully answer, ask 1-3 targeted clarifying questions instead of staying silent.",
  );
  lines.push("");

  if (mention.surface === "pr_review_comment") {
    lines.push(
      "Write your response by replying in the same inline thread using the `mcp__reviewCommentThread__reply_to_pr_review_comment` tool.",
    );
    lines.push(
      `Use: pullRequestNumber=${mention.prNumber} and commentId=${mention.commentId}.`,
    );
    lines.push(
      "If the thread reply tool fails for any reason, fall back to posting a single top-level reply using `mcp__github_comment__create_comment` on the PR.",
    );
  } else {
    lines.push(
      `Write your response by creating a new top-level comment using the \`mcp__github_comment__create_comment\` tool on issue/PR #${mention.issueNumber}.`,
    );
  }
  lines.push("");
  lines.push("Your response should be:");
  lines.push(
    "- Concise by default -- provide only what was asked; avoid long recaps",
  );
  lines.push(
    '- Do NOT include sections like "What Changed", "Key Strengths", or "Minor Observations" unless explicitly requested',
  );
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

  lines.push("- If (and only if) the user is asking for a PR review / approval decision, use this exact structure:");
  lines.push(
    "  ```",
    "  <details>",
    '  <summary>kodiai response</summary>',
    "  ",
    "  Decision: APPROVE | NOT APPROVED",
    "  Issues:",
    "  - (1) [critical|major|minor] <issue summary> (include file:line if applicable)",
    "  ",
    "  </details>",
    "  ```",
  );
  lines.push(
    "  Notes:",
    "  - If APPROVE: keep it to 1-2 lines and set `Issues: none`.",
    "  - If NOT APPROVED: list only the issues; do not include strengths or change summaries.",
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
