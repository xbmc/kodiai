import type { ResilienceEventRecord, TelemetryStore } from "../telemetry/types.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";

type ResilienceTelemetryStore = Pick<TelemetryStore, "recordResilienceEvent">;
type ResilienceTelemetryLogger = {
  warn(payload: Record<string, unknown>, message: string): void;
};

export type ReviewResilienceTelemetryStatus = "recorded" | "skipped";
export type ReviewResilienceTelemetryResult = Result<ReviewResilienceTelemetryStatus>;

export type ReviewTimeoutClassificationTelemetryFields = Pick<
  ResilienceEventRecord,
  "timeoutClassification" | "timeoutClassificationMode" | "timeoutClassificationReasons"
>;

export function buildReviewTimeoutResilienceTelemetryEntry(params: {
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
  retry:
    | { enqueued: false }
    | {
        enqueued: true;
        filesCount: number;
        scopeRatio: number;
        timeoutSeconds: number;
        riskLevel: string;
        checkpointEnabled: boolean;
      };
  timeoutClassificationTelemetry: ReviewTimeoutClassificationTelemetryFields;
}): ResilienceEventRecord {
  return {
    deliveryId: params.deliveryId,
    repo: params.repo,
    prNumber: params.prNumber,
    prAuthor: params.prAuthor,
    eventType: params.eventType,
    kind: "timeout",
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
    retryEnqueued: params.retry.enqueued,
    ...(params.retry.enqueued
      ? {
          retryFilesCount: params.retry.filesCount,
          retryScopeRatio: params.retry.scopeRatio,
          retryTimeoutSeconds: params.retry.timeoutSeconds,
          retryRiskLevel: params.retry.riskLevel,
          retryCheckpointEnabled: params.retry.checkpointEnabled,
        }
      : {}),
    ...params.timeoutClassificationTelemetry,
  };
}

export async function recordReviewResilienceEventFailOpen(params: {
  telemetryStore: ResilienceTelemetryStore;
  logger: ResilienceTelemetryLogger;
  entry: ResilienceEventRecord;
}): Promise<ReviewResilienceTelemetryResult> {
  const recordResilienceEvent = params.telemetryStore.recordResilienceEvent;
  if (!recordResilienceEvent) {
    return resultOk("skipped");
  }

  try {
    await recordResilienceEvent(params.entry);
    return resultOk("recorded");
  } catch (err) {
    const error = toError(err);
    params.logger.warn({ err: error }, "Resilience telemetry write failed (non-blocking)");
    return resultErr(error);
  }
}
