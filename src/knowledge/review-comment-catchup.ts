import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewCommentChunk, ReviewCommentInput, ReviewCommentStore } from "./review-comment-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import { withRetry, groupCommentsIntoThreads, embedChunks } from "./review-comment-backfill.ts";
import { chunkReviewThread } from "./review-comment-chunker.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export type CatchUpSyncOptions = {
  octokit: Octokit;
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  repo: string; // "owner/repo"
  botLogins?: Set<string>;
  logger: Logger;
  dryRun?: boolean;
};

export type CatchUpSyncResult = {
  newComments: number;
  updatedComments: number;
  chunksWritten: number;
  pagesProcessed: number;
  durationMs: number;
};

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_BOT_LOGINS = new Set([
  "dependabot",
  "renovate",
  "kodiai",
  "github-actions",
  "codecov",
]);

// ── Main catch-up sync ──────────────────────────────────────────────────────

/**
 * Catch-up sync: fetches review comments since last_synced_at to fill gaps
 * from missed webhooks or downtime. Only runs when initial backfill is complete.
 *
 * For each comment fetched:
 * - New (not in store) -> chunk, embed, writeChunks
 * - Edited (github_updated_at differs) -> chunk, embed, updateChunks
 * - Unchanged (same github_updated_at) -> skip
 */
export async function catchUpReviewComments(opts: CatchUpSyncOptions): Promise<CatchUpSyncResult> {
  const {
    octokit,
    store,
    embeddingProvider,
    repo,
    logger,
    dryRun = false,
  } = opts;

  const botLogins = opts.botLogins ?? DEFAULT_BOT_LOGINS;
  const startTime = Date.now();
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }

  // ── Pre-condition: backfill must be complete ────────────────────────────
  const syncState = await store.getSyncState(repo);

  if (!syncState?.backfillComplete) {
    logger.info(
      { repo, backfillComplete: syncState?.backfillComplete ?? null },
      "Catch-up sync skipped -- backfill not complete",
    );
    return { newComments: 0, updatedComments: 0, chunksWritten: 0, pagesProcessed: 0, durationMs: Date.now() - startTime };
  }

  // ── Determine since date ───────────────────────────────────────────────
  let sinceDate: Date;
  if (syncState.lastSyncedAt) {
    sinceDate = syncState.lastSyncedAt;
  } else {
    // Safe default: 24 hours ago
    sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  logger.info(
    { repo, since: sinceDate.toISOString() },
    "Starting catch-up sync",
  );

  // ── Pagination loop ────────────────────────────────────────────────────
  let page = 1;
  let newComments = 0;
  let updatedComments = 0;
  let chunksWritten = 0;
  let pagesProcessed = 0;
  let latestUpdatedAt: Date | null = null;

  while (true) {
    const response = await withRetry(
      () => octokit.rest.pulls.listReviewCommentsForRepo({
        owner,
        repo: repoName,
        sort: "updated",
        direction: "asc",
        since: sinceDate.toISOString(),
        per_page: 100,
        page,
      }),
      { maxRetries: 3, baseDelayMs: 1, logger, context: { repo, page, operation: "catchUpSync" } },
    );

    const comments = response.data as unknown as Array<{
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
      user: { login: string; type: string } | null;
      author_association: string;
      pull_request_url: string;
    }>;

    pagesProcessed++;

    if (comments.length === 0) {
      logger.info({ page, repo }, "Empty page -- catch-up pagination complete");
      break;
    }

    // Track the latest updated_at across all comments for sync state watermark
    for (const c of comments) {
      const updatedAt = new Date(c.updated_at);
      if (!latestUpdatedAt || updatedAt > latestUpdatedAt) {
        latestUpdatedAt = updatedAt;
      }
    }

    // Group into threads
    const threads = groupCommentsIntoThreads(comments as any, repo, botLogins);

    let pageNew = 0;
    let pageUpdated = 0;
    let pageSkipped = 0;
    let pageChunks = 0;

    for (const thread of threads) {
      try {
        // Classify each comment in thread: new, edited, or unchanged
        let hasNew = false;
        let hasEdited = false;

        for (const input of thread) {
          const existing = await store.getByGithubId(repo, input.commentGithubId);
          if (!existing) {
            hasNew = true;
          } else {
            const apiUpdatedAt = input.githubUpdatedAt ? new Date(input.githubUpdatedAt).getTime() : null;
            const storedUpdatedAt = existing.githubUpdatedAt ? new Date(existing.githubUpdatedAt).getTime() : null;

            if (apiUpdatedAt && storedUpdatedAt && apiUpdatedAt > storedUpdatedAt) {
              hasEdited = true;
            }
            // else: unchanged, skip
          }
        }

        if (!hasNew && !hasEdited) {
          pageSkipped += thread.length;
          continue;
        }

        // Chunk the thread
        const chunks = chunkReviewThread(thread, { botLogins });
        if (chunks.length === 0) continue;

        // Generate embeddings (fail-open)
        await embedChunks(chunks, embeddingProvider, store, logger, dryRun);

        if (!dryRun) {
          if (hasEdited) {
            await store.updateChunks(chunks);
            updatedComments += thread.length;
            pageUpdated += thread.length;
          } else {
            await store.writeChunks(chunks);
            newComments += thread.length;
            pageNew += thread.length;
          }
        } else {
          // In dry-run, still count
          if (hasEdited) {
            updatedComments += thread.length;
            pageUpdated += thread.length;
          } else {
            newComments += thread.length;
            pageNew += thread.length;
          }
        }

        chunksWritten += chunks.length;
        pageChunks += chunks.length;
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            repo,
            threadRootId: thread[0]?.commentGithubId,
            prNumber: thread[0]?.prNumber,
            filePath: thread[0]?.filePath,
            threadSize: thread.length,
          },
          "Catch-up thread processing failed -- continuing with remaining threads",
        );
      }
    }

    logger.info(
      { page, repo, newComments: pageNew, updatedComments: pageUpdated, skipped: pageSkipped, chunksWritten: pageChunks },
      "Catch-up page processed",
    );

    // If fewer than 100, we've reached the last page
    if (comments.length < 100) {
      break;
    }

    page++;
  }

  // ── Update sync state ──────────────────────────────────────────────────
  if (!dryRun && latestUpdatedAt) {
    await store.updateSyncState({
      repo,
      lastSyncedAt: latestUpdatedAt,
      lastPageCursor: String(page),
      totalCommentsSynced: (syncState.totalCommentsSynced ?? 0) + newComments,
      backfillComplete: true,
    });
  }

  const durationMs = Date.now() - startTime;

  logger.info(
    { repo, newComments, updatedComments, chunksWritten, pagesProcessed, durationMs },
    "Catch-up sync complete",
  );

  return {
    newComments,
    updatedComments,
    chunksWritten,
    pagesProcessed,
    durationMs,
  };
}
