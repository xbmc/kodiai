import { describe, expect, test } from "bun:test";
import { publishDegradedReviewDetailsFallbackFailOpen } from "./review-details-degraded-fallback.ts";

type TestState = {
  warnings: Array<{ data: Record<string, unknown>; message: string }>;
  canPublishCalls: string[];
};

type TestParams = Parameters<typeof publishDegradedReviewDetailsFallbackFailOpen>[0] & {
  testState: TestState;
};

function makeParams(
  overrides: Partial<Parameters<typeof publishDegradedReviewDetailsFallbackFailOpen>[0]> = {},
): TestParams {
  const warnings: Array<{ data: Record<string, unknown>; message: string }> = [];
  const canPublishCalls: string[] = [];

  return {
    octokit: {} as never,
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    reviewOutputKey: "review-key",
    renderBody: () => "details-body",
    botHandles: ["kodiai", "claude"],
    publishReason: "timeout degraded Review Details fallback comment",
    failureMessage: "Failed to publish degraded Review Details fallback comment",
    baseLog: { deliveryId: "delivery-1" },
    logger: {
      warn: (data: Record<string, unknown>, message: string) => warnings.push({ data, message }),
    },
    canPublishVisibleOutput: (reason: string) => {
      canPublishCalls.push(reason);
      return true;
    },
    upsertDegradedReviewDetailsFallbackCommentFn: async () => ({
      ok: true,
      value: { published: true, commentId: 901 },
    }),
    ...overrides,
    testState: {
      warnings,
      canPublishCalls,
    },
  } as TestParams;
}

describe("publishDegradedReviewDetailsFallbackFailOpen", () => {
  test("publishes degraded details fallback with a rechecked publish gate", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      upsertDegradedReviewDetailsFallbackCommentFn: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return { ok: true, value: { published: true, commentId: 901 } };
      },
    });

    const result = await publishDegradedReviewDetailsFallbackFailOpen(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "degraded-fallback", published: true },
    });
    expect(upsertCalls).toHaveLength(1);
    const [upsertCall] = upsertCalls as [Record<string, unknown>];
    expect(upsertCall.body).toBe("details-body");
    expect(upsertCall.reviewOutputKey).toBe("review-key");
    const recheckCanPublish = upsertCall.recheckCanPublish as () => boolean;
    expect(recheckCanPublish()).toBe(true);
    expect(params.testState.canPublishCalls).toEqual([
      "timeout degraded Review Details fallback comment",
      "timeout degraded Review Details fallback comment",
    ]);
    expect(params.testState.warnings).toEqual([]);
  });

  test("skips fallback publication when publish rights are unavailable", async () => {
    let renderBodyCalled = false;
    let upsertCalled = false;
    const params = makeParams({
      canPublishVisibleOutput: () => false,
      renderBody: () => {
        renderBodyCalled = true;
        return "details-body";
      },
      upsertDegradedReviewDetailsFallbackCommentFn: async () => {
        upsertCalled = true;
        return { ok: true, value: { published: true, commentId: 901 } };
      },
    });

    const result = await publishDegradedReviewDetailsFallbackFailOpen(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "skipped", published: false },
    });
    expect(renderBodyCalled).toBe(false);
    expect(upsertCalled).toBe(false);
    expect(params.testState.warnings).toEqual([]);
  });

  test("logs fallback publication failures without throwing", async () => {
    const error = new Error("publish failed");
    const params = makeParams({
      upsertDegradedReviewDetailsFallbackCommentFn: async () => ({
        ok: false,
        err: { published: false, error },
      }),
    });

    const result = await publishDegradedReviewDetailsFallbackFailOpen(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "degraded-fallback", published: false },
    });
    expect(params.testState.warnings).toHaveLength(1);
    const [warning] = params.testState.warnings as [{ data: Record<string, unknown>; message: string }];
    expect(warning.message).toBe("Failed to publish degraded Review Details fallback comment");
    expect(warning.data).toMatchObject({
      deliveryId: "delivery-1",
      gate: "review-details-output",
      gateResult: "failed",
      reviewOutputKey: "review-key",
      err: error,
    });
  });
});
