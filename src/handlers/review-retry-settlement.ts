import type { Logger } from "pino";
import { ok, type Result } from "../lib/result.ts";
import { resolveQuietSettledContinuationFamilyState } from "./review-continuation-family-state-projection.ts";

type QuietRetrySettlementPersistence = {
  attemptId: string;
  reviewOutputKey: string;
  persistContinuationFamilyState: (
    state: ReturnType<typeof resolveQuietSettledContinuationFamilyState>,
  ) => Promise<void>;
};

export type RetryNoAdditionalResultsSettlementStatus = {
  status: "quiet-settled";
  persistedContinuationState: boolean;
  discardedCheckpoints: boolean;
  reason: string;
};

export type RetryNoAdditionalResultsSettlementResult =
  Result<RetryNoAdditionalResultsSettlementStatus, never>;

export async function settleRetryWithNoAdditionalResults(params: {
  logger: Pick<Logger, "info">;
  deliveryId: string;
  prNumber: number;
  retryConclusion: string;
  settlementReason?: string;
  quietSettlement?: QuietRetrySettlementPersistence;
  discardCheckpoints?: () => void;
}): Promise<RetryNoAdditionalResultsSettlementResult> {
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
  return ok({
    status: "quiet-settled",
    persistedContinuationState: params.quietSettlement !== undefined,
    discardedCheckpoints: params.discardCheckpoints !== undefined,
    reason: params.settlementReason ?? "no-retry-results",
  });
}
