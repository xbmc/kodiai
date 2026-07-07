import type { Logger } from "pino";
import { resolveQuietSettledContinuationFamilyState } from "./review-continuation-family-state-projection.ts";

type QuietRetrySettlementPersistence = {
  attemptId: string;
  reviewOutputKey: string;
  persistContinuationFamilyState: (
    state: ReturnType<typeof resolveQuietSettledContinuationFamilyState>,
  ) => Promise<void>;
};

export async function settleRetryWithNoAdditionalResults(params: {
  logger: Pick<Logger, "info">;
  deliveryId: string;
  prNumber: number;
  retryConclusion: string;
  settlementReason?: string;
  quietSettlement?: QuietRetrySettlementPersistence;
  discardCheckpoints?: () => void;
}): Promise<void> {
  params.logger.info(
    {
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      retryConclusion: params.retryConclusion,
      ...(params.settlementReason ? { settlementReason: params.settlementReason } : {}),
    },
    "Retry produced no additional results -- keeping original partial review",
  );

  if (params.quietSettlement) {
    await params.quietSettlement.persistContinuationFamilyState(resolveQuietSettledContinuationFamilyState({
      attemptId: params.quietSettlement.attemptId,
      reviewOutputKey: params.quietSettlement.reviewOutputKey,
    }));
  }
  params.discardCheckpoints?.();
}
