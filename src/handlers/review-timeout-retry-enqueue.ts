import type { Logger } from "pino";
import type { JobQueue } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { runReviewTimeoutRetryJob } from "./review-timeout-retry-job.ts";
import { buildReviewRetryJobQueueContext } from "./review-job-context.ts";
import {
  finalizeRetryJobAttempt,
  handleRetryEnqueueFailure,
  handleRetryJobFailure,
} from "./review-retry-failure-handling.ts";
import { runReviewTimeoutRetryJob as defaultRunReviewTimeoutRetryJob } from "./review-timeout-retry-job.ts";

type FinalizeContinuationAttempt = Parameters<typeof handleRetryJobFailure>[0]["finalizeContinuationAttempt"];
type RetryJobParams = Parameters<typeof runReviewTimeoutRetryJob>[0];

export function enqueueReviewTimeoutRetryJob(params: {
  jobQueue: Pick<JobQueue, "enqueue">;
  installationId: number;
  parentDeliveryId: string;
  eventName: string;
  reviewFamilyKey: string;
  prNumber: number;
  reviewOutputKey: string;
  retryJobParams: RetryJobParams;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "complete" | "release">;
  knowledgeStore: KnowledgeStore | undefined;
  logger: Logger;
  finalizeContinuationAttempt: FinalizeContinuationAttempt;
  runRetryJob?: typeof runReviewTimeoutRetryJob;
}): void {
  const runRetryJob = params.runRetryJob ?? defaultRunReviewTimeoutRetryJob;
  const {
    retryReviewOutputKey,
    retryDeliveryId,
  } = params.retryJobParams.retryEnqueueContext;
  const retryAttemptId = params.retryJobParams.retryAttemptId;

  void params.jobQueue.enqueue(params.installationId, async () => {
    let retryWorkspace: Awaited<ReturnType<typeof runRetryJob>> | undefined;
    try {
      params.retryJobParams.setReviewWorkPhaseForAttempt(retryAttemptId, "workspace-create");
      retryWorkspace = await runRetryJob(params.retryJobParams);
    } catch (retryErr) {
      await handleRetryJobFailure({
        error: retryErr,
        retryAttempt: {
          attemptId: retryAttemptId,
          reviewOutputKey: retryReviewOutputKey,
          deliveryId: retryDeliveryId,
        },
        prNumber: params.prNumber,
        logger: params.logger,
        finalizeContinuationAttempt: params.finalizeContinuationAttempt,
      });
    } finally {
      await finalizeRetryJobAttempt({
        retryWorkspace,
        reviewWorkCoordinator: params.reviewWorkCoordinator,
        attemptId: retryAttemptId,
        knowledgeStore: params.knowledgeStore,
        logger: params.logger,
        reviewOutputKey: params.reviewOutputKey,
        retryReviewOutputKey,
      });
    }
  }, buildReviewRetryJobQueueContext({
    retryDeliveryId,
    eventName: params.eventName,
    reviewFamilyKey: params.reviewFamilyKey,
    prNumber: params.prNumber,
  })).catch(async (err) => {
    await handleRetryEnqueueFailure({
      error: err,
      parentDeliveryId: params.parentDeliveryId,
      prNumber: params.prNumber,
      retryAttempt: {
        attemptId: retryAttemptId,
        reviewOutputKey: retryReviewOutputKey,
      },
      reviewWorkCoordinator: params.reviewWorkCoordinator,
      logger: params.logger,
      finalizeContinuationAttempt: params.finalizeContinuationAttempt,
    });
  });
}
