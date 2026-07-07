import { describe, expect, mock, test } from "bun:test";
import type { ResilienceEventRecord } from "../telemetry/types.ts";
import {
  buildReviewTimeoutResilienceTelemetryEntry,
  recordReviewResilienceEventFailOpen,
} from "./review-resilience-telemetry.ts";

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

describe("buildReviewTimeoutResilienceTelemetryEntry", () => {
  const baseParams = {
    deliveryId: "delivery-1",
    repo: "octo/repo",
    prNumber: 42,
    prAuthor: "mona",
    eventType: "pull_request.opened",
    reviewOutputKey: "review-key",
    executionConclusion: "timeout",
    hadInlineOutput: true,
    checkpointFilesReviewed: 3,
    checkpointFilesInspected: 4,
    checkpointFindingCount: 2,
    checkpointTotalFiles: 9,
    partialCommentId: 123,
    recentTimeouts: 1,
    chronicTimeout: false,
    timeoutClassificationTelemetry: {
      timeoutClassification: "retryable_timeout",
      timeoutClassificationMode: "bounded_first_pass",
      timeoutClassificationReasons: ["partial-output"],
    },
  };

  test("builds first-pass timeout telemetry without retry-plan fields", () => {
    expect(buildReviewTimeoutResilienceTelemetryEntry({
      ...baseParams,
      retry: { enqueued: false },
    })).toEqual({
      deliveryId: "delivery-1",
      repo: "octo/repo",
      prNumber: 42,
      prAuthor: "mona",
      eventType: "pull_request.opened",
      kind: "timeout",
      reviewOutputKey: "review-key",
      executionConclusion: "timeout",
      hadInlineOutput: true,
      checkpointFilesReviewed: 3,
      checkpointFilesInspected: 4,
      checkpointFindingCount: 2,
      checkpointTotalFiles: 9,
      partialCommentId: 123,
      recentTimeouts: 1,
      chronicTimeout: false,
      retryEnqueued: false,
      timeoutClassification: "retryable_timeout",
      timeoutClassificationMode: "bounded_first_pass",
      timeoutClassificationReasons: ["partial-output"],
    } satisfies ResilienceEventRecord);
  });

  test("adds retry-plan fields when a continuation is enqueued", () => {
    expect(buildReviewTimeoutResilienceTelemetryEntry({
      ...baseParams,
      retry: {
        enqueued: true,
        filesCount: 5,
        scopeRatio: 0.5,
        timeoutSeconds: 120,
        riskLevel: "medium",
        checkpointEnabled: true,
      },
    })).toMatchObject({
      retryEnqueued: true,
      retryFilesCount: 5,
      retryScopeRatio: 0.5,
      retryTimeoutSeconds: 120,
      retryRiskLevel: "medium",
      retryCheckpointEnabled: true,
    } satisfies Partial<ResilienceEventRecord>);
  });
});
