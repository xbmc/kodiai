import type { Octokit } from "@octokit/rest";
import type { MentionEvent } from "../handlers/mention-types.ts";
import {
  filterCommentsToTriggerTime,
  sanitizeContent,
} from "../lib/sanitizer.ts";

export type BuildMentionContextOptions = {
  /** Max number of conversation comments to include (after filtering). */
  maxComments?: number;
  /** Max characters to include per comment body (after sanitization). */
  maxCommentChars?: number;
  /** Max characters to include from PR description (after sanitization). */
  maxPrBodyChars?: number;
};

const DEFAULT_MAX_COMMENTS = 20;
const DEFAULT_MAX_COMMENT_CHARS = 800;
const DEFAULT_MAX_PR_BODY_CHARS = 1200;

function truncateDeterministic(input: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (input.length <= maxChars) return input;
  const clipped = input.slice(0, maxChars).trimEnd();
  return `${clipped}\n...[truncated]`;
}

function isLegacyBotTrackingComment(body: string | null | undefined): boolean {
  // Phase 9 used a tracking comment pattern. Keep skipping it so mention
  // context stays focused on the human conversation.
  return !!body && body.startsWith("> **Kodiai**");
}

/**
 * Build a bounded, sanitized context string for mention replies.
 *
 * Includes:
 * - Recent issue/PR comments filtered to the mention trigger timestamp (TOCTOU)
 * - PR metadata for PR surfaces
 * - Inline review metadata + diff hunk for pr_review_comment
 */
export async function buildMentionContext(
  octokit: Octokit,
  mention: MentionEvent,
  options: BuildMentionContextOptions = {},
): Promise<string> {
  const maxComments = options.maxComments ?? DEFAULT_MAX_COMMENTS;
  const maxCommentChars = options.maxCommentChars ?? DEFAULT_MAX_COMMENT_CHARS;
  const maxPrBodyChars = options.maxPrBodyChars ?? DEFAULT_MAX_PR_BODY_CHARS;

  const lines: string[] = [];

  // --- Conversation context (issue/PR comments) ---
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: mention.owner,
    repo: mention.repo,
    issue_number: mention.issueNumber,
    per_page: 100,
  });

  const safeComments = filterCommentsToTriggerTime(
    comments,
    mention.commentCreatedAt,
  ).filter((c) => !isLegacyBotTrackingComment(c.body));

  // Ensure determinism regardless of API ordering.
  const sortedComments = [...safeComments].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  const boundedComments =
    maxComments > 0 ? sortedComments.slice(-maxComments) : [];

  lines.push("## Conversation History");
  lines.push(
    `Included: ${boundedComments.length} comment(s) (filtered to trigger time: ${mention.commentCreatedAt})`,
  );
  lines.push("");

  for (const comment of boundedComments) {
    const author = comment.user?.login ?? "unknown";
    const bodyRaw = comment.body ?? "(empty)";
    const bodySanitized = sanitizeContent(bodyRaw);
    const body = truncateDeterministic(bodySanitized, maxCommentChars);
    lines.push(`### @${author} (${comment.created_at})`);
    lines.push(body);
    lines.push("");
  }

  // --- PR metadata ---
  if (mention.prNumber !== undefined) {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: mention.owner,
      repo: mention.repo,
      pull_number: mention.prNumber,
    });

    lines.push("## Pull Request Context");
    lines.push(`Title: ${sanitizeContent(pr.title)}`);
    lines.push(`Author: ${pr.user?.login ?? "unknown"}`);
    lines.push(`Branches: ${pr.head.ref} -> ${pr.base.ref}`);

    if (pr.body) {
      const body = truncateDeterministic(sanitizeContent(pr.body), maxPrBodyChars);
      lines.push("");
      lines.push("Description:");
      lines.push(body);
    }

    lines.push("");
  }

  // --- Inline review comment context (diff + file/line) ---
  if (mention.surface === "pr_review_comment") {
    lines.push("## Inline Review Comment Context");
    if (mention.filePath) lines.push(`File: ${mention.filePath}`);
    if (mention.fileLine !== undefined) lines.push(`Line: ${mention.fileLine}`);
    lines.push("");

    if (mention.diffHunk) {
      lines.push("Diff hunk:");
      lines.push("```diff");
      lines.push(sanitizeContent(mention.diffHunk));
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}
