import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import { settleRetryContinuationResults } from "./review-retry-continuation-settlement.ts";

type TestState = {
  infoLogs: Array<{ data: Record<string, unknown>; message: string }>;
  quietStates: unknown[];
};

type TestParams = Parameters<typeof settleRetryContinuationResults>[0] & {
  testState: TestState;
};

function checkpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "review-key",
    repo: "xbmc/kodiai",
    prNumber: 195,
    filesReviewed: ["src/a.ts"],
    findingCount: 1,
    summaryDraft: "partial summary",
    totalFiles: 3,
    partialCommentId: 321,
    ...overrides,
  };
}

function makeParams(
  overrides: Partial<Parameters<typeof settleRetryContinuationResults>[0]> = {},
): TestParams {
  const infoLogs: Array<{ data: Record<string, unknown>; message: string }> = [];
  const quietStates: unknown[] = [];

  return {
    retryCompletedWithResults: false,
    getOctokit: async () => ({}) as never,
    getAppSlug: () => "kodiai",
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    attemptId: "attempt-1",
    deliveryId: "delivery-1",
    reviewOutputKey: "review-key",
    retryReviewOutputKey: "retry-key",
    retryResult: { conclusion: "success", isTimeout: false, published: false, errorMessage: undefined },
    firstPassOutcome: { conclusion: "failure", isTimeout: true },
    baseCheckpoint: checkpoint(),
    retryCheckpoint: checkpoint({
      reviewOutputKey: "retry-key",
      filesReviewed: ["src/b.ts"],
      summaryDraft: "retry summary",
    }),
    partialCommentId: 321,
    retryFilesCount: 1,
    timeoutDurationSeconds: 120,
    timeoutFirstPassBoundedReason: "timeout",
    knowledgeStore: undefined,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: {
      info: (data: Record<string, unknown>, message: string) => infoLogs.push({ data, message }),
      warn: () => undefined,
      error: () => undefined,
    } as never,
    canPublishReviewWorkOutput: () => true,
    setPublishPhase: () => undefined,
    renderReviewDetailsBody: () => "details body",
    settleRetryWithoutCanonicalUpdate: async () => undefined,
    persistContinuationFamilyState: async (state) => {
      quietStates.push(state);
    },
    ...overrides,
    testState: {
      infoLogs,
      quietStates,
    },
  } as TestParams;
}

describe("settleRetryContinuationResults", () => {
  test("returns quiet-settled Result when retry completed without results", async () => {
    const params = makeParams();

    const result = await settleRetryContinuationResults(params);

    expect(result).toEqual({
      ok: true,
      value: {
        status: "quiet-settled",
        published: false,
        persistedContinuationState: false,
        discardedCheckpoints: false,
        reason: "no-retry-results",
      },
    });
  });

  test("posts a turn-limit fallback comment when retry fails and nothing has been published yet", async () => {
    const fallbackCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      partialCommentId: undefined,
      retryResult: {
        conclusion: "failure",
        isTimeout: false,
        published: false,
        stopReason: "max_turns",
        errorMessage: undefined,
      },
      firstPassOutcome: { conclusion: "failure", isTimeout: false, stopReason: "max_turns" },
      publishReviewExecutionErrorFallbackFn: async (callParams) => {
        fallbackCalls.push(callParams as unknown as Record<string, unknown>);
        return {
          ok: true,
          value: { published: true, resolution: "turn-limit-fallback", fallbackDelivery: "created" },
        };
      },
    });

    const result = await settleRetryContinuationResults(params);

    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0]?.exhaustedTurnBudget).toBe(true);
    expect(fallbackCalls[0]?.retryScheduled).toBe(false);
    expect(result).toEqual({
      ok: true,
      value: {
        status: "quiet-settled",
        published: true,
        persistedContinuationState: false,
        discardedCheckpoints: false,
        reason: "no-retry-results",
      },
    });
  });

  test("does not post a fallback comment when the original review already published a partial review", async () => {
    const fallbackCalls: unknown[] = [];
    const params = makeParams({
      partialCommentId: 321,
      publishReviewExecutionErrorFallbackFn: async () => {
        fallbackCalls.push(true);
        return { ok: true, value: { published: true, resolution: "turn-limit-fallback", fallbackDelivery: "created" } };
      },
    });

    await settleRetryContinuationResults(params);

    expect(fallbackCalls).toHaveLength(0);
  });

  test("posts a turn-limit fallback when retry completed with results but settles to a non-merge decision with nothing published", async () => {
    const fallbackCalls: unknown[] = [];
    const params = makeParams({
      retryCompletedWithResults: true,
      partialCommentId: undefined,
      retryResult: { conclusion: "success", isTimeout: false, published: false, stopReason: undefined, failureSubtype: undefined, errorMessage: undefined },
      retryCheckpoint: checkpoint({
        reviewOutputKey: "retry-key",
        filesReviewed: ["src/a.ts"],
        findingCount: 0,
        summaryDraft: "retry summary",
      }),
      publishReviewExecutionErrorFallbackFn: async () => {
        fallbackCalls.push(true);
        return { ok: true, value: { published: true, resolution: "turn-limit-fallback", fallbackDelivery: "created" } };
      },
    });

    const result = await settleRetryContinuationResults(params);

    expect(fallbackCalls).toHaveLength(1);
    expect(result.ok && result.value.published).toBe(true);
  });

  test("does not post a fallback when retry settles to a non-merge decision but inline findings were already published", async () => {
    const fallbackCalls: unknown[] = [];
    const params = makeParams({
      retryCompletedWithResults: true,
      partialCommentId: undefined,
      hasPublishedInlines: true,
      retryResult: { conclusion: "success", isTimeout: false, published: false, stopReason: undefined, failureSubtype: undefined, errorMessage: undefined },
      retryCheckpoint: checkpoint({
        reviewOutputKey: "retry-key",
        filesReviewed: ["src/a.ts"],
        findingCount: 0,
        summaryDraft: "retry summary",
      }),
      publishReviewExecutionErrorFallbackFn: async () => {
        fallbackCalls.push(true);
        return { ok: true, value: { published: true, resolution: "turn-limit-fallback", fallbackDelivery: "created" } };
      },
    });

    await settleRetryContinuationResults(params);

    expect(fallbackCalls).toHaveLength(0);
  });

  test("does not post a fallback when the retry itself already published inline findings", async () => {
    const fallbackCalls: unknown[] = [];
    const params = makeParams({
      retryCompletedWithResults: true,
      partialCommentId: undefined,
      retryResult: {
        conclusion: "success",
        isTimeout: false,
        published: true,
        stopReason: undefined,
        failureSubtype: undefined,
        errorMessage: undefined,
      },
      retryCheckpoint: null,
      publishReviewExecutionErrorFallbackFn: async () => {
        fallbackCalls.push(true);
        return { ok: true, value: { published: true, resolution: "turn-limit-fallback", fallbackDelivery: "created" } };
      },
    });

    await settleRetryContinuationResults(params);

    expect(fallbackCalls).toHaveLength(0);
  });

  test("returns merge publication Result when continuation is publishable", async () => {
    const params = makeParams({
      retryCompletedWithResults: true,
      publishRetryMergeContinuationResultsFn: async () => ({
        ok: true,
        value: { status: "published", published: true, projectionStatus: "canonical" },
      }),
    });

    const result = await settleRetryContinuationResults(params);

    expect(result).toEqual({
      ok: true,
      value: { status: "published", published: true, projectionStatus: "canonical" },
    });
  });
});
