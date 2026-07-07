import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import {
  formatCompletedContinuationReviewComment,
  formatPartialReviewComment,
  type ContinuationRevisionCounts,
} from "../lib/partial-review-formatter.ts";
import {
  normalizeReviewFirstPass,
  type ReviewFirstPassBoundedReason,
  type ReviewFirstPassOutcome,
  type ReviewFirstPassPayload,
} from "../lib/review-first-pass.ts";

export type ReviewContinuationMergeContext =
  | {
      status: "publishable";
      body: string;
      mergedFirstPass: ReviewFirstPassPayload;
      reviewDetailsFirstPass: ReviewFirstPassPayload | null;
      retryFilesReviewed: number;
      completedMaxTurnsContinuation: boolean;
    }
  | {
      status: "non-publishable";
      reason: "non-publishable-merged-first-pass";
    };

export function resolveReviewContinuationMergeContext(params: {
  reviewBoundedness: ReviewBoundednessContract | null | undefined;
  mergedCheckpoint: CheckpointRecord;
  retryCheckpoint: CheckpointRecord | null | undefined;
  baseCheckpoint: CheckpointRecord | null | undefined;
  firstPassOutcome: ReviewFirstPassOutcome;
  timeoutFirstPassBoundedReason?: ReviewFirstPassBoundedReason | null;
  timeoutDurationSeconds: number;
  retryFilesCount: number;
  reviewOutputKey: string;
  continuationRevisionCounts: ContinuationRevisionCounts | null;
}): ReviewContinuationMergeContext {
  const mergedFirstPass = normalizeReviewFirstPass({
    boundedness: params.reviewBoundedness,
    checkpoint: params.mergedCheckpoint,
    outcome: params.firstPassOutcome,
  });

  if (mergedFirstPass?.state !== "bounded-first-pass") {
    return {
      status: "non-publishable",
      reason: "non-publishable-merged-first-pass",
    };
  }

  const retryFilesReviewed = params.retryCheckpoint?.filesReviewed?.length ?? params.retryFilesCount;
  const summaryDraftForMerge =
    params.mergedCheckpoint.summaryDraft ||
    params.retryCheckpoint?.summaryDraft ||
    params.baseCheckpoint?.summaryDraft ||
    "Review completed with reduced scope.";
  const mergedReviewedFiles = params.mergedCheckpoint.filesReviewed.length;
  const mergedTotalFiles = params.mergedCheckpoint.totalFiles;
  const completedMaxTurnsContinuation = params.timeoutFirstPassBoundedReason === "max-turns"
    && mergedTotalFiles > 0
    && mergedReviewedFiles >= mergedTotalFiles;
  const reviewDetailsFirstPass = completedMaxTurnsContinuation ? null : mergedFirstPass;
  const body = completedMaxTurnsContinuation
    ? formatCompletedContinuationReviewComment({
        summaryDraft: summaryDraftForMerge,
        reviewOutputKey: params.reviewOutputKey,
        totalFiles: mergedTotalFiles,
        continuationRevisionCounts: params.continuationRevisionCounts,
      })
    : formatPartialReviewComment({
        summaryDraft: summaryDraftForMerge,
        firstPass: mergedFirstPass,
        reviewOutputKey: params.reviewOutputKey,
        timedOutAfterSeconds: params.timeoutDurationSeconds,
        isRetryResult: true,
        retryFilesReviewed,
        continuationRevisionCounts: params.continuationRevisionCounts,
      });

  return {
    status: "publishable",
    body,
    mergedFirstPass,
    reviewDetailsFirstPass,
    retryFilesReviewed,
    completedMaxTurnsContinuation,
  };
}
