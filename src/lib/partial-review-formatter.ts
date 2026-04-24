import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { describeReviewFirstPass } from "./review-utils.ts";

export type PartialReviewParams = {
  summaryDraft: string;
  firstPass: ReviewFirstPassPayload;
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

  const described = describeReviewFirstPass(firstPass);
  const lines: string[] = [];

  lines.push(`> **Bounded first-pass review** -- ${described.summaryClause(timedOutAfterSeconds)}.`);

  if (isRetryResult) {
    const retryReviewed = retryFilesReviewed ?? 0;
    const totalReviewed = (firstPass.coveredScope?.reviewedFiles ?? 0) + retryReviewed;
    const totalFiles = firstPass.coveredScope?.totalFiles ?? firstPass.remainingScope?.totalFiles ?? totalReviewed;
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

  return lines.join("\n");
}
