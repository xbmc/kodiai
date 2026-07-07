import type { Logger } from "pino";
import type { CheckpointRecord, KnowledgeStore } from "../knowledge/types.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { ReviewContinuationFamilyStateManager } from "../review-orchestration/review-continuation-family-state.ts";
import type { ReviewTimeoutClassificationTelemetryFields } from "./review-resilience-telemetry.ts";
import type { ReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";
import { resolvePendingContinuationFamilyState } from "./review-continuation-family-state-projection.ts";
import { recordReviewTimeoutResilienceTelemetry } from "./review-timeout-resilience-telemetry.ts";
import { logReviewTimeoutRetryEnqueue } from "./review-timeout-retry-enqueue-log.ts";

export async function recordReviewTimeoutRetryPreEnqueueSideEffects(params: {
  telemetryEnabled: boolean;
  telemetryStore: Pick<TelemetryStore, "recordResilienceEvent">;
  logger: Logger;
  deliveryId: string;
  repo: string;
  prNumber: number;
  prAuthor: string;
  eventType: string;
  reviewOutputKey: string;
  executionConclusion: string;
  hadInlineOutput: boolean;
  checkpointFilesReviewed: string[];
  checkpointFilesInspected: string[];
  checkpointFindingCount: number;
  checkpointSummaryDraft: string;
  checkpointTotalFiles: number;
  partialCommentId: number | undefined;
  recentTimeouts: number;
  chronicTimeout: boolean;
  retryEnqueueContext: ReviewRetryEnqueueContext;
  timeoutClassificationTelemetry: ReviewTimeoutClassificationTelemetryFields;
  timeoutFirstPass: ReviewFirstPassPayload | null;
  knowledgeStore: Pick<KnowledgeStore, "saveCheckpoint"> | undefined;
  retryAttemptId: string;
  persistContinuationFamilyState: ReviewContinuationFamilyStateManager["persistContinuationFamilyState"];
}): Promise<{ continuationProjectionDegraded: boolean }> {
  const {
    retryReviewOutputKey,
    retryTimeout,
    retryFiles,
    retryTimeoutEstimate,
    retryCheckpointEnabled,
    retryScopeRatio,
  } = params.retryEnqueueContext;

  const retryResilienceTelemetry = await recordReviewTimeoutResilienceTelemetry({
    telemetryEnabled: params.telemetryEnabled,
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    deliveryId: params.deliveryId,
    repo: params.repo,
    prNumber: params.prNumber,
    prAuthor: params.prAuthor,
    eventType: params.eventType,
    reviewOutputKey: params.reviewOutputKey,
    executionConclusion: params.executionConclusion,
    hadInlineOutput: params.hadInlineOutput,
    checkpointFilesReviewed: params.checkpointFilesReviewed.length,
    checkpointFilesInspected: params.checkpointFilesInspected.length,
    checkpointFindingCount: params.checkpointFindingCount,
    checkpointTotalFiles: params.checkpointTotalFiles,
    partialCommentId: params.partialCommentId,
    recentTimeouts: params.recentTimeouts,
    chronicTimeout: params.chronicTimeout,
    retry: {
      enqueued: true,
      filesCount: retryFiles.length,
      scopeRatio: retryScopeRatio,
      timeoutSeconds: retryTimeout,
      riskLevel: retryTimeoutEstimate.riskLevel,
      checkpointEnabled: retryCheckpointEnabled,
    },
    timeoutClassificationTelemetry: params.timeoutClassificationTelemetry,
  });

  logReviewTimeoutRetryEnqueue({
    logger: params.logger,
    deliveryId: params.deliveryId,
    prNumber: params.prNumber,
    retryFiles: retryFiles.length,
    scopeRatio: retryScopeRatio,
    retryTimeout,
    retryRiskLevel: retryTimeoutEstimate.riskLevel,
  });

  if (params.timeoutFirstPass?.zeroEvidenceFailure && params.knowledgeStore?.saveCheckpoint) {
    const checkpoint: CheckpointRecord = {
      reviewOutputKey: params.reviewOutputKey,
      repo: params.repo,
      prNumber: params.prNumber,
      filesReviewed: params.checkpointFilesReviewed,
      filesInspected: params.checkpointFilesInspected,
      findingCount: params.checkpointFindingCount,
      summaryDraft: params.checkpointSummaryDraft,
      totalFiles: params.checkpointTotalFiles,
      partialCommentId: params.partialCommentId,
    };
    await params.knowledgeStore.saveCheckpoint(checkpoint);
  }

  await params.persistContinuationFamilyState(resolvePendingContinuationFamilyState({
    attemptId: params.retryAttemptId,
    reviewOutputKey: retryReviewOutputKey,
  }));

  return {
    continuationProjectionDegraded: retryResilienceTelemetry.projectionDegraded,
  };
}
