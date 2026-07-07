import type { Logger } from "pino";
import type { ReviewTimeoutZeroEvidenceWarning } from "./review-timeout-continuation-state.ts";

export function logReviewTimeoutZeroEvidenceWarning(params: {
  logger: Pick<Logger, "warn">;
  deliveryId: string;
  prNumber: number;
  reviewOutputKey: string;
  zeroEvidenceWarning: ReviewTimeoutZeroEvidenceWarning;
}): void {
  params.logger.warn(
    {
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      ...params.zeroEvidenceWarning,
      reviewOutputKey: params.reviewOutputKey,
    },
    "Constrained timeout remained a zero-evidence hard failure",
  );
}
