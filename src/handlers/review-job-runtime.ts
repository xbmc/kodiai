import type { Logger } from "pino";
import type { JobQueueRunMetadata } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type {
  ExecutionResult,
  ExecutorPhaseTiming,
  ReviewPhaseName,
  ReviewPhaseTiming,
} from "../execution/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import {
  buildExecutorUnavailablePhases,
  buildQueueWaitPhase,
  isValidQueueWaitMetadata,
} from "../review-orchestration/review-phase-timing.ts";
import {
  createReviewContinuationFamilyStateManager,
} from "../review-orchestration/review-continuation-family-state.ts";
import { createReviewExecutionCompletedLogger } from "./review-publication-state.ts";
import type { ReviewWorkRuntime } from "./review-work-runtime.ts";

export type ReviewJobTimingState = {
  reviewStartedAt: number;
  totalPhaseStartAt: number;
  workspacePhaseStartedAt?: number;
  retrievalPhaseStartedAt?: number;
  publicationPhaseStartedAt?: number;
  executorPhaseTimings: ExecutorPhaseTiming[];
};

export type ReviewJobPublicationState = {
  executorResult?: ExecutionResult;
  reviewOutputPublished: boolean;
  reviewExecutorPublished: boolean;
  reviewPublishResolution: string;
  reviewPublishFallbackDelivery?: string;
};

export function createReviewJobRuntime(params: {
  queueMetadata: JobQueueRunMetadata;
  logger: Logger;
  baseLog: Record<string, unknown>;
  prNumber: number;
  deliveryId: string;
  reviewFamilyKey: string;
  reviewOutputKey: string;
  knowledgeStore?: Pick<KnowledgeStore, "upsertContinuationFamilyState">;
  reviewWorkCoordinator: ReviewWorkCoordinator;
  reviewWorkRuntime: ReviewWorkRuntime;
}) {
  const reviewPhaseTimings = new Map<ReviewPhaseName, ReviewPhaseTiming>();
  reviewPhaseTimings.set("queue wait", buildQueueWaitPhase(params.queueMetadata));
  const reviewStartedAt = Date.now();
  const timingState: ReviewJobTimingState = {
    reviewStartedAt,
    totalPhaseStartAt: isValidQueueWaitMetadata(params.queueMetadata)
      ? params.queueMetadata.queuedAtMs
      : reviewStartedAt,
    executorPhaseTimings: buildExecutorUnavailablePhases("executor phase timings unavailable"),
  };
  const publicationState: ReviewJobPublicationState = {
    reviewOutputPublished: false,
    reviewExecutorPublished: false,
    reviewPublishResolution: "none",
  };

  const logReviewExecutionCompleted = createReviewExecutionCompletedLogger({
    logger: params.logger,
    getState: () => ({
      prNumber: params.prNumber,
      executorResult: publicationState.executorResult,
      reviewOutputPublished: publicationState.reviewOutputPublished,
      reviewExecutorPublished: publicationState.reviewExecutorPublished,
      reviewPublishResolution: publicationState.reviewPublishResolution,
      reviewPublishFallbackDelivery: publicationState.reviewPublishFallbackDelivery,
    }),
  });

  const continuationFamilyState = createReviewContinuationFamilyStateManager({
    logger: params.logger,
    baseLog: params.baseLog,
    reviewFamilyKey: params.reviewFamilyKey,
    reviewOutputKey: params.reviewOutputKey,
    knowledgeStore: params.knowledgeStore,
    reviewWorkCoordinator: params.reviewWorkCoordinator,
  });

  const canPublishVisibleOutput = params.reviewWorkRuntime.createVisibleOutputGate({
    deliveryId: params.deliveryId,
    canPublishReviewWorkOutput: continuationFamilyState.canPublishReviewWorkOutput,
  });

  return {
    reviewPhaseTimings,
    timingState,
    publicationState,
    logReviewExecutionCompleted,
    continuationFamilyState,
    canPublishVisibleOutput,
  };
}
