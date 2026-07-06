import { describe, expect, test } from "bun:test";
import type { ReviewCacheEventRecord } from "../telemetry/types.ts";
import { recordReviewCacheEventFailOpen } from "./review-handler-utils.ts";

function makeReviewCacheEvent(overrides: Partial<ReviewCacheEventRecord> = {}): ReviewCacheEventRecord {
  return {
    deliveryId: "delivery-1",
    repo: "acme/widgets",
    prNumber: 42,
    cacheSurface: "review-derived-prompt",
    status: "miss",
    reason: "cache-miss",
    ...overrides,
  };
}

function makeLogger() {
  const warnings: Array<{ fields: Record<string, unknown>; message?: string }> = [];
  return {
    warnings,
    logger: {
      warn: (fields: Record<string, unknown>, message?: string) => {
        warnings.push({ fields, message });
      },
    },
  };
}

describe("recordReviewCacheEventFailOpen", () => {
  test("records review cache telemetry when the store method is available", async () => {
    const { warnings, logger } = makeLogger();
    const events: ReviewCacheEventRecord[] = [];
    const entry = makeReviewCacheEvent({ status: "hit", reason: "safe-reuse" });

    const result = await recordReviewCacheEventFailOpen({
      telemetryStore: {
        recordReviewCacheEvent: async (record) => {
          events.push(record);
        },
      },
      logger,
      entry,
    });

    expect(result).toEqual({ ok: true, value: "recorded" });
    expect(events).toEqual([entry]);
    expect(warnings).toEqual([]);
  });

  test("warns and returns when review cache telemetry is unavailable", async () => {
    const { warnings, logger } = makeLogger();
    const telemetryStore = {};

    const result = await recordReviewCacheEventFailOpen({
      telemetryStore,
      logger,
      entry: makeReviewCacheEvent({ status: "bypass", reason: "incomplete-fingerprint" }),
    });

    expect(result).toEqual({ ok: true, value: "skipped" });
    expect(warnings).toEqual([{
      fields: {
        deliveryId: "delivery-1",
        repo: "acme/widgets",
        prNumber: 42,
        cacheSurface: "review-derived-prompt",
        status: "bypass",
        reason: "incomplete-fingerprint",
      },
      message: "Review cache telemetry store method unavailable (non-blocking)",
    }]);
  });

  test("swallows review cache telemetry write failures with bounded context", async () => {
    const { warnings, logger } = makeLogger();
    const error = new Error("database unavailable");
    const telemetryStore = {
      recordReviewCacheEvent: async () => {
        throw error;
      },
    };

    const result = await recordReviewCacheEventFailOpen({
      telemetryStore,
      logger,
      entry: makeReviewCacheEvent({
        status: "degraded",
        reason: "bookkeeping-failure",
        fingerprintVersion: "prompt-v1",
        safetySignalNames: ["prompt-fingerprint-v1"],
        missingSignalNames: ["head-sha"],
        invalidationSignalNames: ["diff-changed"],
        bookkeepingErrorCount: 2,
      }),
    });

    expect(result).toEqual({ ok: false, err: error });
    expect(warnings).toEqual([{
      fields: {
        err: error,
        deliveryId: "delivery-1",
        repo: "acme/widgets",
        prNumber: 42,
        cacheSurface: "review-derived-prompt",
        status: "degraded",
        reason: "bookkeeping-failure",
        fingerprintVersion: "prompt-v1",
        safetySignalNames: ["prompt-fingerprint-v1"],
        missingSignalNames: ["head-sha"],
        invalidationSignalNames: ["diff-changed"],
        bookkeepingErrorCount: 2,
      },
      message: "Review cache telemetry write failed (non-blocking)",
    }]);
  });
});
