import type { Logger } from "pino";
import type { JobQueue } from "../jobs/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type {
  ReviewCommentChunk,
  ReviewCommentInput,
  ReviewCommentStore,
} from "../knowledge/review-comment-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import { chunkReviewThread } from "../knowledge/review-comment-chunker.ts";

const BOT_LOGINS = new Set([
  "dependabot",
  "renovate",
  "kodiai",
  "github-actions",
  "codecov",
]);

/**
 * Check whether a comment author is a bot.
 * Matches explicit bot logins, accounts with user.type === "Bot",
 * or logins ending with [bot].
 */
function isBotComment(comment: { user?: { login?: string; type?: string } | null }): boolean {
  const userType = (comment.user?.type ?? "").toLowerCase();
  if (userType === "bot") return true;

  const login = (comment.user?.login ?? "").toLowerCase();
  if (login.length === 0) return false;
  if (BOT_LOGINS.has(login)) return true;
  if (login.endsWith("[bot]")) return true;

  return false;
}

/**
 * Build a ReviewCommentInput from a webhook comment payload.
 */
function commentPayloadToInput(
  repo: string,
  owner: string,
  prNumber: number,
  prTitle: string | undefined,
  comment: Record<string, unknown>,
): ReviewCommentInput {
  return {
    repo,
    owner,
    prNumber,
    prTitle,
    commentGithubId: comment.id as number,
    inReplyToId: (comment.in_reply_to_id as number | undefined) ?? null,
    filePath: (comment.path as string | undefined) ?? null,
    startLine: (comment.start_line as number | undefined) ?? null,
    endLine: (comment.line as number | undefined) ?? null,
    diffHunk: (comment.diff_hunk as string | undefined) ?? null,
    authorLogin: (comment.user as Record<string, unknown>)?.login as string ?? "unknown",
    authorAssociation: (comment.author_association as string | undefined) ?? null,
    body: (comment.body as string) ?? "",
    githubCreatedAt: new Date(comment.created_at as string),
    githubUpdatedAt: comment.updated_at ? new Date(comment.updated_at as string) : null,
    originalPosition: (comment.original_position as number | undefined) ?? null,
    reviewId: (comment.pull_request_review_id as number | undefined) ?? null,
  };
}

/**
 * Embed chunks using the embedding provider (fail-open: null embeddings are skipped).
 * Returns chunks with embedding data attached for storage.
 */
async function embedChunks(
  chunks: ReviewCommentChunk[],
  embeddingProvider: EmbeddingProvider,
): Promise<ReviewCommentChunk[]> {
  for (const chunk of chunks) {
    try {
      const result = await embeddingProvider.generate(chunk.chunkText, "document");
      chunk.embedding = result ?? null;
    } catch {
      chunk.embedding = null;
    }
  }
  return chunks;
}

/**
 * Create and register webhook handlers for pull_request_review_comment events.
 *
 * Handles three actions:
 * - created: Ingest new comment (chunk + embed + store)
 * - edited: Re-embed edited comment (re-chunk + embed + update store)
 * - deleted: Soft-delete comment from store
 *
 * CRITICAL: This is a pure ingestion handler — it observes and records, never acts.
 * No unsolicited PR responses are triggered.
 */
export function createReviewCommentSyncHandler(opts: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, store, embeddingProvider, logger } = opts;

  /**
   * Handle pull_request_review_comment.created
   * Ingest new comment: chunk, embed, store — all in background job.
   */
  async function handleCreated(event: WebhookEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const comment = payload.comment as Record<string, unknown> | undefined;
    if (!comment) return;

    if (isBotComment(comment as { user?: { login?: string; type?: string } | null })) {
      logger.debug(
        { deliveryId: event.id, commentId: comment.id, login: (comment.user as Record<string, unknown>)?.login },
        "Review comment sync: skipping bot comment",
      );
      return;
    }

    const repository = payload.repository as Record<string, unknown> | undefined;
    const fullName = repository?.full_name as string | undefined;
    if (!fullName) return;

    const [owner, repoName] = fullName.split("/");
    if (!owner || !repoName) return;

    const pullRequest = payload.pull_request as Record<string, unknown> | undefined;
    const prNumber = pullRequest?.number as number | undefined;
    const prTitle = pullRequest?.title as string | undefined;
    if (prNumber == null) return;

    const input = commentPayloadToInput(fullName, owner, prNumber, prTitle, comment);

    await jobQueue.enqueue(event.installationId, async () => {
      try {
        const chunks = chunkReviewThread([input]);
        if (chunks.length === 0) return;

        await embedChunks(chunks, embeddingProvider);
        await store.writeChunks(chunks);

        logger.info(
          { repo: fullName, prNumber, commentId: comment.id, chunksWritten: chunks.length },
          "Review comment ingested",
        );
      } catch (err) {
        logger.warn(
          { err, repo: fullName, commentId: comment.id },
          "Review comment ingestion failed (fail-open)",
        );
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action: "created",
      jobType: "review-comment-sync",
      prNumber,
    });
  }

  /**
   * Handle pull_request_review_comment.edited
   * Re-chunk and re-embed the updated comment body.
   */
  async function handleEdited(event: WebhookEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const comment = payload.comment as Record<string, unknown> | undefined;
    if (!comment) return;

    if (isBotComment(comment as { user?: { login?: string; type?: string } | null })) {
      return;
    }

    const repository = payload.repository as Record<string, unknown> | undefined;
    const fullName = repository?.full_name as string | undefined;
    if (!fullName) return;

    const [owner, repoName] = fullName.split("/");
    if (!owner || !repoName) return;

    const pullRequest = payload.pull_request as Record<string, unknown> | undefined;
    const prNumber = pullRequest?.number as number | undefined;
    const prTitle = pullRequest?.title as string | undefined;
    if (prNumber == null) return;

    const input = commentPayloadToInput(fullName, owner, prNumber, prTitle, comment);

    await jobQueue.enqueue(event.installationId, async () => {
      try {
        const chunks = chunkReviewThread([input]);
        if (chunks.length === 0) return;

        await embedChunks(chunks, embeddingProvider);
        await store.updateChunks(chunks);

        logger.info(
          { repo: fullName, commentId: comment.id, chunksUpdated: chunks.length },
          "Review comment re-embedded",
        );
      } catch (err) {
        logger.warn(
          { err, repo: fullName, commentId: comment.id },
          "Review comment re-embed failed (fail-open)",
        );
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action: "edited",
      jobType: "review-comment-sync",
      prNumber,
    });
  }

  /**
   * Handle pull_request_review_comment.deleted
   * Soft-delete the comment directly (lightweight, no embedding needed).
   */
  async function handleDeleted(event: WebhookEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const comment = payload.comment as Record<string, unknown> | undefined;
    if (!comment) return;

    const repository = payload.repository as Record<string, unknown> | undefined;
    const fullName = repository?.full_name as string | undefined;
    if (!fullName) return;

    const commentId = comment.id as number;

    try {
      await store.softDelete(fullName, commentId);
      logger.info(
        { repo: fullName, commentId },
        "Review comment soft-deleted",
      );
    } catch (err) {
      logger.warn(
        { err, repo: fullName, commentId },
        "Review comment soft-delete failed (fail-open)",
      );
    }
  }

  eventRouter.register("pull_request_review_comment.created", handleCreated);
  eventRouter.register("pull_request_review_comment.edited", handleEdited);
  eventRouter.register("pull_request_review_comment.deleted", handleDeleted);
}
