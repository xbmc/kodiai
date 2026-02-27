import type { Logger } from "pino";
import type { IssueCommentRecord, IssueStore } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";

export type ThreadAssemblyResult = {
  issueNumber: number;
  title: string;
  body: string;
  tailComments: string[];
  semanticComments: string[];
  totalChars: number;
};

/**
 * Truncate a long issue body to first paragraph + last paragraph.
 * Short bodies (under maxChars) are returned unchanged.
 */
export function truncateIssueBody(body: string, maxChars: number = 500): string {
  if (body.length <= maxChars) return body;

  const paragraphs = body.split(/\n\n+/).filter((p) => p.length > 0);

  if (paragraphs.length <= 2) {
    return body.slice(0, maxChars) + "...";
  }

  const result = `${paragraphs[0]}\n\n[...]\n\n${paragraphs[paragraphs.length - 1]}`;

  if (result.length > maxChars * 1.5) {
    return result.slice(0, maxChars) + "...";
  }

  return result;
}

/**
 * Select comments from the tail (most recent) of a thread within a character budget.
 * Comments arrive ordered by github_created_at ASC; we take from the end first.
 */
export function selectTailComments(
  comments: IssueCommentRecord[],
  charBudget: number,
): { selected: IssueCommentRecord[]; remaining: IssueCommentRecord[]; charsUsed: number } {
  if (comments.length === 0 || charBudget <= 0) {
    return { selected: [], remaining: [...comments], charsUsed: 0 };
  }

  const selected: IssueCommentRecord[] = [];
  let charsUsed = 0;

  // Iterate from the end (most recent first)
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i]!;
    if (charsUsed + comment.body.length <= charBudget) {
      selected.unshift(comment); // maintain chronological order
      charsUsed += comment.body.length;
    } else {
      break;
    }
  }

  const selectedIds = new Set(selected.map((c) => c.commentGithubId));
  const remaining = comments.filter((c) => !selectedIds.has(c.commentGithubId));

  return { selected, remaining, charsUsed };
}

/**
 * Distribute a character budget across matches, weighted by cosine similarity.
 * Higher similarity (lower distance) gets proportionally more budget.
 */
export function computeBudgetDistribution(
  matches: Array<{ distance: number }>,
  totalBudget: number,
): number[] {
  if (matches.length === 0) return [];
  if (matches.length === 1) return [totalBudget];

  const similarities = matches.map((m) => 1 - m.distance);
  const totalSim = similarities.reduce((sum, s) => sum + s, 0);

  if (totalSim === 0) {
    // All distances are 1.0 — distribute evenly
    const even = Math.floor(totalBudget / matches.length);
    return matches.map(() => even);
  }

  return similarities.map((sim) => Math.floor((sim / totalSim) * totalBudget));
}

/**
 * Assemble a resolution-focused thread for a single issue.
 * Prioritizes tail comments (where fixes live), then fills with semantically relevant comments.
 */
export async function assembleIssueThread(params: {
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  issueNumber: number;
  queryEmbedding: Float32Array;
  charBudget: number;
  logger: Logger;
}): Promise<ThreadAssemblyResult> {
  const { issueStore, repo, issueNumber, queryEmbedding, charBudget, logger } = params;

  // Get issue record
  const record = await issueStore.getByNumber(repo, issueNumber);
  if (!record) {
    throw new Error(`Issue ${repo}#${issueNumber} not found`);
  }

  // Truncate body
  const body = truncateIssueBody(record.body ?? "");
  const remainingBudget = Math.max(0, charBudget - body.length);

  // Get all comments
  const comments = await issueStore.getCommentsByIssue(repo, issueNumber);
  if (comments.length === 0) {
    return {
      issueNumber,
      title: record.title,
      body,
      tailComments: [],
      semanticComments: [],
      totalChars: body.length,
    };
  }

  // Allocate ~60% of remaining budget to tail comments
  const tailBudget = Math.floor(remainingBudget * 0.6);
  const tailResult = selectTailComments(comments, tailBudget);

  // Fill remaining with semantic comments
  const semanticBudget = remainingBudget - tailResult.charsUsed;
  const semanticComments: string[] = [];
  let semanticChars = 0;

  if (tailResult.remaining.length > 0 && semanticBudget > 0) {
    const commentSearchResults = await issueStore.searchCommentsByEmbedding({
      queryEmbedding,
      repo,
      topK: 20,
    });

    // Filter to only comments in the remaining set
    const remainingIds = new Set(tailResult.remaining.map((c) => c.commentGithubId));
    const relevantComments = commentSearchResults
      .filter((r) => remainingIds.has(r.record.commentGithubId))
      .sort((a, b) => a.distance - b.distance);

    for (const result of relevantComments) {
      if (semanticChars + result.record.body.length > semanticBudget) break;
      semanticComments.push(result.record.body);
      semanticChars += result.record.body.length;
    }
  }

  const totalChars = body.length + tailResult.charsUsed + semanticChars;

  logger.debug(
    { issueNumber, bodyChars: body.length, tailChars: tailResult.charsUsed, semanticChars, totalChars },
    "Thread assembled",
  );

  return {
    issueNumber,
    title: record.title,
    body,
    tailComments: tailResult.selected.map((c) => c.body),
    semanticComments,
    totalChars,
  };
}
