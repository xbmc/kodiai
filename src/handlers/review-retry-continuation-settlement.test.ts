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
    retryResult: { conclusion: "success", isTimeout: false, published: false },
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
      value: { status: "quiet-settled", published: false, reason: "no-retry-results" },
    });
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
