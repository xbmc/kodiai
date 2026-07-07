import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { enqueueReviewTimeoutRetryJob } from "./review-timeout-retry-enqueue.ts";
import type { ReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";
import { enqueueReviewTimeoutRetryJob as defaultEnqueueReviewTimeoutRetryJob } from "./review-timeout-retry-enqueue.ts";
import { recordReviewTimeoutRetryPreEnqueueSideEffects } from "./review-timeout-retry-pre-enqueue.ts";

type RetryJobParams = Parameters<typeof enqueueReviewTimeoutRetryJob>[0]["retryJobParams"];
type EnqueueRetryParams = Omit<
  Parameters<typeof enqueueReviewTimeoutRetryJob>[0],
  "retryJobParams" | "reviewWorkCoordinator"
>;
type PreEnqueueParams = Omit<
  Parameters<typeof recordReviewTimeoutRetryPreEnqueueSideEffects>[0],
  "retryEnqueueContext" | "retryAttemptId"
>;

export async function scheduleReviewTimeoutRetryContinuation(params: {
  retryEnqueueContext: ReviewRetryEnqueueContext;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "claim" | "complete" | "release">;
  reviewFamilyKey: string;
  preEnqueue: PreEnqueueParams;
  enqueue: EnqueueRetryParams;
  buildRetryJobParams: (retryAttemptId: string) => RetryJobParams;
  enqueueRetryJob?: typeof enqueueReviewTimeoutRetryJob;
}): Promise<{ continuationProjectionDegraded: boolean }> {
  const retryReviewWorkAttempt = params.reviewWorkCoordinator.claim({
    familyKey: params.reviewFamilyKey,
    source: "automatic-review",
    lane: "review",
    deliveryId: params.retryEnqueueContext.retryDeliveryId,
    phase: "claimed",
  });

  const retryPreEnqueueSideEffects = await recordReviewTimeoutRetryPreEnqueueSideEffects({
    ...params.preEnqueue,
    retryEnqueueContext: params.retryEnqueueContext,
    retryAttemptId: retryReviewWorkAttempt.attemptId,
  });

  const enqueueRetryJob = params.enqueueRetryJob ?? defaultEnqueueReviewTimeoutRetryJob;
  enqueueRetryJob({
    ...params.enqueue,
    retryJobParams: params.buildRetryJobParams(retryReviewWorkAttempt.attemptId),
    reviewWorkCoordinator: params.reviewWorkCoordinator,
  });

  return {
    continuationProjectionDegraded: retryPreEnqueueSideEffects.continuationProjectionDegraded,
  };
}
