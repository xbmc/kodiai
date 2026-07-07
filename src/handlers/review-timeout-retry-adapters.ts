import type { CheckpointRecord } from "../knowledge/types.ts";

type ReviewRetryCheckpointStore = {
  getCheckpoint?: (reviewOutputKey: string) => Promise<CheckpointRecord | null>;
};

export function buildReviewRetryOutcomeCheckpointLookup(params: {
  knowledgeStore: ReviewRetryCheckpointStore | undefined;
}): (reviewOutputKey: string) => Promise<CheckpointRecord | null> {
  return async (reviewOutputKey) =>
    (await params.knowledgeStore?.getCheckpoint?.(reviewOutputKey)) ?? null;
}
