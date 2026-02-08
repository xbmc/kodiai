import type { Octokit } from "@octokit/rest";
import type { MentionEvent } from "../handlers/mention-types.ts";
import { sanitizeContent, filterCommentsToTriggerTime } from "../lib/sanitizer.ts";

/**
 * Fetch conversation context appropriate to the mention surface.
 *
 * - Always fetches recent issue/PR comments (general discussion).
 * - For PR surfaces, also fetches PR metadata (title, author, branches, description).
 * - For pr_review_comment, includes the diff hunk context.
 */
export async function buildConversationContext(
  octokit: Octokit,
  mention: MentionEvent,
): Promise<string> {
  const lines: string[] = [];

  // Fetch recent issue/PR comments (general discussion)
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: mention.owner,
    repo: mention.repo,
    issue_number: mention.issueNumber,
    per_page: 30,
  });

  // TOCTOU: Only include comments that existed before the trigger event
  const safeComments = filterCommentsToTriggerTime(comments, mention.commentCreatedAt);

  lines.push("## Conversation History");
  for (const comment of safeComments) {
    // Skip bot tracking comments
    if (comment.body?.startsWith('> **Kodiai**')) continue;
    lines.push(`### @${comment.user?.login} (${comment.created_at}):`);
    lines.push(sanitizeContent(comment.body ?? "(empty)"));
    lines.push("");
  }

  // For PR surfaces, add PR metadata
  if (mention.prNumber !== undefined) {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: mention.owner,
      repo: mention.repo,
      pull_number: mention.prNumber,
    });
    lines.push("## Pull Request Context");
    lines.push(`Title: ${sanitizeContent(pr.title)}`);
    lines.push(`Author: ${pr.user?.login}`);
    lines.push(`Branches: ${pr.head.ref} -> ${pr.base.ref}`);
    if (pr.body) {
      lines.push(`Description: ${sanitizeContent(pr.body)}`);
    }
    lines.push("");
  }

  // For review comment surface, include the diff hunk
  if (mention.surface === "pr_review_comment" && mention.diffHunk) {
    lines.push("## Code Context (Diff Hunk)");
    lines.push("The triggering comment is on a specific code change:");
    lines.push("```diff");
    lines.push(mention.diffHunk);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build the prompt for a mention-triggered execution.
 *
 * Includes conversation context, the user's question (with @mention stripped),
 * response instructions, and optional custom instructions from .kodiai.yml.
 */
export function buildMentionPrompt(params: {
  mention: MentionEvent;
  conversationContext: string;
  userQuestion: string;
  trackingCommentId?: number;
  customInstructions?: string;
}): string {
  const { mention, conversationContext, userQuestion, trackingCommentId, customInstructions } = params;
  const lines: string[] = [];

  // Context header
  lines.push(`You are assisting with a question in ${mention.owner}/${mention.repo}.`);
  if (mention.prNumber !== undefined) {
    lines.push(`This is about Pull Request #${mention.prNumber}.`);
  } else {
    lines.push(`This is about Issue #${mention.issueNumber}.`);
  }
  lines.push("");

  // Conversation context
  lines.push(conversationContext);
  lines.push("");

  // User's question
  lines.push("## User's Question");
  lines.push("");
  lines.push(`@${mention.commentAuthor} asked:`);
  lines.push(sanitizeContent(userQuestion));
  lines.push("");

  // Response instructions
  lines.push("## How to respond");
  lines.push("");
  if (trackingCommentId) {
    lines.push(
      `Write your response by updating the tracking comment using the \`mcp__github_comment__update_comment\` tool with comment ID ${trackingCommentId}.`,
    );
  } else {
    lines.push(
      `Write your response by creating a new comment using the \`mcp__github_comment__create_comment\` tool on issue/PR #${mention.issueNumber}.`,
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
    "- If your response is longer than 500 characters, wrap the ENTIRE response body in `<details>` tags:",
    "  ```",
    "  <details>",
    '  <summary>Click to expand response</summary>',
    "  ",
    "  Your response content here...",
    "  ",
    "  </details>",
    "  ```",
    "- Important: include a blank line after `<summary>` and before `</details>` for proper markdown rendering",
    "- Short responses (under 500 characters) should NOT be wrapped",
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
