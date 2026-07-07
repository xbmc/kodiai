import type { Logger } from "pino";
import type { TelemetryStore } from "../telemetry/types.ts";
import {
  buildReviewTimeoutResilienceTelemetryEntry,
  recordReviewResilienceEventFailOpen,
  type ReviewTimeoutClassificationTelemetryFields,
} from "./review-resilience-telemetry.ts";

type TimeoutRetryTelemetry =
  | { enqueued: false }
  | {
      enqueued: true;
      filesCount: number;
      scopeRatio: number;
      timeoutSeconds: number;
      riskLevel: string;
      checkpointEnabled: boolean;
    };

export async function recordReviewTimeoutResilienceTelemetry(params: {
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
  checkpointFilesReviewed: number;
  checkpointFilesInspected: number;
  checkpointFindingCount: number;
  checkpointTotalFiles: number;
  partialCommentId: number | undefined;
  recentTimeouts: number;
  chronicTimeout: boolean;
  retry: TimeoutRetryTelemetry;
  timeoutClassificationTelemetry: ReviewTimeoutClassificationTelemetryFields;
}): Promise<{ projectionDegraded: boolean }> {
  if (!params.telemetryEnabled) {
    return { projectionDegraded: false };
  }

  const result = await recordReviewResilienceEventFailOpen({
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    entry: buildReviewTimeoutResilienceTelemetryEntry({
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      prAuthor: params.prAuthor,
      eventType: params.eventType,
      reviewOutputKey: params.reviewOutputKey,
      executionConclusion: params.executionConclusion,
      hadInlineOutput: params.hadInlineOutput,
      checkpointFilesReviewed: params.checkpointFilesReviewed,
      checkpointFilesInspected: params.checkpointFilesInspected,
      checkpointFindingCount: params.checkpointFindingCount,
      checkpointTotalFiles: params.checkpointTotalFiles,
      partialCommentId: params.partialCommentId,
      recentTimeouts: params.recentTimeouts,
      chronicTimeout: params.chronicTimeout,
      retry: params.retry,
      timeoutClassificationTelemetry: params.timeoutClassificationTelemetry,
    }),
  });

  return { projectionDegraded: !result.ok };
}
