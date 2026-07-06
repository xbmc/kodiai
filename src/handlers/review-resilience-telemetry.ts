import type { ResilienceEventRecord, TelemetryStore } from "../telemetry/types.ts";

type ResilienceTelemetryStore = Pick<TelemetryStore, "recordResilienceEvent">;
type ResilienceTelemetryLogger = {
  warn(payload: Record<string, unknown>, message: string): void;
};

export type ReviewResilienceTelemetryResult = "recorded" | "skipped" | "failed";

export async function recordReviewResilienceEventFailOpen(params: {
  telemetryStore: ResilienceTelemetryStore;
  logger: ResilienceTelemetryLogger;
  entry: ResilienceEventRecord;
}): Promise<ReviewResilienceTelemetryResult> {
  const recordResilienceEvent = params.telemetryStore.recordResilienceEvent;
  if (!recordResilienceEvent) {
    return "skipped";
  }

  try {
    await recordResilienceEvent(params.entry);
    return "recorded";
  } catch (err) {
    params.logger.warn({ err }, "Resilience telemetry write failed (non-blocking)");
    return "failed";
  }
}
