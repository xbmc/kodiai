import { describe, expect, test } from "bun:test";
import { publishRetryMergeContinuationResults } from "./review-retry-merge-publication.ts";

type TestState = {
  infoLogs: Array<{ data: Record<string, unknown>; message: string }>;
  warnLogs: Array<{ data: Record<string, unknown>; message: string }>;
  persistedStates: unknown[];
  publishPhases: number;
};

type TestParams = Parameters<typeof publishRetryMergeContinuationResults>[0] & {
  testState: TestState;
};

function makeParams(
  overrides: Partial<Parameters<typeof publishRetryMergeContinuationResults>[0]> = {},
): TestParams {
  const infoLogs: Array<{ data: Record<string, unknown>; message: string }> = [];
  const warnLogs: Array<{ data: Record<string, unknown>; message: string }> = [];
  const persistedStates: unknown[] = [];
  let publishPhases = 0;

  return {
    getOctokit: async () => ({}) as never,
    getAppSlug: () => "kodiai",
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    attemptId: "attempt-1",
    deliveryId: "delivery-1",
    reviewOutputKey: "review-key",
    retryReviewOutputKey: "retry-key",
    retryConclusion: "success",
    partialCommentId: 321,
    settlementReason: "merged",
    mergeContext: {
      status: "publishable",
      body: "merged body",
      retryFilesReviewed: 3,
      reviewDetailsFirstPass: null,
    },
    knowledgeStore: {
      getCheckpoint: async () => null,
    } as never,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: {
      info: (data: Record<string, unknown>, message: string) => infoLogs.push({ data, message }),
      warn: (data: Record<string, unknown>, message: string) => warnLogs.push({ data, message }),
    } as never,
    canPublishReviewWorkOutput: () => true,
    setPublishPhase: () => {
      publishPhases += 1;
    },
    renderReviewDetailsBody: () => "details body",
    settleRetryWithoutCanonicalUpdate: async () => undefined,
    persistContinuationFamilyState: async (state) => {
      persistedStates.push(state);
    },
    ...overrides,
    testState: {
      infoLogs,
      warnLogs,
      persistedStates,
      get publishPhases() {
        return publishPhases;
      },
    },
  } as TestParams;
}

describe("publishRetryMergeContinuationResults", () => {
  test("returns skipped Result when retry publication rights are unavailable", async () => {
    const params = makeParams({
      canPublishReviewWorkOutput: () => false,
    });

    const result = await publishRetryMergeContinuationResults(params);

    expect(result).toEqual({
      ok: true,
      value: { status: "skipped", published: false },
    });
    expect(params.testState.publishPhases).toBe(0);
    expect(params.testState.persistedStates).toEqual([]);
    expect(params.testState.infoLogs).toEqual([]);
    expect(params.testState.warnLogs).toEqual([]);
  });

  test("returns published Result after persisting merged continuation state", async () => {
    const params = makeParams({
      publishRetryReviewDetailsMergeFn: async () => ({
        ok: true,
        value: {
          status: "published",
          projectionStatus: "canonical",
          logMessage: "Retry complete -- published final review comment with merged results",
        },
      }),
    });

    const result = await publishRetryMergeContinuationResults(params);

    expect(result).toEqual({
      ok: true,
      value: { status: "published", published: true, projectionStatus: "canonical" },
    });
    expect(params.testState.publishPhases).toBe(1);
    expect(params.testState.persistedStates).toEqual([
      {
        authoritativeAttemptId: "attempt-1",
        authoritativeOutcome: "merged",
        finalStopReason: "merged-continuation-results",
        projectionStatus: "canonical",
        reviewOutputKey: "retry-key",
      },
    ]);
    expect(params.testState.infoLogs).toHaveLength(1);
    expect(params.testState.warnLogs).toEqual([]);
  });
});
