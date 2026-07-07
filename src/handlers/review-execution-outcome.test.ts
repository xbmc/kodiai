import { describe, expect, test } from "bun:test";
import { resolveReviewExecutionOutcomeContext } from "./review-execution-outcome.ts";

describe("resolveReviewExecutionOutcomeContext", () => {
  test("classifies max-turn failures as turn-budget exhaustion with timeout fallback details", () => {
    const context = resolveReviewExecutionOutcomeContext({
      result: {
        conclusion: "failure",
        stopReason: "max_turns",
        failureSubtype: undefined,
        isTimeout: false,
        published: false,
        errorMessage: "ran out of steps",
      },
      totalTimeoutSeconds: 900,
      defaultTimeoutSeconds: 600,
      timeoutComplexityReasoning: "large-pr",
    });

    expect(context).toEqual({
      exhaustedTurnBudget: true,
      shouldHandleErrorOrTurnLimit: true,
      category: "timeout",
      timeoutDuration: 900,
      complexityInfo: "large-pr",
    });
  });

  test("classifies execution errors with fallback timeout defaults", () => {
    const context = resolveReviewExecutionOutcomeContext({
      result: {
        conclusion: "error",
        stopReason: "error",
        failureSubtype: undefined,
        isTimeout: false,
        published: false,
        errorMessage: "GitHub API rate limit",
      },
      totalTimeoutSeconds: undefined,
      defaultTimeoutSeconds: 600,
      timeoutComplexityReasoning: undefined,
    });

    expect(context.exhaustedTurnBudget).toBe(false);
    expect(context.shouldHandleErrorOrTurnLimit).toBe(true);
    expect(context.category).toBe("api_error");
    expect(context.timeoutDuration).toBe(600);
    expect(context.complexityInfo).toBe("unknown");
  });

  test("does not prepare fallback details for ordinary unpublished failures", () => {
    const context = resolveReviewExecutionOutcomeContext({
      result: {
        conclusion: "failure",
        stopReason: "model_refusal",
        failureSubtype: undefined,
        isTimeout: false,
        published: false,
        errorMessage: "model refused",
      },
      totalTimeoutSeconds: undefined,
      defaultTimeoutSeconds: 600,
      timeoutComplexityReasoning: "low-risk",
    });

    expect(context).toEqual({
      exhaustedTurnBudget: false,
      shouldHandleErrorOrTurnLimit: false,
      category: undefined,
      timeoutDuration: undefined,
      complexityInfo: undefined,
    });
  });
});
