import type { Logger } from "pino";
import type { ReviewCommentStore } from "./review-comment-types.ts";
import type { EmbeddingProvider } from "./types.ts";

const EMBEDDING_MODEL = "voyage-code-3";

export type EmbeddingSweepOptions = {
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  batchSize?: number;
  batchDelayMs?: number;
  maxBatches?: number;
  logger: Logger;
  dryRun?: boolean;
};

export type EmbeddingSweepResult = {
  totalNull: number;
  processed: number;
  succeeded: number;
  failed: number;
  durationMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sweep for chunks with null embeddings and backfill them.
 *
 * Processes in batches with configurable delay between batches to avoid
 * overwhelming the embedding provider. Failed embeddings are logged and
 * skipped -- never fatal.
 */
export async function sweepNullEmbeddings(
  opts: EmbeddingSweepOptions,
): Promise<EmbeddingSweepResult> {
  const {
    store,
    embeddingProvider,
    repo,
    batchSize = 50,
    batchDelayMs = 500,
    maxBatches,
    logger,
    dryRun = false,
  } = opts;

  const startTime = Date.now();
  const totalNull = await store.countNullEmbeddings(repo);

  logger.info({ repo, totalNull }, "Embedding sweep started");

  if (totalNull === 0) {
    logger.info({ repo }, "No null embeddings found -- nothing to sweep");
    return { totalNull: 0, processed: 0, succeeded: 0, failed: 0, durationMs: Date.now() - startTime };
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let batchNumber = 0;

  while (true) {
    if (maxBatches !== undefined && batchNumber >= maxBatches) break;

    const batch = await store.getNullEmbeddingChunks(repo, batchSize);
    if (batch.length === 0) break;

    batchNumber++;

    for (const chunk of batch) {
      processed++;

      try {
        const result = await embeddingProvider.generate(chunk.chunkText, "document");

        if (result === null) {
          logger.warn(
            { repo, chunkId: chunk.id, commentGithubId: chunk.commentGithubId },
            "Embedding returned null -- skipping",
          );
          failed++;
          continue;
        }

        if (!dryRun) {
          await store.updateEmbedding(chunk.id, result.embedding, EMBEDDING_MODEL);
        }
        succeeded++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { repo, chunkId: chunk.id, commentGithubId: chunk.commentGithubId, err: message },
          "Embedding generation failed -- skipping",
        );
        failed++;
      }
    }

    logger.info({ repo, batchNumber, processed, succeeded, failed }, "Embedding sweep batch complete");

    // Sleep between batches (delay allows rate limiting)
    await sleep(batchDelayMs);
  }

  const durationMs = Date.now() - startTime;
  logger.info({ repo, totalNull, processed, succeeded, failed, durationMs }, "Embedding sweep completed");

  return { totalNull, processed, succeeded, failed, durationMs };
}
