import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewCommentChunk, ReviewCommentInput, ReviewCommentStore } from "./review-comment-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import { chunkReviewThread } from "./review-comment-chunker.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export type BackfillResult = {
  totalComments: number;
  totalChunks: number;
  totalEmbeddings: number;
  pagesProcessed: number;
  durationMs: number;
  resumed: boolean;
};

export type BackfillOptions = {
  octokit: Octokit;
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  repo: string; // "owner/repo"
  monthsBack?: number; // default 18
  botLogins?: Set<string>;
  logger: Logger;
  dryRun?: boolean;
};

export type SyncSinglePROptions = {
  octokit: Octokit;
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  prNumber: number;
  botLogins?: Set<string>;
  logger: Logger;
  dryRun?: boolean;
};

// ── GitHub API types ────────────────────────────────────────────────────────

type GitHubPullComment = {
  id: number;
  pull_request_review_id: number | null;
  in_reply_to_id?: number;
  diff_hunk: string;
  path: string;
  original_position?: number | null;
  position?: number | null;
  start_line?: number | null;
  line?: number | null;
  original_start_line?: number | null;
  original_line?: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    type: string;
  } | null;
  author_association: string;
  // pull_request_url contains the PR number at the end
  pull_request_url: string;
};

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_BOT_LOGINS = new Set([
  "dependabot",
  "renovate",
  "kodiai",
  "github-actions",
  "codecov",
]);

// ── Rate limiter ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adaptiveRateDelay(
  headers: Record<string, string | undefined> | undefined,
  logger: Logger,
  pageNum: number,
): Promise<void> {
  if (!headers) return;

  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "5000", 10);
  const limit = parseInt(headers["x-ratelimit-limit"] ?? "5000", 10);

  // Log rate limit status every 10 pages
  if (pageNum % 10 === 0) {
    logger.info({ remaining, limit, page: pageNum }, "Rate limit status");
  }

  const ratio = remaining / limit;

  if (ratio < 0.2) {
    logger.warn({ remaining, limit }, "Rate limit low (<20%) -- adding 3s delay");
    await sleep(3000);
  } else if (ratio < 0.5) {
    logger.info({ remaining, limit }, "Rate limit moderate (<50%) -- adding 1.5s delay");
    await sleep(1500);
  }
  // else: no delay needed
}

// ── Thread grouping ─────────────────────────────────────────────────────────

function extractPRNumber(pullRequestUrl: string): number {
  const match = pullRequestUrl.match(/\/pulls\/(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 0;
}

/**
 * Group flat GitHub API comments into threads.
 *
 * - Comments with `in_reply_to_id` are replies -- group with parent
 * - Comments without `in_reply_to_id` that share same `pull_request_review_id` are thread roots
 * - Standalone comments (no reply, unique review) are single-comment threads
 */
export function groupCommentsIntoThreads(
  comments: GitHubPullComment[],
  repo: string,
  botLogins: Set<string>,
): ReviewCommentInput[][] {
  // Build a map of comment ID -> comment for reply lookups
  const byId = new Map<number, GitHubPullComment>();
  for (const c of comments) {
    byId.set(c.id, c);
  }

  // Group by thread: use in_reply_to_id to find root, then group by root ID
  const threadMap = new Map<number, GitHubPullComment[]>();

  for (const comment of comments) {
    // Skip bot comments early
    if (comment.user) {
      const login = comment.user.login.toLowerCase();
      if (botLogins.has(login) || login.endsWith("[bot]") || comment.user.type === "Bot") {
        continue;
      }
    } else {
      continue; // skip comments with null user
    }

    // Find root: if this is a reply, trace back to root
    let rootId = comment.id;
    if (comment.in_reply_to_id) {
      rootId = comment.in_reply_to_id;
    }

    const existing = threadMap.get(rootId);
    if (existing) {
      existing.push(comment);
    } else {
      threadMap.set(rootId, [comment]);
    }
  }

  const [owner, repoName] = repo.split("/");
  const threads: ReviewCommentInput[][] = [];

  for (const threadComments of threadMap.values()) {
    // Sort by created_at within thread
    threadComments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const inputs: ReviewCommentInput[] = threadComments.map((c) => ({
      repo,
      owner: owner ?? repo,
      prNumber: extractPRNumber(c.pull_request_url),
      commentGithubId: c.id,
      inReplyToId: c.in_reply_to_id ?? null,
      filePath: c.path ?? null,
      startLine: c.start_line ?? c.original_start_line ?? null,
      endLine: c.line ?? c.original_line ?? null,
      diffHunk: c.diff_hunk ?? null,
      authorLogin: c.user!.login,
      authorAssociation: c.author_association ?? null,
      body: c.body,
      githubCreatedAt: new Date(c.created_at),
      githubUpdatedAt: c.updated_at ? new Date(c.updated_at) : null,
      originalPosition: c.original_position ?? c.position ?? null,
      reviewId: c.pull_request_review_id ?? null,
    }));

    threads.push(inputs);
  }

  return threads;
}

// ── Embedding helper ────────────────────────────────────────────────────────

async function embedChunks(
  chunks: ReviewCommentChunk[],
  embeddingProvider: EmbeddingProvider,
  store: ReviewCommentStore,
  logger: Logger,
  dryRun: boolean,
): Promise<{ embeddingsGenerated: number; embeddingsFailed: number }> {
  let embeddingsGenerated = 0;
  let embeddingsFailed = 0;

  for (const chunk of chunks) {
    try {
      const result = await embeddingProvider.generate(chunk.chunkText, "document");
      if (result) {
        chunk.embedding = result;
        embeddingsGenerated++;
      } else {
        chunk.embedding = null;
        embeddingsFailed++;
      }
    } catch {
      chunk.embedding = null;
      embeddingsFailed++;
    }
  }

  return { embeddingsGenerated, embeddingsFailed };
}

// ── Main backfill ───────────────────────────────────────────────────────────

/**
 * Backfill review comments for a repository from the GitHub API.
 *
 * Pages through `GET /repos/{owner}/{repo}/pulls/comments` sorted by created_at ASC,
 * groups comments into threads, chunks them, generates embeddings, and stores them.
 *
 * Supports cursor-based resume via review_comment_sync_state table.
 */
export async function backfillReviewComments(opts: BackfillOptions): Promise<BackfillResult> {
  const {
    octokit,
    store,
    embeddingProvider,
    repo,
    monthsBack = 18,
    logger,
    dryRun = false,
  } = opts;

  const botLogins = opts.botLogins ?? DEFAULT_BOT_LOGINS;
  const startTime = Date.now();
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }

  // ── Resume check ──────────────────────────────────────────────────────────
  const syncState = await store.getSyncState(repo);
  let resumed = false;

  if (syncState?.backfillComplete) {
    logger.info({ repo }, "Backfill already complete for repo -- skipping");
    return {
      totalComments: syncState.totalCommentsSynced,
      totalChunks: 0,
      totalEmbeddings: 0,
      pagesProcessed: 0,
      durationMs: Date.now() - startTime,
      resumed: true,
    };
  }

  // Calculate since date: use sync state if resuming, otherwise monthsBack
  let sinceDate: Date;
  if (syncState?.lastSyncedAt) {
    sinceDate = syncState.lastSyncedAt;
    resumed = true;
    logger.info(
      { repo, resumeFrom: sinceDate.toISOString(), totalSoFar: syncState.totalCommentsSynced },
      "Resuming backfill from last sync point",
    );
  } else {
    sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - monthsBack);
    logger.info(
      { repo, since: sinceDate.toISOString(), monthsBack },
      "Starting fresh backfill",
    );
  }

  // ── Pagination loop ───────────────────────────────────────────────────────
  let page = 1;
  let totalComments = syncState?.totalCommentsSynced ?? 0;
  let totalChunks = 0;
  let totalEmbeddings = 0;
  let pagesProcessed = 0;
  let lastCommentDate: Date | null = null;

  while (true) {
    const response = await octokit.rest.pulls.listReviewCommentsForRepo({
      owner,
      repo: repoName,
      sort: "created",
      direction: "asc",
      since: sinceDate.toISOString(),
      per_page: 100,
      page,
    });

    const comments = response.data as unknown as GitHubPullComment[];
    pagesProcessed++;

    if (comments.length === 0) {
      logger.info({ page, repo }, "Empty page -- backfill pagination complete");
      break;
    }

    // Apply rate limiting based on response headers
    await adaptiveRateDelay(
      response.headers as unknown as Record<string, string | undefined>,
      logger,
      page,
    );

    // Group into threads and chunk
    const threads = groupCommentsIntoThreads(comments, repo, botLogins);

    let batchChunks = 0;
    let batchEmbeddings = 0;
    let batchEmbeddingsFailed = 0;
    const humanCommentCount = threads.reduce((sum, t) => sum + t.length, 0);

    for (const thread of threads) {
      const chunks = chunkReviewThread(thread, { botLogins });

      if (chunks.length === 0) continue;

      // Generate embeddings (fail-open: store chunk even without embedding)
      const { embeddingsGenerated, embeddingsFailed } = await embedChunks(
        chunks,
        embeddingProvider,
        store,
        logger,
        dryRun,
      );

      if (!dryRun) {
        await store.writeChunks(chunks);
      }

      batchChunks += chunks.length;
      batchEmbeddings += embeddingsGenerated;
      batchEmbeddingsFailed += embeddingsFailed;
    }

    totalComments += humanCommentCount;
    totalChunks += batchChunks;
    totalEmbeddings += batchEmbeddings;

    // Track last comment date for sync state
    const lastComment = comments[comments.length - 1]!;
    lastCommentDate = new Date(lastComment.created_at);

    // Verbose logging per batch
    logger.info(
      {
        page,
        commentsInBatch: comments.length,
        humanComments: humanCommentCount,
        threadCount: threads.length,
        chunksProduced: batchChunks,
        embeddingsGenerated: batchEmbeddings,
        embeddingsFailed: batchEmbeddingsFailed,
        totalSoFar: totalComments,
        rateRemaining: response.headers?.["x-ratelimit-remaining"] ?? "unknown",
      },
      "Backfill batch processed",
    );

    // Update sync state after each page
    if (!dryRun && lastCommentDate) {
      await store.updateSyncState({
        repo,
        lastSyncedAt: lastCommentDate,
        lastPageCursor: String(page),
        totalCommentsSynced: totalComments,
        backfillComplete: false,
      });
    }

    // If we got fewer than 100 comments, we're at the end
    if (comments.length < 100) {
      break;
    }

    page++;
  }

  // Mark backfill complete
  if (!dryRun) {
    await store.updateSyncState({
      repo,
      lastSyncedAt: lastCommentDate ?? sinceDate,
      lastPageCursor: String(page),
      totalCommentsSynced: totalComments,
      backfillComplete: true,
    });
  }

  const durationMs = Date.now() - startTime;

  logger.info(
    {
      repo,
      totalComments,
      totalChunks,
      totalEmbeddings,
      pagesProcessed,
      durationMs,
      resumed,
    },
    "Backfill complete",
  );

  return {
    totalComments,
    totalChunks,
    totalEmbeddings,
    pagesProcessed,
    durationMs,
    resumed,
  };
}

// ── Single PR sync ──────────────────────────────────────────────────────────

/**
 * Fetch and process all review comments for a single PR.
 * Useful for re-syncing a specific PR or adding new PRs incrementally.
 */
export async function syncSinglePR(opts: SyncSinglePROptions): Promise<{ chunksWritten: number }> {
  const {
    octokit,
    store,
    embeddingProvider,
    repo,
    prNumber,
    logger,
    dryRun = false,
  } = opts;

  const botLogins = opts.botLogins ?? DEFAULT_BOT_LOGINS;
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }

  logger.info({ repo, prNumber }, "Syncing single PR review comments");

  // Fetch all comments for this PR (paginated)
  const allComments: GitHubPullComment[] = [];
  let page = 1;

  while (true) {
    const response = await octokit.rest.pulls.listReviewComments({
      owner,
      repo: repoName,
      pull_number: prNumber,
      per_page: 100,
      page,
    });

    const comments = response.data as unknown as GitHubPullComment[];
    if (comments.length === 0) break;

    allComments.push(...comments);

    if (comments.length < 100) break;
    page++;
  }

  if (allComments.length === 0) {
    logger.info({ repo, prNumber }, "No review comments found for PR");
    return { chunksWritten: 0 };
  }

  // Group into threads
  const threads = groupCommentsIntoThreads(allComments, repo, botLogins);

  let chunksWritten = 0;

  for (const thread of threads) {
    const chunks = chunkReviewThread(thread, { botLogins });
    if (chunks.length === 0) continue;

    // Generate embeddings (fail-open)
    await embedChunks(chunks, embeddingProvider, store, logger, dryRun);

    if (!dryRun) {
      await store.writeChunks(chunks);
    }

    chunksWritten += chunks.length;
  }

  logger.info(
    { repo, prNumber, totalComments: allComments.length, chunksWritten },
    "Single PR sync complete",
  );

  return { chunksWritten };
}
