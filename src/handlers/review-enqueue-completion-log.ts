import type { Logger } from "pino";

export function logReviewEnqueueCompleted(params: {
  logger: Pick<Logger, "info">;
  baseLog: Record<string, unknown>;
}): void {
  params.logger.info(
    { ...params.baseLog, gate: "enqueue", gateResult: "completed" },
    "Review enqueue completed",
  );
}
