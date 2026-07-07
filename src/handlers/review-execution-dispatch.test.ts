import { describe, expect, test } from "bun:test";
import type { ExecutionContext, ExecutionResult, ExecutorPhaseTiming } from "../execution/types.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import { dispatchInitialReviewExecution } from "./review-execution-dispatch.ts";

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
    repo: "xbmc/kodiai",
    taskType: "review.full",
    promptKind,
    sections: [],
  };
}

describe("dispatchInitialReviewExecution", () => {
  test("sets executor phase, executes review context, and applies executor state", async () => {
    const promptSections = [makePromptSectionRecord("review.prompt")];
    const executorPromptSections = [makePromptSectionRecord("review.executor")];
    const executorPhaseTimings: ExecutorPhaseTiming[] = [
      { name: "executor handoff", status: "completed", durationMs: 12 },
    ];
    const executionResult = makeExecutionResult({
      published: true,
      promptSections: executorPromptSections,
      executorPhaseTimings,
    });
    const executeCalls: ExecutionContext[] = [];
    const phases: string[] = [];
    const publicationState: {
      executorResult?: ExecutionResult;
      reviewExecutorPublished: boolean;
      reviewOutputPublished: boolean;
      reviewPublishResolution: string;
    } = {
      reviewExecutorPublished: false,
      reviewOutputPublished: false,
      reviewPublishResolution: "none",
    };
    const visibleBudgetState = {
      promptSectionRecords: promptSections,
      refreshCount: 0,
      refresh() {
        this.refreshCount += 1;
      },
    };
    const timingState: {
      executorPhaseTimings: ExecutorPhaseTiming[];
      publicationPhaseStartedAt?: number;
    } = {
      executorPhaseTimings: [],
    };
    const reviewPhaseTimings = new Map();

    const result = await dispatchInitialReviewExecution({
      executor: {
        execute: async (context) => {
          executeCalls.push(context);
          return executionResult;
        },
      },
      executionContext: {
        workspace: { dir: "/tmp/review", cleanup: async () => undefined },
        installationId: 123,
        owner: "xbmc",
        repo: "kodiai",
        prNumber: 42,
        appSlug: "kodiai",
        action: "opened",
        taskType: "review.full",
        reviewPrompt: "review prompt",
        reviewPromptSections: promptSections,
        reviewOutputKey: "review-output-key",
        deliveryId: "delivery-1",
        candidateVerificationContext: undefined,
        knowledgeStore: undefined,
        changedFileCount: 3,
        checkpointEnabled: true,
        prDiffCommentabilityIndex: undefined,
        appliedTimeoutBudget: { totalTimeoutSeconds: 900 },
        reviewMaxTurnsOverride: 24,
      },
      currentPromptSectionRecords: visibleBudgetState.promptSectionRecords,
      publicationState,
      visibleBudgetState,
      timingState,
      reviewPhaseTimings,
      recordExecutorPhaseTimings: (target, timings) => {
        for (const timing of timings) target.set(timing.name, timing);
      },
      setReviewWorkPhase: (phase) => phases.push(phase),
      now: () => 12345,
    });

    expect(result.result).toBe(executionResult);
    expect(result.executorState.reviewOutputPublished).toBe(true);
    expect(phases).toEqual(["executor-dispatch"]);
    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]).toEqual(expect.objectContaining({
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      eventType: "pull_request.opened",
      prompt: "review prompt",
      promptSections,
      enableCheckpointTool: true,
      dynamicTimeoutSeconds: 900,
      maxTurnsOverride: 24,
    }));
    expect(publicationState).toEqual({
      executorResult: executionResult,
      reviewExecutorPublished: true,
      reviewOutputPublished: true,
      reviewPublishResolution: "executor",
    });
    expect(visibleBudgetState.promptSectionRecords).toBe(executorPromptSections);
    expect(visibleBudgetState.refreshCount).toBe(1);
    expect(timingState.executorPhaseTimings).toBe(executorPhaseTimings);
    expect(timingState.publicationPhaseStartedAt).toBe(12345);
    expect(reviewPhaseTimings.get("executor handoff")).toEqual(executorPhaseTimings[0]);
  });
});
