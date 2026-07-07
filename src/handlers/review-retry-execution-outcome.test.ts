import { describe, expect, test } from "bun:test";
import type { ExecutionResult } from "../execution/types.ts";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import { resolveReviewRetryExecutionOutcome } from "./review-retry-execution-outcome.ts";

function createExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    conclusion: "failure",
    costUsd: undefined,
    numTurns: undefined,
    durationMs: undefined,
    sessionId: undefined,
    published: false,
    errorMessage: undefined,
    isTimeout: false,
    model: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    cacheReadTokens: undefined,
    cacheCreationTokens: undefined,
    stopReason: undefined,
    ...overrides,
  };
}

function createCheckpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "retry-key",
    repo: "acme/widget",
    prNumber: 42,
    filesReviewed: [],
    filesInspected: [],
    findingCount: 0,
    summaryDraft: "Partial summary",
    totalFiles: 10,
    ...overrides,
  };
}

function createPromptSectionRecord(): PromptSectionRecord {
  return {
    deliveryId: "retry-delivery",
    repo: "acme/widget",
    taskType: "review.full",
    promptKind: "review.user-prompt",
    sections: [],
  };
}

function createBaseParams(
  overrides: Partial<Parameters<typeof resolveReviewRetryExecutionOutcome>[0]> = {},
): Parameters<typeof resolveReviewRetryExecutionOutcome>[0] {
  const params: Parameters<typeof resolveReviewRetryExecutionOutcome>[0] = {
    telemetryEnabled: false,
    telemetryStore: {} as never,
    logger: {
      warn: () => undefined,
    } as never,
    retryDeliveryId: "retry-delivery",
    parentDeliveryId: "parent-delivery",
    repo: "acme/widget",
    prNumber: 42,
    prAuthor: "mona",
    retryReviewOutputKey: "retry-key",
    retryResult: createExecutionResult(),
    retryPromptSections: [createPromptSectionRecord()],
    retryReviewPromptDerivedCacheStatus: "miss",
    retryReviewPromptDerivedCacheReason: undefined,
    retryFilesCount: 3,
    retryScopeRatio: 0.3,
    retryTimeoutSeconds: 120,
    retryRiskLevel: "medium",
    retryCheckpointEnabled: true,
    partialCommentId: 123,
    timeoutTotalFiles: 10,
    getCheckpoint: async () => null,
  };

  return { ...params, ...overrides };
}

describe("resolveReviewRetryExecutionOutcome", () => {
  test("classifies failed retry with no checkpoint progress as no-results retry failure", async () => {
    const outcome = await resolveReviewRetryExecutionOutcome(createBaseParams());

    expect(outcome.retryCheckpoint).toBeNull();
    expect(outcome.retryHasStructuredProgress).toBe(false);
    expect(outcome.retryHasResults).toBe(false);
    expect(outcome.retryTimeoutClassification.mode).toBe("retry-failed");
    expect(outcome.retryTimeoutClassification.reasonCodes).toContain("retry-failed");
  });

  test("treats checkpoint inspected files as structured retry progress", async () => {
    const checkpoint = createCheckpoint({
      filesInspected: ["src/a.ts"],
    });

    const outcome = await resolveReviewRetryExecutionOutcome(createBaseParams({
      getCheckpoint: async () => checkpoint,
    }));

    expect(outcome.retryCheckpoint).toBe(checkpoint);
    expect(outcome.retryHasStructuredProgress).toBe(true);
    expect(outcome.retryHasResults).toBe(true);
    expect(outcome.retryTimeoutClassification.mode).toBe("retry-completed");
    expect(outcome.retryTimeoutClassification.counts.checkpointFilesInspected).toBe(1);
  });

  test("records retry execution and resilience telemetry when enabled", async () => {
    const executionTelemetryCalls: unknown[] = [];
    const resilienceTelemetryCalls: unknown[] = [];
    const promptSectionCalls: PromptSectionRecord[] = [];
    const retryResult = createExecutionResult({
      isTimeout: true,
      published: true,
      conclusion: "error",
      promptSections: [createPromptSectionRecord()],
    });

    await resolveReviewRetryExecutionOutcome(createBaseParams({
      telemetryEnabled: true,
      telemetryStore: {
        recordRateLimitEvent: async (entry: unknown) => {
          executionTelemetryCalls.push({ kind: "rate-limit", entry });
        },
        record: async (entry: unknown) => {
          executionTelemetryCalls.push({ kind: "execution", entry });
        },
        recordPromptSections: async (entry: PromptSectionRecord) => {
          promptSectionCalls.push(entry);
        },
        recordResilienceEvent: async (entry: unknown) => {
          resilienceTelemetryCalls.push(entry);
        },
      } as never,
      retryResult,
      retryPromptSections: [createPromptSectionRecord()],
      getCheckpoint: async () => createCheckpoint({ filesReviewed: ["src/a.ts"], findingCount: 1 }),
    }));

    expect(executionTelemetryCalls).toHaveLength(2);
    expect(promptSectionCalls).toHaveLength(1);
    expect(resilienceTelemetryCalls).toHaveLength(1);
    expect(resilienceTelemetryCalls[0]).toEqual(expect.objectContaining({
      deliveryId: "retry-delivery",
      parentDeliveryId: "parent-delivery",
      kind: "retry",
      executionConclusion: "timeout_partial",
      retryHasResults: true,
      timeoutClassificationMode: "retry-completed",
    }));
  });
});
