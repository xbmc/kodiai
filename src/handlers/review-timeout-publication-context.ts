import type { CheckpointRecord } from "../knowledge/types.ts";
import { formatPartialReviewComment } from "../lib/partial-review-formatter.ts";
import type { TimeoutBudgetDetails, TimeoutReviewDetailsProgress } from "../lib/review-details-formatting.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";

export type ReviewTimeoutPublicationContext = {
  summaryDraft: string;
  timeoutReviewDetails: TimeoutReviewDetailsProgress;
  deferredPublicOutputForContinuation: boolean;
  partialBody?: string;
};

export function normalizeReviewTimeoutBudgetDetails(
  timeoutBudget: (TimeoutBudgetDetails & Record<string, unknown>) | null | undefined,
): TimeoutBudgetDetails | null {
  if (!timeoutBudget) {
    return null;
  }

  return {
    remoteRuntimeBudgetSeconds: timeoutBudget.remoteRuntimeBudgetSeconds,
    infraOverheadBudgetSeconds: timeoutBudget.infraOverheadBudgetSeconds,
    totalTimeoutSeconds: timeoutBudget.totalTimeoutSeconds,
  };
}

function resolveSummaryDraftBase(params: {
  checkpoint: CheckpointRecord | null;
  hasPublishedInlines: boolean;
  hasPartialResults: boolean;
}): string {
  if (params.checkpoint?.summaryDraft) {
    return params.checkpoint.summaryDraft;
  }

  if (params.hasPublishedInlines) {
    return "Review stopped after GitHub-visible findings were already posted.";
  }

  return params.hasPartialResults
    ? "Review stopped after structured first-pass progress was recorded."
    : "Review stopped before producing trustworthy structured output.";
}

export function resolveReviewTimeoutPublicationContext(params: {
  reviewOutputKey: string;
  checkpoint: CheckpointRecord | null;
  hasPublishedInlines: boolean;
  hasPartialResults: boolean;
  retryState: string;
  retrySummaryNote?: string;
  timeoutInspectedFiles: string[];
  timeoutFindingCount: number;
  timeoutTotalFiles: number;
  turnBudgetExhausted: boolean;
  retryScheduled: boolean;
  timeoutFirstPass: ReviewFirstPassPayload | null;
  timeoutDurationSeconds: number;
  timeoutBudget: TimeoutBudgetDetails | null;
  isChronicTimeout: boolean;
}): ReviewTimeoutPublicationContext {
  const summaryDraftBase = resolveSummaryDraftBase({
    checkpoint: params.checkpoint,
    hasPublishedInlines: params.hasPublishedInlines,
    hasPartialResults: params.hasPartialResults,
  });
  const summaryDraft = params.retrySummaryNote
    ? `${summaryDraftBase}\n\n${params.retrySummaryNote}`
    : summaryDraftBase;
  const timeoutReviewDetails = {
    analyzedFiles: params.timeoutInspectedFiles.length,
    totalFiles: params.timeoutTotalFiles,
    findingCount: params.timeoutFindingCount,
    retryState: params.retryState,
  };
  const deferredPublicOutputForContinuation = params.turnBudgetExhausted
    && params.retryScheduled
    && !params.hasPublishedInlines;
  const shouldBuildPartialBody = params.timeoutFirstPass?.state === "bounded-first-pass"
    && !deferredPublicOutputForContinuation;

  return {
    summaryDraft,
    timeoutReviewDetails,
    deferredPublicOutputForContinuation,
    ...(shouldBuildPartialBody && params.timeoutFirstPass
      ? {
          partialBody: formatPartialReviewComment({
            summaryDraft,
            firstPass: params.timeoutFirstPass,
            reviewOutputKey: params.reviewOutputKey,
            timedOutAfterSeconds: params.timeoutDurationSeconds,
            timeoutBudget: params.timeoutBudget,
            isRetrySkipped: params.isChronicTimeout,
            retrySkipReason: params.isChronicTimeout
              ? "Retry skipped -- this repo has timed out frequently for this author."
              : undefined,
          }),
        }
      : {}),
  };
}
