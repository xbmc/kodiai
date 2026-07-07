import type {
  ContinuationTimeoutEstimate,
  ReviewContinuationPlanDecision,
} from "../lib/review-continuation-lifecycle.ts";
import type { ContinuationCompactionObservation } from "../review-continuation/continuation-compaction.ts";

export type ReviewRetryEnqueueContext = {
  retryReviewOutputKey: string;
  retryTimeout: number;
  retryFiles: string[];
  retryTimeoutEstimate: ContinuationTimeoutEstimate;
  retryCheckpointEnabled: boolean;
  retryScopeRatio: number;
  retryDeliveryId: string;
  retryContinuationCompaction?: ContinuationCompactionObservation;
};

export function resolveReviewRetryEnqueueContext(params: {
  deliveryId: string;
  retryPlan: ReviewContinuationPlanDecision | null;
}): ReviewRetryEnqueueContext | null {
  if (params.retryPlan?.decision !== "schedule-continuation") {
    return null;
  }

  return {
    retryReviewOutputKey: params.retryPlan.continuationReviewOutputKey,
    retryTimeout: params.retryPlan.timeoutSeconds,
    retryFiles: params.retryPlan.continuationFiles,
    retryTimeoutEstimate: params.retryPlan.timeoutEstimate,
    retryCheckpointEnabled: params.retryPlan.checkpointEnabled,
    retryScopeRatio: params.retryPlan.scopeRatio,
    retryDeliveryId: `${params.deliveryId}-retry-1`,
    ...(params.retryPlan.continuationCompaction
      ? { retryContinuationCompaction: params.retryPlan.continuationCompaction }
      : {}),
  };
}
