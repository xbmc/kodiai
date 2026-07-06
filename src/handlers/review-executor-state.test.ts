import { describe, expect, test } from "bun:test";
import type { ExecutionResult } from "../execution/types.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import { projectReviewExecutorState } from "./review-executor-state.ts";

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    conclusion: "success",
    costUsd: undefined,
    numTurns: undefined,
    durationMs: undefined,
    sessionId: undefined,
    published: false,
    errorMessage: undefined,
    model: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    cacheReadTokens: undefined,
    cacheCreationTokens: undefined,
    stopReason: undefined,
    ...overrides,
  };
}

function makePromptSectionRecord(promptKind: string): PromptSectionRecord {
  return {
    deliveryId: "delivery-1",
    repo: "xbmc/xbmc",
    taskType: "review.full",
    promptKind,
    sections: [{
      sectionName: "changed-files",
      sectionPosition: 1,
      charCount: 480,
      estimatedTokens: 120,
      budgetChars: 1000,
      budgetTokens: 250,
      includedChars: 480,
      includedTokens: 120,
      trimmedChars: 0,
      trimmedTokens: 0,
      budgetStatus: "included",
      budgetReason: "within-budget",
    }],
  };
}

describe("projectReviewExecutorState", () => {
  test("uses executor prompt sections and phase timings when present", () => {
    const promptSections: PromptSectionRecord[] = [
      makePromptSectionRecord("review.executor"),
    ];
    const executorPhaseTimings = [
      { name: "executor handoff" as const, status: "completed" as const, durationMs: 12 },
      { name: "remote runtime" as const, status: "completed" as const, durationMs: 34 },
    ];
    const result = makeExecutionResult({
      published: true,
      promptSections,
      executorPhaseTimings,
    });

    const projection = projectReviewExecutorState({
      result,
      currentPromptSectionRecords: [makePromptSectionRecord("review.old")],
    });

    expect(projection.executorResult).toBe(result);
    expect(projection.reviewExecutorPublished).toBe(true);
    expect(projection.reviewOutputPublished).toBe(true);
    expect(projection.reviewPublishResolution).toBe("executor");
    expect(projection.promptSectionRecords).toBe(promptSections);
    expect(projection.executorPhaseTimings).toEqual(executorPhaseTimings);
  });

  test("keeps existing prompt sections and unavailable timings when executor omits them", () => {
    const currentPromptSectionRecords: PromptSectionRecord[] = [
      makePromptSectionRecord("review.existing"),
    ];
    const result = makeExecutionResult({ published: false });

    const projection = projectReviewExecutorState({
      result,
      currentPromptSectionRecords,
    });

    expect(projection.reviewExecutorPublished).toBe(false);
    expect(projection.reviewOutputPublished).toBe(false);
    expect(projection.reviewPublishResolution).toBe("none");
    expect(projection.promptSectionRecords).toBe(currentPromptSectionRecords);
    expect(projection.executorPhaseTimings).toEqual([
      {
        name: "executor handoff",
        status: "unavailable",
        detail: "executor phase timings unavailable",
      },
      {
        name: "remote runtime",
        status: "unavailable",
        detail: "executor phase timings unavailable",
      },
    ]);
  });
});
