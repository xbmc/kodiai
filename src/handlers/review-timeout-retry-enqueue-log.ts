import type { Logger } from "pino";

export function logReviewTimeoutRetryEnqueue(params: {
  logger: Pick<Logger, "info">;
  deliveryId: string;
  prNumber: number;
  retryFiles: number;
  scopeRatio: number;
  retryTimeout: number;
  retryRiskLevel: string;
}): void {
  params.logger.info(
    {
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      retryFiles: params.retryFiles,
      scopeRatio: params.scopeRatio,
      retryTimeout: params.retryTimeout,
      retryRiskLevel: params.retryRiskLevel,
    },
    "Enqueueing retry with reduced scope",
  );
}
