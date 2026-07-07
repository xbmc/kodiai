import type { CheckpointRecord } from "../knowledge/types.ts";
import type { FileRiskScore } from "../lib/file-risk-scorer.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import {
  type ContinuationCompactionPlanningSignals,
  type ContinuationTimeoutEstimate,
  type EstimateContinuationTimeoutParams,
  planReviewContinuation,
  type ReviewContinuationPlanDecision,
} from "../lib/review-continuation-lifecycle.ts";
import { computeRetryScope } from "../lib/retry-scope-reducer.ts";

type ReviewTimeoutRetryEstimate = ContinuationTimeoutEstimate & {
  totalTimeoutSeconds?: number;
};

export type ReviewTimeoutRetryContext = {
  timeoutFirstPass: ReviewFirstPassPayload | null;
  retryPlan: ReviewContinuationPlanDecision | null;
  retryState: string;
  retrySummaryNote?: string;
};

function initialRetryState(params: {
  isChronicTimeout: boolean;
  hasPublishedInlines: boolean;
}): string {
  if (params.isChronicTimeout) {
    return "skipped (frequent timeouts for this repo/author)";
  }

  return params.hasPublishedInlines
    ? "not scheduled (GitHub-visible findings already posted)"
    : "not scheduled";
}

function retryStateForSkippedPlan(reason: ReviewContinuationPlanDecision["reason"]): {
  retryState: string;
  retrySummaryNote?: string;
} {
  switch (reason) {
    case "chronic-timeout":
      return { retryState: "skipped (frequent timeouts for this repo/author)" };
    case "inline-output-already-published":
      return {
        retryState: "not scheduled (GitHub-visible findings already posted)",
        retrySummaryNote: "Retry not scheduled because GitHub-visible findings were already posted.",
      };
    case "no-remaining-scope":
      return {
        retryState: "not scheduled (no remaining files outside analyzed progress)",
        retrySummaryNote: "Retry not scheduled because no remaining files were outside the analyzed progress.",
      };
    case "invalid-checkpoint-scope":
      return {
        retryState: "not scheduled (invalid checkpoint scope)",
        retrySummaryNote: "Retry not scheduled because checkpoint scope was malformed.",
      };
    case "zero-evidence-failure":
      return { retryState: "not scheduled (zero-evidence timeout)" };
    case "remaining-scope-available":
      return { retryState: "scheduled reduced-scope retry", retrySummaryNote: "Scheduling a reduced-scope retry." };
  }
}

function buildZeroEvidenceFallbackRetryPlan(params: {
  reviewOutputKey: string;
  timeoutFirstPass: ReviewFirstPassPayload;
  checkpoint: CheckpointRecord | null;
  riskScores: FileRiskScore[];
  timeoutDurationSeconds: number;
  timeoutReviewedFiles: string[];
  timeoutTotalFiles: number;
  forceCheckpointEnabled: boolean;
  estimateContinuationTimeout: (params: EstimateContinuationTimeoutParams) => ReviewTimeoutRetryEstimate;
}): ReviewContinuationPlanDecision | null {
  const retryRemoteRuntimeBudgetSeconds = Math.max(30, Math.floor(params.timeoutDurationSeconds / 2));
  const retryScope = computeRetryScope({
    allFiles: params.riskScores,
    filesAlreadyReviewed: params.timeoutReviewedFiles,
    totalFiles: params.timeoutTotalFiles,
  });

  if (retryScope.filesToReview.length === 0) {
    return null;
  }

  const continuationFiles = retryScope.filesToReview.map((file) => file.filePath);
  const timeoutEstimate = params.estimateContinuationTimeout({
    timeoutSeconds: retryRemoteRuntimeBudgetSeconds,
    files: continuationFiles,
  });

  return {
    decision: "schedule-continuation",
    reason: "remaining-scope-available",
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: `${params.reviewOutputKey}-retry-1`,
    continuationNumber: 1,
    continuationFiles,
    scopeRatio: retryScope.scopeRatio,
    timeoutSeconds: timeoutEstimate.totalTimeoutSeconds ?? timeoutEstimate.dynamicTimeoutSeconds,
    checkpointEnabled:
      params.forceCheckpointEnabled ||
      timeoutEstimate.riskLevel === "medium" ||
      timeoutEstimate.riskLevel === "high",
    timeoutEstimate,
    firstPass: params.timeoutFirstPass,
    checkpoint: params.checkpoint,
  };
}

export function resolveReviewTimeoutRetryContext(params: {
  reviewOutputKey: string;
  timeoutFirstPass: ReviewFirstPassPayload | null;
  checkpoint: CheckpointRecord | null;
  riskScores: FileRiskScore[];
  timeoutDurationSeconds: number;
  continuationCompaction?: ContinuationCompactionPlanningSignals;
  hasPublishedInlines: boolean;
  isChronicTimeout: boolean;
  timeoutReviewedFiles: string[];
  timeoutTotalFiles: number;
  checkpointPersistenceUnavailableForFamilyState: boolean;
  forceCheckpointEnabled: boolean;
  estimateContinuationTimeout: (params: EstimateContinuationTimeoutParams) => ReviewTimeoutRetryEstimate;
}): ReviewTimeoutRetryContext {
  const timeoutFirstPass = params.timeoutFirstPass;
  let retryState = initialRetryState({
    isChronicTimeout: params.isChronicTimeout,
    hasPublishedInlines: params.hasPublishedInlines,
  });
  let retrySummaryNote: string | undefined;
  let retryPlan: ReviewContinuationPlanDecision | null = null;

  if (!timeoutFirstPass) {
    return { timeoutFirstPass, retryPlan, retryState };
  }

  retryPlan = planReviewContinuation({
    reviewOutputKey: params.reviewOutputKey,
    firstPass: timeoutFirstPass,
    checkpoint: params.checkpoint,
    riskScores: params.riskScores,
    timeoutSeconds: params.timeoutDurationSeconds,
    continuationCompaction: params.continuationCompaction,
    hasPublishedInlineFindings: params.hasPublishedInlines,
    isChronicTimeout: params.isChronicTimeout,
    estimateContinuationTimeout: params.estimateContinuationTimeout,
  });

  if (retryPlan.decision === "schedule-continuation") {
    return {
      timeoutFirstPass,
      retryPlan,
      retryState: "scheduled reduced-scope retry",
      retrySummaryNote: "Scheduling a reduced-scope retry.",
    };
  }

  ({ retryState, retrySummaryNote } = retryStateForSkippedPlan(retryPlan.reason));

  if (retryPlan.reason === "zero-evidence-failure") {
    if (params.checkpointPersistenceUnavailableForFamilyState) {
      return {
        timeoutFirstPass,
        retryPlan,
        retryState,
        retrySummaryNote: "Retry not scheduled because the first pass produced no trustworthy evidence and checkpoint persistence is unavailable.",
      };
    }

    const fallbackRetryPlan = buildZeroEvidenceFallbackRetryPlan({
      reviewOutputKey: params.reviewOutputKey,
      timeoutFirstPass,
      checkpoint: params.checkpoint,
      riskScores: params.riskScores,
      timeoutDurationSeconds: params.timeoutDurationSeconds,
      timeoutReviewedFiles: params.timeoutReviewedFiles,
      timeoutTotalFiles: params.timeoutTotalFiles,
      forceCheckpointEnabled: params.forceCheckpointEnabled,
      estimateContinuationTimeout: params.estimateContinuationTimeout,
    });

    if (fallbackRetryPlan) {
      return {
        timeoutFirstPass,
        retryPlan: fallbackRetryPlan,
        retryState: "scheduled reduced-scope retry",
        retrySummaryNote: "Scheduling a reduced-scope retry.",
      };
    }
  }

  return {
    timeoutFirstPass,
    retryPlan,
    retryState,
    ...(retrySummaryNote ? { retrySummaryNote } : {}),
  };
}
