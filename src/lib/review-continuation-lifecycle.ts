import type { CheckpointRecord } from "../knowledge/types.ts";
import type { FileRiskScore } from "./file-risk-scorer.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { computeRetryScope } from "./retry-scope-reducer.ts";

export type ContinuationTimeoutEstimate = {
  riskLevel: "low" | "medium" | "high";
  dynamicTimeoutSeconds: number;
  reasoning: string;
  shouldReduceScope: boolean;
};

export type EstimateContinuationTimeoutParams = {
  timeoutSeconds: number;
  files: string[];
};

export type PlanReviewContinuationParams = {
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload | null;
  checkpoint: CheckpointRecord | null;
  riskScores: FileRiskScore[];
  timeoutSeconds: number;
  hasPublishedInlineFindings: boolean;
  isChronicTimeout: boolean;
  estimateContinuationTimeout: (
    params: EstimateContinuationTimeoutParams,
  ) => ContinuationTimeoutEstimate;
};

export type ScheduleContinuationDecision = {
  decision: "schedule-continuation";
  reason: "remaining-scope-available";
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  continuationNumber: 1;
  continuationFiles: string[];
  scopeRatio: number;
  timeoutSeconds: number;
  checkpointEnabled: boolean;
  timeoutEstimate: ContinuationTimeoutEstimate;
  firstPass: ReviewFirstPassPayload;
  checkpoint: CheckpointRecord | null;
};

export type SkipContinuationReason =
  | "zero-evidence-failure"
  | "inline-output-already-published"
  | "invalid-checkpoint-scope"
  | "no-remaining-scope"
  | "chronic-timeout";

export type SkipContinuationDecision = {
  decision: "skip-continuation";
  reason: SkipContinuationReason;
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload;
};

export type ReviewContinuationPlanDecision =
  | ScheduleContinuationDecision
  | SkipContinuationDecision;

export type SettleReviewContinuationParams = {
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  baseCheckpoint: CheckpointRecord | null;
  continuationCheckpoint: CheckpointRecord | null;
  continuationPublished: boolean;
};

export type MergeContinuationDecision = {
  decision: "merge-continuation";
  reason: "new-structured-results" | "inline-results-published";
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  mergedCheckpoint: CheckpointRecord;
  cleanupReviewOutputKeys: [string, string];
};

export type SettleWithoutUpdateDecision = {
  decision: "settle-without-update";
  reason: "no-new-results";
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  cleanupReviewOutputKeys: [string, string];
};

export type ReviewContinuationSettlementDecision =
  | MergeContinuationDecision
  | SettleWithoutUpdateDecision;

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function isValidCheckpointScope(checkpoint: CheckpointRecord | null): boolean {
  if (!checkpoint) {
    return true;
  }

  return checkpoint.filesReviewed.length <= checkpoint.totalFiles;
}

function deriveContinuationReviewOutputKey(reviewOutputKey: string, continuationNumber: 1): string {
  return `${reviewOutputKey}-retry-${continuationNumber}`;
}

function mergeCheckpointState(params: {
  baseCheckpoint: CheckpointRecord;
  continuationCheckpoint: CheckpointRecord;
}): CheckpointRecord {
  const { baseCheckpoint, continuationCheckpoint } = params;

  return {
    ...baseCheckpoint,
    filesReviewed: Array.from(new Set([
      ...baseCheckpoint.filesReviewed,
      ...continuationCheckpoint.filesReviewed,
    ])),
    findingCount: Math.max(baseCheckpoint.findingCount, continuationCheckpoint.findingCount),
    summaryDraft: continuationCheckpoint.summaryDraft || baseCheckpoint.summaryDraft,
    totalFiles: Math.max(baseCheckpoint.totalFiles, continuationCheckpoint.totalFiles),
    partialCommentId: baseCheckpoint.partialCommentId ?? continuationCheckpoint.partialCommentId,
  };
}

function hasNewReviewedFiles(baseCheckpoint: CheckpointRecord, continuationCheckpoint: CheckpointRecord): boolean {
  const reviewedSet = new Set(baseCheckpoint.filesReviewed);
  return continuationCheckpoint.filesReviewed.some((file) => !reviewedSet.has(file));
}

export function planReviewContinuation(
  params: PlanReviewContinuationParams,
): ReviewContinuationPlanDecision {
  assertNonEmptyString(params.reviewOutputKey, "reviewOutputKey");

  const firstPass = params.firstPass;
  if (!firstPass) {
    throw new Error("firstPass must be provided");
  }

  if (firstPass.state === "zero-evidence-failure" || firstPass.zeroEvidenceFailure) {
    return {
      decision: "skip-continuation",
      reason: "zero-evidence-failure",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  if (params.hasPublishedInlineFindings || firstPass.publication.hasPublishedOutput) {
    return {
      decision: "skip-continuation",
      reason: "inline-output-already-published",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  if (params.isChronicTimeout) {
    return {
      decision: "skip-continuation",
      reason: "chronic-timeout",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  if (!isValidCheckpointScope(params.checkpoint)) {
    return {
      decision: "skip-continuation",
      reason: "invalid-checkpoint-scope",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  const totalFiles = params.checkpoint?.totalFiles
    ?? firstPass.remainingScope?.totalFiles
    ?? firstPass.coveredScope?.totalFiles
    ?? params.riskScores.length;
  const filesAlreadyReviewed = params.checkpoint?.filesReviewed ?? [];
  const retryScope = computeRetryScope({
    allFiles: params.riskScores,
    filesAlreadyReviewed,
    totalFiles,
  });

  if (
    (firstPass.remainingScope && firstPass.remainingScope.remainingFiles <= 0)
    || retryScope.filesToReview.length === 0
  ) {
    if (firstPass.remainingScope && firstPass.remainingScope.remainingFiles > 0 && retryScope.filesToReview.length === 0) {
      throw new Error("continuation files cannot be empty when remaining scope exists");
    }

    return {
      decision: "skip-continuation",
      reason: "no-remaining-scope",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  const continuationFiles = retryScope.filesToReview.map((file) => file.filePath);
  const continuationTimeoutSeconds = Math.max(30, Math.floor(params.timeoutSeconds / 2));
  const timeoutEstimate = params.estimateContinuationTimeout({
    timeoutSeconds: continuationTimeoutSeconds,
    files: continuationFiles,
  });
  const scheduledTimeoutSeconds = Math.max(30, timeoutEstimate.dynamicTimeoutSeconds);

  return {
    decision: "schedule-continuation",
    reason: "remaining-scope-available",
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: deriveContinuationReviewOutputKey(params.reviewOutputKey, 1),
    continuationNumber: 1,
    continuationFiles,
    scopeRatio: retryScope.scopeRatio,
    timeoutSeconds: scheduledTimeoutSeconds,
    checkpointEnabled: timeoutEstimate.riskLevel === "medium" || timeoutEstimate.riskLevel === "high",
    timeoutEstimate,
    firstPass,
    checkpoint: params.checkpoint,
  };
}

export function settleReviewContinuation(
  params: SettleReviewContinuationParams,
): ReviewContinuationSettlementDecision {
  assertNonEmptyString(params.reviewOutputKey, "reviewOutputKey");
  assertNonEmptyString(params.continuationReviewOutputKey, "continuationReviewOutputKey");

  if (!params.baseCheckpoint) {
    throw new Error("base checkpoint is required for continuation settlement");
  }

  if (!params.continuationCheckpoint) {
    return {
      decision: "settle-without-update",
      reason: "no-new-results",
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: params.continuationReviewOutputKey,
      cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
    };
  }

  const mergedCheckpoint = mergeCheckpointState({
    baseCheckpoint: params.baseCheckpoint,
    continuationCheckpoint: params.continuationCheckpoint,
  });

  if (params.continuationPublished) {
    return {
      decision: "merge-continuation",
      reason: "inline-results-published",
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: params.continuationReviewOutputKey,
      mergedCheckpoint,
      cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
    };
  }

  if (
    params.continuationCheckpoint.findingCount > 0
    || hasNewReviewedFiles(params.baseCheckpoint, params.continuationCheckpoint)
  ) {
    return {
      decision: "merge-continuation",
      reason: "new-structured-results",
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: params.continuationReviewOutputKey,
      mergedCheckpoint,
      cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
    };
  }

  return {
    decision: "settle-without-update",
    reason: "no-new-results",
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: params.continuationReviewOutputKey,
    cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
  };
}
