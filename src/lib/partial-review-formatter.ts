import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import {
  buildReviewFirstPassPublicSummary,
  type TimeoutBudgetDetails,
} from "./review-details-formatting.ts";
import { buildReviewOutputMarker } from "../review-orchestration/review-idempotency.ts";

export type ContinuationRevisionCounts = {
  new: number;
  stillOpen: number;
  resolved: number;
};

export type PartialReviewParams = {
  summaryDraft: string;
  firstPass: ReviewFirstPassPayload;
  reviewOutputKey?: string;
  timedOutAfterSeconds?: number;
  timeoutBudget?: TimeoutBudgetDetails | null;
  isRetrySkipped?: boolean;
  retrySkipReason?: string;
  isRetryResult?: boolean;
  retryFilesReviewed?: number;
  continuationRevisionCounts?: ContinuationRevisionCounts | null;
};

function formatFindingCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export function formatContinuationRevisionSummary(params: {
  counts: ContinuationRevisionCounts;
}): string | null {
  const { counts } = params;
  if (counts.new <= 0 && counts.stillOpen <= 0 && counts.resolved <= 0) {
    return null;
  }

  return `Continuation revisions: ${formatFindingCount(counts.new, "new finding")}, ${formatFindingCount(counts.stillOpen, "still-open finding")}, and ${formatFindingCount(counts.resolved, "resolved or revised finding")}.`;
}

export function formatCompletedContinuationReviewComment(params: {
  summaryDraft: string;
  reviewOutputKey?: string;
  totalFiles: number;
  continuationRevisionCounts?: ContinuationRevisionCounts | null;
}): string {
  const lines: string[] = [];

  lines.push(`> **Review complete** -- initial review reached the turn limit, then Kodiai automatically completed the remaining scope before publishing this summary.`);
  lines.push("> ");
  lines.push(`> Coverage: ${params.totalFiles} of ${params.totalFiles} changed files reviewed.`);

  const continuationRevisionSummary = params.continuationRevisionCounts
    ? formatContinuationRevisionSummary({ counts: params.continuationRevisionCounts })
    : null;
  if (continuationRevisionSummary) {
    lines.push("> ");
    lines.push(`> ${continuationRevisionSummary}`);
  }

  lines.push("");
  lines.push(params.summaryDraft);

  if (params.reviewOutputKey) {
    lines.push("");
    lines.push(buildReviewOutputMarker(params.reviewOutputKey));
  }

  return lines.join("\n");
}

export function formatPartialReviewComment(params: PartialReviewParams): string {
  const {
    summaryDraft,
    firstPass,
    timedOutAfterSeconds,
    timeoutBudget,
    isRetrySkipped,
    retrySkipReason,
    isRetryResult,
    retryFilesReviewed,
  } = params;

  if (firstPass.state !== "bounded-first-pass") {
    throw new Error("formatPartialReviewComment requires a publishable bounded-first-pass payload");
  }

  const lines: string[] = [];

  lines.push(`> **Bounded first-pass review** -- ${buildReviewFirstPassPublicSummary(firstPass, timedOutAfterSeconds, timeoutBudget)}.`);

  if (isRetryResult) {
    const retryReviewed = retryFilesReviewed ?? 0;
    const totalFiles = firstPass.coveredScope?.totalFiles ?? firstPass.remainingScope?.totalFiles ?? retryReviewed;
    const totalReviewed = firstPass.coveredScope?.reviewedFiles ?? retryReviewed;
    lines.push(">");
    lines.push(`> Retry complete -- analyzed ${totalReviewed} of ${totalFiles} files total after a reduced-scope follow-up.`);

    const continuationRevisionSummary = params.continuationRevisionCounts
      ? formatContinuationRevisionSummary({ counts: params.continuationRevisionCounts })
      : null;
    if (continuationRevisionSummary) {
      lines.push(">");
      lines.push(`> ${continuationRevisionSummary}`);
    }
  }

  if (isRetrySkipped && retrySkipReason) {
    lines.push(">");
    lines.push(`> ${retrySkipReason}`);
    lines.push("> Consider splitting large PRs to stay within the review timeout budget.");
  }

  lines.push("");
  lines.push(summaryDraft);

  if (params.reviewOutputKey) {
    lines.push("");
    lines.push(buildReviewOutputMarker(params.reviewOutputKey));
  }

  return lines.join("\n");
}
