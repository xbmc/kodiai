import type { Logger } from "pino";
import type { Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { classifyRetryFailure } from "../lib/review-details-formatting.ts";
import { discardCheckpointsFailOpen } from "./review-handler-utils.ts";

type FinalizeContinuationAttempt = (params: {
  attemptId: string;
  fallbackOutcome: "blocked";
  fallbackStopReason: "no-follow-up";
  reviewOutputKey: string;
}) => Promise<void>;

type RetryAttemptIdentity = {
  attemptId: string;
  reviewOutputKey: string;
  deliveryId: string;
};

export async function handleRetryJobFailure(params: {
  error: unknown;
  retryAttempt: RetryAttemptIdentity;
  prNumber: number;
  logger: Pick<Logger, "error">;
  finalizeContinuationAttempt: FinalizeContinuationAttempt;
}): Promise<void> {
  params.logger.error(
    {
      err: params.error,
      deliveryId: params.retryAttempt.deliveryId,
      prNumber: params.prNumber,
      ...classifyRetryFailure(params.error),
    },
    "Retry failed with error",
  );
  await params.finalizeContinuationAttempt({
    attemptId: params.retryAttempt.attemptId,
    fallbackOutcome: "blocked",
    fallbackStopReason: "no-follow-up",
    reviewOutputKey: params.retryAttempt.reviewOutputKey,
  });
}

export async function finalizeRetryJobAttempt(params: {
  retryWorkspace: Pick<Workspace, "cleanup"> | null | undefined;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "complete">;
  attemptId: string;
  knowledgeStore: KnowledgeStore | undefined;
  logger: Logger;
  reviewOutputKey: string;
  retryReviewOutputKey: string;
}): Promise<void> {
  if (params.retryWorkspace) {
    await params.retryWorkspace.cleanup();
  }

  try {
    params.reviewWorkCoordinator.complete(params.attemptId);
  } finally {
    discardCheckpointsFailOpen(params.knowledgeStore, params.logger, [
      params.retryReviewOutputKey,
      params.reviewOutputKey,
    ]);
  }
}

export async function handleRetryEnqueueFailure(params: {
  error: unknown;
  parentDeliveryId: string;
  prNumber: number;
  retryAttempt: Pick<RetryAttemptIdentity, "attemptId" | "reviewOutputKey">;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "release">;
  logger: Pick<Logger, "error">;
  finalizeContinuationAttempt: FinalizeContinuationAttempt;
}): Promise<void> {
  await params.finalizeContinuationAttempt({
    attemptId: params.retryAttempt.attemptId,
    fallbackOutcome: "blocked",
    fallbackStopReason: "no-follow-up",
    reviewOutputKey: params.retryAttempt.reviewOutputKey,
  });
  params.reviewWorkCoordinator.release(params.retryAttempt.attemptId);
  params.logger.error(
    {
      err: params.error,
      deliveryId: params.parentDeliveryId,
      prNumber: params.prNumber,
      ...classifyRetryFailure(params.error),
    },
    "Failed to enqueue retry job",
  );
}
