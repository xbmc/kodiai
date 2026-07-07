import type { Logger } from "pino";
import {
  classifyReviewTimeoutOutcome,
  type ReviewTimeoutClassificationInput,
} from "../review-orchestration/review-timeout-classification.ts";
import {
  logReviewTimeoutClassification,
  type ReviewTimeoutClassificationTelemetry,
} from "../review-orchestration/review-timeout-classification-log.ts";
import type { ReviewTimeoutRetryContext } from "./review-timeout-retry-context.ts";

export function resolveReviewTimeoutClassificationContext(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  deliveryId: string;
  reviewOutputKey: string;
  prNumber: number;
  outcome: NonNullable<ReviewTimeoutClassificationInput["outcome"]>;
  timeoutFirstPass: ReviewTimeoutClassificationInput["firstPass"];
  checkpoint: ReviewTimeoutClassificationInput["checkpoint"];
  retryPlan: ReviewTimeoutRetryContext["retryPlan"];
  chronicTimeout: boolean;
  recentTimeouts: number;
  durationMs: number | undefined;
  timeoutDurationSeconds: number;
}): ReviewTimeoutClassificationTelemetry {
  const retry = params.retryPlan?.decision === "schedule-continuation"
    ? {
        enqueued: true,
        filesCount: params.retryPlan.continuationFiles.length,
        scopeRatio: params.retryPlan.scopeRatio,
        timeoutSeconds: params.retryPlan.timeoutSeconds,
        checkpointEnabled: params.retryPlan.checkpointEnabled,
        riskLevel: params.retryPlan.timeoutEstimate.riskLevel,
      }
    : {
        enqueued: false,
        filesCount: 0,
      };

  const classification = classifyReviewTimeoutOutcome({
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    outcome: params.outcome,
    firstPass: params.timeoutFirstPass,
    checkpoint: params.checkpoint,
    retry,
    continuation: params.retryPlan
      ? { decision: params.retryPlan.decision, reason: params.retryPlan.reason }
      : null,
    chronicTimeout: params.chronicTimeout,
    recentTimeouts: params.recentTimeouts,
    longRun: {
      thresholdExceeded: false,
      durationSeconds: typeof params.durationMs === "number" ? Math.floor(params.durationMs / 1000) : undefined,
      thresholdSeconds: params.timeoutDurationSeconds,
    },
  });

  return logReviewTimeoutClassification({
    logger: params.logger,
    baseLog: params.baseLog,
    classification,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    prNumber: params.prNumber,
    chronicBudgetExhaustion: params.chronicTimeout,
    retryEnqueued: params.retryPlan?.decision === "schedule-continuation",
  });
}
