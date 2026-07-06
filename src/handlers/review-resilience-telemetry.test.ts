import { describe, expect, mock, test } from "bun:test";
import type { ResilienceEventRecord } from "../telemetry/types.ts";
import { recordReviewResilienceEventFailOpen } from "./review-resilience-telemetry.ts";

const baseEntry = {
  deliveryId: "delivery-1",
  repo: "octo/repo",
  prNumber: 42,
  prAuthor: "mona",
  eventType: "pull_request.opened",
  kind: "timeout",
} satisfies ResilienceEventRecord;

describe("recordReviewResilienceEventFailOpen", () => {
  test("records resilience telemetry when the store method is available", async () => {
    const recordResilienceEvent = mock(async (_entry: ResilienceEventRecord) => {});
    const logger = { warn: mock(() => {}) };

    const result = await recordReviewResilienceEventFailOpen({
      telemetryStore: { recordResilienceEvent },
      logger,
      entry: baseEntry,
    });

    expect(result).toEqual({ ok: true, value: "recorded" });
    expect(recordResilienceEvent).toHaveBeenCalledWith(baseEntry);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("skips cleanly when the store method is unavailable", async () => {
    const logger = { warn: mock(() => {}) };

    const result = await recordReviewResilienceEventFailOpen({
      telemetryStore: {},
      logger,
      entry: baseEntry,
    });

    expect(result).toEqual({ ok: true, value: "skipped" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("logs and swallows store failures", async () => {
    const err = new Error("write failed");
    const recordResilienceEvent = mock(async (_entry: ResilienceEventRecord) => {
      throw err;
    });
    const logger = { warn: mock(() => {}) };

    const result = await recordReviewResilienceEventFailOpen({
      telemetryStore: { recordResilienceEvent },
      logger,
      entry: baseEntry,
    });

    expect(result).toEqual({ ok: false, err });
    expect(logger.warn).toHaveBeenCalledWith(
      { err },
      "Resilience telemetry write failed (non-blocking)",
    );
  });
});
