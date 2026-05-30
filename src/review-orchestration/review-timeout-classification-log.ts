import type { Logger } from "pino";
import type { ReviewTimeoutClassificationResult } from "./review-timeout-classification.ts";
import {
  toProductionLogReviewTimeoutCounts,
  toProductionLogReviewTimeoutMode,
  toProductionLogReviewTimeoutReasonCode,
} from "../review-audit/production-log-projection.ts";

export type ReviewTimeoutClassificationTelemetry = {
  timeoutClassification: ReviewTimeoutClassificationResult["classification"];
  timeoutClassificationMode: ReviewTimeoutClassificationResult["mode"];
  timeoutClassificationReasons: ReviewTimeoutClassificationResult["reasonCodes"];
};

export function buildReviewTimeoutClassificationTelemetry(
  classification: ReviewTimeoutClassificationResult,
): ReviewTimeoutClassificationTelemetry {
  return {
    timeoutClassification: classification.classification,
    timeoutClassificationMode: classification.mode,
    timeoutClassificationReasons: classification.reasonCodes,
  };
}

export function logReviewTimeoutClassification(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  classification: ReviewTimeoutClassificationResult;
  deliveryId: string;
  reviewOutputKey: string;
  prNumber: number;
  chronicBudgetExhaustion: boolean;
  retryEnqueued: boolean;
}): ReviewTimeoutClassificationTelemetry {
  const projectedCounts = toProductionLogReviewTimeoutCounts(params.classification.counts);

  params.logger.info(
    {
      ...params.baseLog,
      gate: params.classification.gate,
      gateResult: params.classification.classification,
      mode: toProductionLogReviewTimeoutMode(params.classification.mode),
      reasonCodes: params.classification.reasonCodes.map(toProductionLogReviewTimeoutReasonCode),
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      prNumber: params.prNumber,
      checkpointFilesReviewed: projectedCounts.checkpointFilesReviewed ?? null,
      checkpointFilesInspected: projectedCounts.checkpointFilesInspected ?? null,
      checkpointFindingCount: projectedCounts.checkpointFindingCount ?? null,
      checkpointTotalFiles: projectedCounts.checkpointTotalFiles ?? null,
      retryFilesCount: projectedCounts.retryFilesCount ?? null,
      recentBudgetExhaustions: projectedCounts.recentBudgetExhaustions ?? null,
      longRunDurationSeconds: projectedCounts.longRunDurationSeconds ?? null,
      longRunThresholdSeconds: projectedCounts.longRunThresholdSeconds ?? null,
      chronicBudgetExhaustion: params.chronicBudgetExhaustion,
      retryEnqueued: params.retryEnqueued,
      redaction: params.classification.redaction,
    },
    "Review budget classification",
  );

  return buildReviewTimeoutClassificationTelemetry(params.classification);
}
