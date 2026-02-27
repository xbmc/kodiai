import { countTokens } from "./review-comment-chunker.ts";

// ── Default bot logins ───────────────────────────────────────────────────────

const DEFAULT_BOT_LOGINS = new Set([
  "dependabot",
  "renovate",
  "kodiai",
  "github-actions",
  "codecov",
  "stale",
  "kodi-butler",
]);

// ── Bot detection ────────────────────────────────────────────────────────────

/**
 * Check if a login belongs to a bot account.
 * Matches explicit bot logins from the default set (or custom set)
 * and accounts ending with [bot].
 */
export function isBotComment(login: string, botLogins?: Set<string>): boolean {
  const logins = botLogins ?? DEFAULT_BOT_LOGINS;
  const lower = login.toLowerCase();
  if (logins.has(lower)) return true;
  if (lower.endsWith("[bot]")) return true;
  return false;
}

// ── Embedding text builders ──────────────────────────────────────────────────

/**
 * Build the embedding text for an issue.
 * Returns title if no body, otherwise title + body.
 */
export function buildIssueEmbeddingText(title: string, body: string | null): string {
  if (!body) return title;
  return `${title}\n\n${body}`;
}

/**
 * Build the embedding text for a single issue comment.
 * Prefixes with parent issue context so the vector captures what the comment is about.
 */
export function buildCommentEmbeddingText(
  issueNumber: number,
  issueTitle: string,
  commentBody: string,
): string {
  return `Issue #${issueNumber}: ${issueTitle}\n\n${commentBody}`;
}

// ── Comment chunking ─────────────────────────────────────────────────────────

export type ChunkOptions = {
  maxTokens?: number;
  overlap?: number;
};

/**
 * Chunk a long issue comment into embeddable pieces with sliding window overlap.
 * Each chunk is prefixed with issue context.
 *
 * Short comments (within maxTokens) return a single-element array.
 * Long comments are split using a sliding window with overlap.
 */
export function chunkIssueComment(
  issueNumber: number,
  issueTitle: string,
  commentBody: string,
  opts?: ChunkOptions,
): string[] {
  const maxTokens = opts?.maxTokens ?? 1024;
  const overlap = opts?.overlap ?? 256;

  const fullText = buildCommentEmbeddingText(issueNumber, issueTitle, commentBody);
  const totalTokens = countTokens(fullText);

  // Short comment: single chunk
  if (totalTokens <= maxTokens) {
    return [fullText];
  }

  // Long comment: sliding window chunking
  // Keep the prefix on every chunk
  const prefix = `Issue #${issueNumber}: ${issueTitle}\n\n`;
  const bodyWords = commentBody.split(/\s+/).filter(Boolean);
  const prefixTokens = countTokens(prefix);
  const bodyBudget = maxTokens - prefixTokens;

  if (bodyBudget <= 0) {
    // Prefix alone exceeds budget -- just return the full text as one chunk
    return [fullText];
  }

  const chunks: string[] = [];
  let start = 0;
  const step = Math.max(1, bodyBudget - overlap);

  while (start < bodyWords.length) {
    const end = Math.min(start + bodyBudget, bodyWords.length);
    const chunkBody = bodyWords.slice(start, end).join(" ");
    chunks.push(`${prefix}${chunkBody}`);

    if (end >= bodyWords.length) break;
    start += step;
  }

  return chunks;
}
