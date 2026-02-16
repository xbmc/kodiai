export type PartialReviewParams = {
  summaryDraft: string;
  filesReviewed: number;
  totalFiles: number;
  timedOutAfterSeconds: number;
  isRetrySkipped?: boolean;
  retrySkipReason?: string;
  isRetryResult?: boolean;
  retryFilesReviewed?: number;
};

export function formatPartialReviewComment(params: PartialReviewParams): string {
  const {
    summaryDraft,
    filesReviewed,
    totalFiles,
    timedOutAfterSeconds,
    isRetrySkipped,
    retrySkipReason,
    isRetryResult,
    retryFilesReviewed,
  } = params;

  const lines: string[] = [];

  if (isRetryResult) {
    const retryReviewed = retryFilesReviewed ?? 0;
    const totalReviewed = filesReviewed + retryReviewed;
    lines.push(
      `> **Partial review** -- Analyzed ${totalReviewed} of ${totalFiles} files. Reviewed top ${retryReviewed} files by risk in retry.`,
    );
  } else {
    lines.push(
      `> **Partial review** -- timed out after analyzing ${filesReviewed} of ${totalFiles} files (${timedOutAfterSeconds}s).`,
    );
  }

  if (isRetrySkipped && retrySkipReason) {
    lines.push(">");
    lines.push(`> ${retrySkipReason}`);
    lines.push(
      "> Consider splitting large PRs to stay within the review timeout budget.",
    );
  }

  lines.push("");
  lines.push(summaryDraft);

  return lines.join("\n");
}
