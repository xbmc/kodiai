import type { Logger } from "pino";

export function logBoundedFirstPassReviewPublished(params: {
  logger: Pick<Logger, "info">;
  deliveryId: string;
  prNumber: number;
  partialCommentId: number;
  boundedReason: string | null | undefined;
  evidenceSource: string | null | undefined;
  coveredFiles: number | null | undefined;
  inspectedFiles: number | null | undefined;
  remainingFiles: number | null | undefined;
  findingCount: number;
  hasPartialResults: boolean;
  isChronicTimeout: boolean;
  recentTimeouts: number;
  retryState: string;
  zeroEvidenceFailure: boolean | null | undefined;
}): void {
  params.logger.info(
    {
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      partialCommentId: params.partialCommentId,
      boundedReason: params.boundedReason,
      evidenceSource: params.evidenceSource,
      coveredFiles: params.coveredFiles ?? null,
      inspectedFiles: params.inspectedFiles,
      remainingFiles: params.remainingFiles ?? null,
      findingCount: params.findingCount,
      hasPartialResults: params.hasPartialResults,
      isChronicTimeout: params.isChronicTimeout,
      recentTimeouts: params.recentTimeouts,
      retryState: params.retryState,
      zeroEvidenceFailure: params.zeroEvidenceFailure,
    },
    "Published bounded first-pass review on timeout",
  );
}
