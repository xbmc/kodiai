import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { buildReviewFirstPassPublicSummary } from "./review-utils.ts";
import { buildReviewOutputMarker } from "../handlers/review-idempotency.ts";

export type PartialReviewParams = {
  summaryDraft: string;
  firstPass: ReviewFirstPassPayload;
  reviewOutputKey?: string;
  timedOutAfterSeconds?: number;
  isRetrySkipped?: boolean;
  retrySkipReason?: string;
  isRetryResult?: boolean;
  retryFilesReviewed?: number;
};

export function formatPartialReviewComment(params: PartialReviewParams): string {
  const {
    summaryDraft,
    firstPass,
    timedOutAfterSeconds,
    isRetrySkipped,
    retrySkipReason,
    isRetryResult,
    retryFilesReviewed,
  } = params;

  if (firstPass.state !== "bounded-first-pass") {
    throw new Error("formatPartialReviewComment requires a publishable bounded-first-pass payload");
  }

  const lines: string[] = [];

  lines.push(`> **Bounded first-pass review** -- ${buildReviewFirstPassPublicSummary(firstPass, timedOutAfterSeconds)}.`);

  if (isRetryResult) {
    const retryReviewed = retryFilesReviewed ?? 0;
    const totalFiles = firstPass.coveredScope?.totalFiles ?? firstPass.remainingScope?.totalFiles ?? retryReviewed;
    const totalReviewed = firstPass.coveredScope?.reviewedFiles ?? retryReviewed;
    lines.push(">");
    lines.push(`> Retry complete -- analyzed ${totalReviewed} of ${totalFiles} files total after a reduced-scope follow-up.`);
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
