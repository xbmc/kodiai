import { describe, expect, mock, test } from "bun:test";
import type { ExecutionResult } from "../execution/types.ts";
import type { PromptSectionRecord, RateLimitEventRecord, TelemetryRecord, TelemetryStore } from "../telemetry/types.ts";
import { recordMentionExecutionTelemetry } from "./mention-telemetry.ts";

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    conclusion: "success",
    costUsd: 0.17,
    numTurns: 2,
    durationMs: 987,
    sessionId: "mention-session",
    published: false,
    errorMessage: undefined,
    model: "claude-haiku",
    inputTokens: 50,
    outputTokens: 12,
    cacheReadTokens: 3,
    cacheCreationTokens: 1,
    stopReason: "end_turn",
    ...overrides,
  };
}

function makePromptSection(deliveryId = "delivery-1"): PromptSectionRecord {
  return {
    deliveryId,
    repo: "xbmc/xbmc",
    taskType: "mention.response",
    promptKind: "user",
    sections: [{
      sectionName: "mention-context",
      sectionPosition: 1,
      charCount: 88,
      estimatedTokens: 22,
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

describe("recordMentionExecutionTelemetry", () => {
  test("records derived-context reuse, execution, and prompt-section telemetry", async () => {
    const promptSection = makePromptSection();
    const { store, rateLimitEvents, records, promptSections } = makeTelemetryStore();
    const logger = { warn: mock(() => {}) };

    await recordMentionExecutionTelemetry({
      telemetryStore: store,
      logger,
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 77,
      eventType: "issue_comment.created",
      result: makeResult(),
      promptSections: [promptSection],
      derivedContextCacheStatus: "hit",
      derivedContextCacheReason: "safe-reuse",
    });

    expect(rateLimitEvents).toEqual([{
      deliveryId: "delivery-1",
      executionIdentity: "delivery-1:reuse.mention-derived-context",
      repo: "xbmc/xbmc",
      prNumber: 77,
      eventType: "reuse.mention-derived-context",
      cacheHitRate: 1,
      skippedQueries: 1,
      retryAttempts: 0,
      degradationPath: "hit:safe-reuse",
    }]);
    expect(records).toEqual([{
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      prNumber: 77,
      eventType: "issue_comment.created",
      model: "claude-haiku",
      inputTokens: 50,
      outputTokens: 12,
      cacheReadTokens: 3,
      cacheCreationTokens: 1,
      durationMs: 987,
      costUsd: 0.17,
      conclusion: "success",
      sessionId: "mention-session",
      numTurns: 2,
      stopReason: "end_turn",
    }]);
    expect(promptSections).toEqual([promptSection]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("normalizes trailing event dots and keeps telemetry failures non-blocking", async () => {
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

    await recordMentionExecutionTelemetry({
      telemetryStore: store,
      logger,
      deliveryId: "delivery-2",
      repo: "xbmc/xbmc",
      eventType: "pull_request_review_comment.",
      result: makeResult({ conclusion: "failure" }),
      promptSections: [makePromptSection("delivery-2")],
      derivedContextCacheStatus: "miss",
    });

    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: "delivery-2",
      eventType: "pull_request_review_comment",
      conclusion: "failure",
    }));
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ err: expect.any(Error) }),
      "Mention reuse telemetry write failed (non-blocking)",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ err: expect.any(Error) }),
      "Telemetry write failed (non-blocking)",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ err: expect.any(Error) }),
      "Prompt-section telemetry write failed (non-blocking)",
    );
  });
});
