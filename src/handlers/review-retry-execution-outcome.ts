import type { ExecutionResult } from "../execution/types.ts";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import {
  classifyReviewTimeoutOutcome,
  type ReviewTimeoutClassificationResult,
} from "../review-orchestration/review-timeout-classification.ts";
import {
  recordReviewExecutionTelemetry,
  type ReviewDerivedPromptCacheStatus,
} from "./review-telemetry.ts";
import { recordReviewResilienceEventFailOpen } from "./review-resilience-telemetry.ts";

type ReviewRetryExecutionOutcomeLogger = {
  warn(payload: Record<string, unknown>, message: string): void;
};

export type ReviewRetryExecutionOutcome = {
  retryCheckpoint: CheckpointRecord | null;
  retryHasStructuredProgress: boolean;
  retryHasResults: boolean;
  retryTimeoutClassification: ReviewTimeoutClassificationResult;
};

export async function resolveReviewRetryExecutionOutcome(params: {
  telemetryEnabled: boolean;
  telemetryStore: Pick<TelemetryStore, "record" | "recordRateLimitEvent" | "recordPromptSections" | "recordResilienceEvent">;
  logger: ReviewRetryExecutionOutcomeLogger;
  retryDeliveryId: string;
  parentDeliveryId: string;
  repo: string;
  prNumber: number;
  prAuthor: string;
  retryReviewOutputKey: string;
  retryResult: ExecutionResult;
  retryPromptSections: PromptSectionRecord[];
  retryReviewPromptDerivedCacheStatus: ReviewDerivedPromptCacheStatus;
  retryReviewPromptDerivedCacheReason: string | undefined;
  retryFilesCount: number;
  retryScopeRatio: number;
  retryTimeoutSeconds: number;
  retryRiskLevel: string;
  retryCheckpointEnabled: boolean;
  partialCommentId: number | undefined;
  timeoutTotalFiles: number;
  getCheckpoint?: (reviewOutputKey: string) => Promise<CheckpointRecord | null>;
}): Promise<ReviewRetryExecutionOutcome> {
  const retryCheckpoint = (await params.getCheckpoint?.(params.retryReviewOutputKey)) ?? null;
  const retryHasStructuredProgress =
    (retryCheckpoint?.filesReviewed?.length ?? 0) > 0 ||
    (retryCheckpoint?.filesInspected?.length ?? 0) > 0;
  const retryHasResults =
    retryHasStructuredProgress ||
    (retryCheckpoint?.findingCount ?? 0) >= 1 ||
    (params.retryResult.published ?? false);
  const retryTimeoutClassification = classifyReviewTimeoutOutcome({
    deliveryId: params.retryDeliveryId,
    reviewOutputKey: params.retryReviewOutputKey,
    outcome: {
      isTimeout: params.retryResult.isTimeout,
      stopReason: params.retryResult.stopReason,
      failureSubtype: params.retryResult.failureSubtype,
    },
    checkpoint: retryCheckpoint
      ? {
          filesReviewed: retryCheckpoint.filesReviewed?.length,
          filesInspected: retryCheckpoint.filesInspected?.length,
          findingCount: retryCheckpoint.findingCount,
          totalFiles: params.timeoutTotalFiles,
        }
      : null,
    retry: {
      completed: params.retryResult.conclusion === "success" || retryHasResults,
      failed: params.retryResult.conclusion !== "success" && !retryHasResults,
      hasResults: retryHasResults,
      filesCount: params.retryFilesCount,
    },
  });

  if (params.telemetryEnabled) {
    await recordReviewExecutionTelemetry({
      telemetryStore: params.telemetryStore,
      logger: params.logger,
      deliveryId: params.retryDeliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      prAuthor: params.prAuthor,
      eventType: "pull_request.review-retry",
      result: params.retryResult,
      promptSections: params.retryResult.promptSections ?? params.retryPromptSections,
      derivedPromptCacheStatus: params.retryReviewPromptDerivedCacheStatus,
      derivedPromptCacheReason: params.retryReviewPromptDerivedCacheReason,
      warningPrefix: "Retry",
    });

    await recordReviewResilienceEventFailOpen({
      telemetryStore: params.telemetryStore,
      logger: params.logger,
      entry: {
        deliveryId: params.retryDeliveryId,
        parentDeliveryId: params.parentDeliveryId,
        repo: params.repo,
        prNumber: params.prNumber,
        prAuthor: params.prAuthor,
        eventType: "pull_request.review-retry",
        kind: "retry",
        reviewOutputKey: params.retryReviewOutputKey,
        executionConclusion: params.retryResult.isTimeout && params.retryResult.published
          ? "timeout_partial"
          : params.retryResult.isTimeout
            ? "timeout"
            : params.retryResult.conclusion,
        hadInlineOutput: params.retryResult.published ?? false,
        checkpointFilesReviewed: retryCheckpoint?.filesReviewed?.length,
        checkpointFindingCount: retryCheckpoint?.findingCount,
        checkpointTotalFiles: params.timeoutTotalFiles,
        partialCommentId: params.partialCommentId,
        retryHasResults,
        retryFilesCount: params.retryFilesCount,
        retryScopeRatio: params.retryScopeRatio,
        retryTimeoutSeconds: params.retryTimeoutSeconds,
        retryRiskLevel: params.retryRiskLevel,
        retryCheckpointEnabled: params.retryCheckpointEnabled,
        timeoutClassification: retryTimeoutClassification.classification,
        timeoutClassificationMode: retryTimeoutClassification.mode,
        timeoutClassificationReasons: retryTimeoutClassification.reasonCodes,
      },
    });
  }

  return {
    retryCheckpoint,
    retryHasStructuredProgress,
    retryHasResults,
    retryTimeoutClassification,
  };
}
