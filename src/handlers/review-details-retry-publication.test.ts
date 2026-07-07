import { describe, expect, test } from "bun:test";
import { publishRetryReviewDetailsMerge } from "./review-details-retry-publication.ts";

type TestState = {
  warnings: Array<{ data: Record<string, unknown>; message: string }>;
  canPublishCalls: string[];
  renderCalls: unknown[];
  settlements: Array<Record<string, unknown>>;
};

type TestParams = Parameters<typeof publishRetryReviewDetailsMerge>[0] & {
  testState: TestState;
};

function makeParams(
  overrides: Partial<Parameters<typeof publishRetryReviewDetailsMerge>[0]> = {},
): TestParams {
  const warnings: Array<{ data: Record<string, unknown>; message: string }> = [];
  const canPublishCalls: string[] = [];
  const renderCalls: unknown[] = [];
  const settlements: Array<Record<string, unknown>> = [];

  return {
    octokit: {} as never,
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    attemptId: "attempt-1",
    deliveryId: "retry-delivery-1",
    reviewOutputKey: "review-key",
    retryReviewOutputKey: "retry-key",
    commentIdToUpdate: 321,
    mergeBody: "merged body",
    reviewDetailsFirstPass: { state: "bounded", boundedReason: "timeout" } as never,
    botHandles: ["kodiai", "claude"],
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: {
      warn: (data: Record<string, unknown>, message: string) => warnings.push({ data, message }),
    },
    canPublishReviewWorkOutput: (_attemptId: string, reason: string, _deliveryId: string) => {
      canPublishCalls.push(reason);
      return true;
    },
    renderReviewDetailsBody: (runtime) => {
      renderCalls.push(runtime);
      return "details body";
    },
    settleRetryWithoutCanonicalUpdate: async (input) => {
      settlements.push(input as Record<string, unknown>);
    },
    upsertCanonicalReviewSurfaceFn: async () => ({
      kind: "issue_comment",
      commentId: 321,
      body: "merged body",
    }),
    publishDegradedReviewDetailsFallbackFailOpenFn: async () => ({
      ok: true,
      value: { delivery: "degraded-fallback", published: true },
    }),
    ...overrides,
    testState: {
      warnings,
      canPublishCalls,
      renderCalls,
      settlements,
    },
  } as TestParams;
}

describe("publishRetryReviewDetailsMerge", () => {
  test("merges retry Review Details into the canonical retry output", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      upsertCanonicalReviewSurfaceFn: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return { kind: "issue_comment", commentId: 321, body: "merged body" };
      },
    });

    const result = await publishRetryReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: {
        status: "published",
        projectionStatus: "canonical",
        logMessage: "Retry complete -- updated partial review comment with merged results",
      },
    });
    expect(upsertCalls).toHaveLength(1);
    const [upsertCall] = upsertCalls as [Record<string, unknown>];
    expect(upsertCall).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 195,
      reviewOutputKey: "review-key",
      preferredKind: "issue_comment",
      canonicalSurface: { kind: "issue_comment", commentId: 321, body: "merged body" },
      summaryBody: "merged body",
      reviewDetailsBlock: "details body",
      botHandles: ["kodiai", "claude"],
      requireDegradationDisclosure: false,
      reviewBoundedness: null,
    });
    const recheckCanPublish = upsertCall.recheckCanPublish as () => boolean;
    expect(recheckCanPublish()).toBe(true);
    expect(params.testState.canPublishCalls).toEqual(["retry canonical Review Details merge"]);
    expect(params.testState.renderCalls).toEqual([{ reviewFirstPass: params.reviewDetailsFirstPass }]);
    expect(params.testState.settlements).toEqual([]);
    expect(params.testState.warnings).toEqual([]);
  });

  test("settles retry without canonical update when publication is superseded", async () => {
    const params = makeParams({
      commentIdToUpdate: undefined,
      upsertCanonicalReviewSurfaceFn: async () => undefined,
    });

    const result = await publishRetryReviewDetailsMerge(params);

    expect(result).toEqual({ ok: true, value: { status: "settled-without-canonical-update" } });
    expect(params.testState.settlements).toEqual([
      {
        attemptId: "attempt-1",
        reviewOutputKey: "retry-key",
        deliveryId: "retry-delivery-1",
        reason: "publish-superseded",
        logMessage: "Retry settlement skipped because publish rights were superseded",
      },
    ]);
  });

  test("falls back to degraded details publication when canonical retry merge fails", async () => {
    const error = new Error("canonical failed");
    const fallbackCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      commentIdToUpdate: undefined,
      upsertCanonicalReviewSurfaceFn: async () => {
        throw error;
      },
      publishDegradedReviewDetailsFallbackFailOpenFn: async (input) => {
        fallbackCalls.push(input as Record<string, unknown>);
        return {
          ok: true,
          value: { delivery: "degraded-fallback", published: true },
        };
      },
    });

    const result = await publishRetryReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: {
        status: "published",
        projectionStatus: "degraded",
        logMessage: "Retry complete -- published final review comment with merged results; Review Details published via degraded fallback comment",
      },
    });
    expect(params.testState.warnings).toHaveLength(1);
    const [warning] = params.testState.warnings as [{ data: Record<string, unknown>; message: string }];
    expect(warning.message).toBe(
      "Failed to update retry canonical review surface with Review Details; using degraded fallback comment",
    );
    expect(warning.data).toMatchObject({
      deliveryId: "delivery-1",
      gate: "review-details-output",
      gateResult: "degraded-fallback",
      reviewOutputKey: "review-key",
      err: error,
    });
    expect(fallbackCalls).toHaveLength(1);
    const [fallbackCall] = fallbackCalls as [Record<string, unknown>];
    expect(fallbackCall.publishReason).toBe("retry degraded Review Details fallback comment");
    expect(fallbackCall.failureMessage).toBe("Failed to publish degraded Review Details fallback comment after retry merge");
    const renderBody = fallbackCall.renderBody as () => string;
    expect(renderBody()).toBe("details body");
  });
});
