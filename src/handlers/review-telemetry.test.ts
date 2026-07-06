import { describe, expect, mock, test } from "bun:test";
import type { ExecutionResult } from "../execution/types.ts";
import type { PromptSectionRecord, RateLimitEventRecord, TelemetryRecord, TelemetryStore } from "../telemetry/types.ts";
import { ReviewExecutionTelemetryError, recordReviewExecutionTelemetry } from "./review-telemetry.ts";

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    conclusion: "success",
    costUsd: 0.42,
    numTurns: 3,
    durationMs: 1234,
    sessionId: "session-1",
    published: false,
    errorMessage: undefined,
    isTimeout: false,
    model: "claude-sonnet",
    inputTokens: 100,
    outputTokens: 25,
    cacheReadTokens: 10,
    cacheCreationTokens: 2,
    stopReason: "end_turn",
    ...overrides,
  };
}

function makePromptSection(deliveryId = "delivery-1"): PromptSectionRecord {
  return {
    deliveryId,
    repo: "xbmc/xbmc",
    taskType: "review.full",
    promptKind: "user",
    sections: [{
      sectionName: "review-change-context",
      sectionPosition: 1,
      charCount: 120,
      estimatedTokens: 30,
    }],
  };
}

function makeTelemetryStore(overrides: Partial<TelemetryStore> = {}) {
  const rateLimitEvents: RateLimitEventRecord[] = [];
  const records: TelemetryRecord[] = [];
  const promptSections: PromptSectionRecord[] = [];

  const store = {
    recordRateLimitEvent: mock(async (entry: RateLimitEventRecord) => {
      rateLimitEvents.push(entry);
    }),
    record: mock(async (entry: TelemetryRecord) => {
      records.push(entry);
    }),
    recordPromptSections: mock(async (entry: PromptSectionRecord) => {
      promptSections.push(entry);
    }),
    ...overrides,
  } as unknown as TelemetryStore;

  return { store, rateLimitEvents, records, promptSections };
}

describe("recordReviewExecutionTelemetry", () => {
  test("records derived-prompt reuse, execution, and prompt-section telemetry", async () => {
    const promptSection = makePromptSection();
    const { store, rateLimitEvents, records, promptSections } = makeTelemetryStore();
    const logger = { warn: mock(() => {}) };

    const result = await recordReviewExecutionTelemetry({
      telemetryStore: store,
      logger,
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 42,
      prAuthor: "alice",
      eventType: "pull_request.opened",
      result: makeResult(),
      promptSections: [promptSection],
      derivedPromptCacheStatus: "hit",
      derivedPromptCacheReason: "safe-reuse",
      warningPrefix: "Review",
    });

    expect(rateLimitEvents).toEqual([{
      deliveryId: "delivery-1",
      executionIdentity: "delivery-1:reuse.review-derived-prompt",
      repo: "xbmc/xbmc",
      prNumber: 42,
      eventType: "reuse.review-derived-prompt",
      cacheHitRate: 1,
      skippedQueries: 1,
      retryAttempts: 0,
      degradationPath: "hit:safe-reuse",
    }]);
    expect(records).toEqual([{
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 42,
      prAuthor: "alice",
      eventType: "pull_request.opened",
      model: "claude-sonnet",
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 10,
      cacheCreationTokens: 2,
      durationMs: 1234,
      costUsd: 0.42,
      conclusion: "success",
      sessionId: "session-1",
      numTurns: 3,
      stopReason: "end_turn",
    }]);
    expect(promptSections).toEqual([promptSection]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      value: {
        reuseTelemetry: "recorded",
        executionTelemetry: "recorded",
        promptSections: "recorded",
      },
    });
  });

  test("records timeout_partial conclusion and keeps telemetry failures non-blocking", async () => {
    const logger = { warn: mock(() => {}) };
    const store = {
      recordRateLimitEvent: mock(async () => {
        throw new Error("rate-limit unavailable");
      }),
      record: mock(async () => {
        throw new Error("record unavailable");
      }),
      recordPromptSections: mock(async () => {
        throw new Error("prompt unavailable");
      }),
    } as unknown as TelemetryStore;

    const result = await recordReviewExecutionTelemetry({
      telemetryStore: store,
      logger,
      deliveryId: "retry-1",
      repo: "xbmc/xbmc",
      prNumber: 42,
      prAuthor: "alice",
      eventType: "pull_request.review-retry",
      result: makeResult({ isTimeout: true, published: true }),
      promptSections: [makePromptSection("retry-1")],
      derivedPromptCacheStatus: "miss",
      warningPrefix: "Retry",
    });

    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: "retry-1",
      eventType: "pull_request.review-retry",
      conclusion: "timeout_partial",
    }));
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ err: expect.any(Error) }),
      "Retry derived-prompt reuse telemetry write failed (non-blocking)",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ err: expect.any(Error) }),
      "Retry telemetry write failed (non-blocking)",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ err: expect.any(Error) }),
      "Retry prompt-section telemetry write failed (non-blocking)",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBeInstanceOf(ReviewExecutionTelemetryError);
      expect(result.err.failures.map((failure) => failure.stage)).toEqual([
        "reuseTelemetry",
        "executionTelemetry",
        "promptSections",
      ]);
      expect(result.err.message).toContain("3 review telemetry writes failed");
    }
  });

  test("reports prompt-section telemetry as skipped when no prompt sections are provided", async () => {
    const { store } = makeTelemetryStore();
    const logger = { warn: mock(() => {}) };

    const result = await recordReviewExecutionTelemetry({
      telemetryStore: store,
      logger,
      deliveryId: "delivery-3",
      repo: "xbmc/xbmc",
      prNumber: 42,
      prAuthor: "alice",
      eventType: "pull_request.synchronize",
      result: makeResult(),
      derivedPromptCacheStatus: "bypass",
      warningPrefix: "Review",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        reuseTelemetry: "recorded",
        executionTelemetry: "recorded",
        promptSections: "skipped",
      },
    });
    expect(store.recordPromptSections).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
