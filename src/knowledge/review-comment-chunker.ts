import type { ReviewCommentInput, ReviewCommentChunk } from "./review-comment-types.ts";

const DEFAULT_BOT_LOGINS = new Set([
  "dependabot",
  "renovate",
  "kodiai",
  "github-actions",
  "codecov",
]);

/** Simple whitespace-based token count approximation. */
export function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Check if a login looks like a bot.
 * Matches explicit bot logins or accounts ending with [bot].
 */
function isBot(login: string, botLogins: Set<string>): boolean {
  const lower = login.toLowerCase();
  if (botLogins.has(lower)) return true;
  if (lower.endsWith("[bot]")) return true;
  return false;
}

/**
 * Generate a thread ID for grouping comments.
 * File-level: "{repo}:{prNumber}:{filePath}:{originalPosition}"
 * PR-level:   "{repo}:{prNumber}:general:{reviewId}"
 */
export function generateThreadId(comment: ReviewCommentInput): string {
  if (comment.filePath && comment.originalPosition != null) {
    return `${comment.repo}:${comment.prNumber}:${comment.filePath}:${comment.originalPosition}`;
  }
  if (comment.reviewId != null) {
    return `${comment.repo}:${comment.prNumber}:general:${comment.reviewId}`;
  }
  // Fallback: use the comment's own GitHub ID as thread root
  return `${comment.repo}:${comment.prNumber}:general:${comment.commentGithubId}`;
}

/**
 * Format a single comment for concatenation into thread text.
 */
function formatComment(comment: ReviewCommentInput): string {
  const dateStr = comment.githubCreatedAt.toISOString().split("T")[0];
  return `@${comment.authorLogin} (${dateStr}): ${comment.body}`;
}

export type ChunkOptions = {
  botLogins?: Set<string>;
  windowSize?: number;
  overlapSize?: number;
};

/**
 * Chunk a review thread into embeddable units.
 *
 * - Filters out bot comments (keeps thread if human comments remain)
 * - Concatenates thread into single text with author attribution
 * - Produces single chunk if <= windowSize tokens, otherwise sliding window
 *   with overlapSize token overlap
 *
 * @param thread - Comments belonging to the same thread, ordered by github_created_at
 * @param opts - Configuration options
 * @returns Array of ReviewCommentChunk ready for storage
 */
export function chunkReviewThread(
  thread: ReviewCommentInput[],
  opts: ChunkOptions = {},
): ReviewCommentChunk[] {
  if (thread.length === 0) return [];

  const botLogins = opts.botLogins ?? DEFAULT_BOT_LOGINS;
  const windowSize = opts.windowSize ?? 1024;
  const overlapSize = opts.overlapSize ?? 256;

  // Filter out bot comments
  const humanComments = thread.filter((c) => !isBot(c.authorLogin, botLogins));
  if (humanComments.length === 0) return [];

  // Use the first comment (thread root) for metadata
  const root = humanComments[0]!;
  const threadId = generateThreadId(root);

  // Concatenate thread text
  const threadText = humanComments.map(formatComment).join("\n");
  const totalTokens = countTokens(threadText);

  // Build base metadata from root
  const baseMeta = {
    repo: root.repo,
    owner: root.owner,
    prNumber: root.prNumber,
    prTitle: root.prTitle ?? null,
    commentGithubId: root.commentGithubId,
    threadId,
    inReplyToId: root.inReplyToId ?? null,
    filePath: root.filePath ?? null,
    startLine: root.startLine ?? null,
    endLine: root.endLine ?? null,
    diffHunk: root.diffHunk ?? null,
    authorLogin: root.authorLogin,
    authorAssociation: root.authorAssociation ?? null,
    body: root.body,
    githubCreatedAt: root.githubCreatedAt,
    githubUpdatedAt: root.githubUpdatedAt ?? null,
    backfillBatch: null,
  };

  // Single chunk case
  if (totalTokens <= windowSize) {
    return [
      {
        ...baseMeta,
        chunkIndex: 0,
        chunkText: threadText,
        tokenCount: totalTokens,
      },
    ];
  }

  // Sliding window chunking
  const words = threadText.split(/\s+/).filter(Boolean);
  const chunks: ReviewCommentChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(start + windowSize, words.length);
    const chunkWords = words.slice(start, end);
    const chunkText = chunkWords.join(" ");

    chunks.push({
      ...baseMeta,
      chunkIndex,
      chunkText,
      tokenCount: chunkWords.length,
    });

    chunkIndex++;

    // Advance by (windowSize - overlapSize) tokens
    const step = windowSize - overlapSize;
    start += step;

    // If we've already reached the end, stop
    if (end >= words.length) break;
  }

  return chunks;
}
