import type { CheckpointRecord, KnowledgeStore } from "../knowledge/types.ts";

type PartialReviewCheckpoint = CheckpointRecord & {
  partialCommentId: number;
};

type PartialReviewCheckpointLogger = {
  warn(fields: Record<string, unknown>, message: string): void;
};

export async function persistPartialReviewCheckpoint(params: {
  knowledgeStore: Pick<KnowledgeStore, "saveCheckpoint" | "updateCheckpointCommentId"> | undefined;
  logger: PartialReviewCheckpointLogger;
  checkpoint: PartialReviewCheckpoint;
}): Promise<void> {
  const { knowledgeStore, checkpoint, logger } = params;

  if (knowledgeStore?.saveCheckpoint) {
    await knowledgeStore.saveCheckpoint(checkpoint);
    return;
  }

  if (!knowledgeStore?.updateCheckpointCommentId) {
    return;
  }

  try {
    await knowledgeStore.updateCheckpointCommentId(
      checkpoint.reviewOutputKey,
      checkpoint.partialCommentId,
    );
  } catch (err) {
    logger.warn(
      { err, reviewOutputKey: checkpoint.reviewOutputKey },
      "Checkpoint comment id update failed (non-blocking)",
    );
  }
}
