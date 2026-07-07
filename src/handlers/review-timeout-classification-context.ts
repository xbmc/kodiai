import type { Logger } from "pino";
import {
  classifyReviewTimeoutOutcome,
  type ReviewTimeoutClassificationInput,
} from "../review-orchestration/review-timeout-classification.ts";
import {
  logReviewTimeoutClassification,
  type ReviewTimeoutClassificationTelemetry,
} from "../review-orchestration/review-timeout-classification-log.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import type { ReviewTimeoutRetryContext } from "./review-timeout-retry-context.ts";

type ReviewTimeoutClassificationContextParams = {
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
};

export function buildReviewTimeoutClassificationContextParams(params: Omit<
  ReviewTimeoutClassificationContextParams,
  "timeoutFirstPass" | "checkpoint"
> & {
  timeoutFirstPass: ReviewFirstPassPayload | null;
  hasCheckpoint: boolean;
  timeoutReviewedFiles: readonly unknown[];
  timeoutInspectedFiles: readonly unknown[];
  timeoutFindingCount: number;
  timeoutTotalFiles: number;
}): ReviewTimeoutClassificationContextParams {
  return {
    ...params,
    timeoutFirstPass: params.timeoutFirstPass
      ? {
          state: params.timeoutFirstPass.state,
          boundedReason: params.timeoutFirstPass.boundedReason,
          evidenceSource: params.timeoutFirstPass.evidenceSource,
          continuationPending: params.timeoutFirstPass.continuationPending,
          zeroEvidenceFailure: params.timeoutFirstPass.zeroEvidenceFailure,
        }
      : null,
    checkpoint: params.hasCheckpoint
      ? {
          filesReviewed: params.timeoutReviewedFiles.length,
          filesInspected: params.timeoutInspectedFiles.length,
          findingCount: params.timeoutFindingCount,
          totalFiles: params.timeoutTotalFiles,
        }
      : null,
  };
}

export function resolveReviewTimeoutClassificationContext(
  params: ReviewTimeoutClassificationContextParams,
): ReviewTimeoutClassificationTelemetry {
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
