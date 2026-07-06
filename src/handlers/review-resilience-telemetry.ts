import type { ResilienceEventRecord, TelemetryStore } from "../telemetry/types.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";

type ResilienceTelemetryStore = Pick<TelemetryStore, "recordResilienceEvent">;
type ResilienceTelemetryLogger = {
  warn(payload: Record<string, unknown>, message: string): void;
};

export type ReviewResilienceTelemetryStatus = "recorded" | "skipped";
export type ReviewResilienceTelemetryResult = Result<ReviewResilienceTelemetryStatus>;

export async function recordReviewResilienceEventFailOpen(params: {
  telemetryStore: ResilienceTelemetryStore;
  logger: ResilienceTelemetryLogger;
  entry: ResilienceEventRecord;
}): Promise<ReviewResilienceTelemetryResult> {
  const recordResilienceEvent = params.telemetryStore.recordResilienceEvent;
  if (!recordResilienceEvent) {
    return resultOk("skipped");
  }

  try {
    await recordResilienceEvent(params.entry);
    return resultOk("recorded");
  } catch (err) {
    const error = toError(err);
    params.logger.warn({ err: error }, "Resilience telemetry write failed (non-blocking)");
    return resultErr(error);
  }
}
