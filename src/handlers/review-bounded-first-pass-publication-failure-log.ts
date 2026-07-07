import type { Logger } from "pino";

export function logBoundedFirstPassPublicationFailure(params: {
  logger: Pick<Logger, "warn">;
  error: unknown;
  deliveryId: string;
  prNumber: number;
}): void {
  params.logger.warn(
    {
      err: params.error,
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
    },
    "Failed to publish bounded first-pass review",
  );
}
