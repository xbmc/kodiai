import { describe, expect, test } from "bun:test";
import { publishStandaloneReviewDetailsFallback } from "./review-details-standalone-fallback.ts";

type TestState = {
  completedLogs: Array<Record<string, unknown>>;
  phases: string[];
  canPublishCalls: string[];
};

type TestParams = Parameters<typeof publishStandaloneReviewDetailsFallback>[0] & {
  testState: TestState;
};

function makeParams(
  overrides: Partial<Parameters<typeof publishStandaloneReviewDetailsFallback>[0]> = {},
): TestParams {
  const completedLogs: Array<Record<string, unknown>> = [];
  const phases: string[] = [];
  const canPublishCalls: string[] = [];

  return {
    octokit: {} as never,
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    reviewOutputKey: "review-key",
    fullDetailsBody: "details-initial",
    botHandles: ["kodiai", "claude"],
    canPublishVisibleOutput: (reason: string) => {
      canPublishCalls.push(reason);
      return true;
    },
    setReviewWorkPhase: (phase: "publish") => phases.push(phase),
    renderReviewDetailsBody: () => "details-final",
    finalizePublicationPhaseTiming: () => phases.push("finalize"),
    logReviewDetailsPublicationCompleted: (entry) => completedLogs.push(entry),
    upsertDegradedReviewDetailsFallbackCommentFn: async () => ({
      ok: true,
      value: { published: true, commentId: 901 },
    }),
    updateFinalizedReviewDetailsCommentFn: async () => ({
      ok: true,
      value: { commentId: 901 },
    }),
    ...overrides,
    testState: {
      completedLogs,
      phases,
      canPublishCalls,
    },
  } as TestParams;
}

describe("publishStandaloneReviewDetailsFallback", () => {
  test("publishes degraded fallback details and refreshes finalized timing", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const updateCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      upsertDegradedReviewDetailsFallbackCommentFn: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return { ok: true, value: { published: true, commentId: 901 } };
      },
      updateFinalizedReviewDetailsCommentFn: async (input) => {
        updateCalls.push(input as Record<string, unknown>);
        return { ok: true, value: { commentId: 901 } };
      },
    });

    const result = await publishStandaloneReviewDetailsFallback(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "degraded-fallback", published: true },
    });

    const state = params.testState;
    expect(upsertCalls).toHaveLength(1);
    const [upsertCall] = upsertCalls as [Record<string, unknown>];
    expect(upsertCall.body).toBe("details-initial");
    expect(updateCalls).toHaveLength(1);
    const [updateCall] = updateCalls as [Record<string, unknown>];
    expect(updateCall.commentId).toBe(901);
    expect(updateCall.body).toBe("details-final");
    expect(state.phases).toEqual(["publish", "finalize"]);
    expect(state.completedLogs).toEqual([
      {
        surfaceKind: "issue_comment",
        commentId: 901,
        publicationMode: "degraded-fallback",
      },
    ]);
    expect(state.canPublishCalls).toEqual([
      "degraded Review Details fallback comment",
      "finalized Review Details timing update",
    ]);
  });

  test("does not publish when fallback publish rights are unavailable", async () => {
    let upsertCalled = false;
    let updateCalled = false;
    const params = makeParams({
      canPublishVisibleOutput: () => false,
      upsertDegradedReviewDetailsFallbackCommentFn: async () => {
        upsertCalled = true;
        return { ok: true, value: { published: true, commentId: 901 } };
      },
      updateFinalizedReviewDetailsCommentFn: async () => {
        updateCalled = true;
        return { ok: true, value: { commentId: 901 } };
      },
    });

    const result = await publishStandaloneReviewDetailsFallback(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "skipped", published: false },
    });

    const state = params.testState;
    expect(upsertCalled).toBe(false);
    expect(updateCalled).toBe(false);
    expect(state.phases).toEqual([]);
    expect(state.completedLogs).toEqual([]);
  });

  test("finalizes timing without refreshing when fallback returns no comment id", async () => {
    let updateCalled = false;
    const params = makeParams({
      upsertDegradedReviewDetailsFallbackCommentFn: async () => ({
        ok: true,
        value: { published: false, commentId: undefined },
      }),
      updateFinalizedReviewDetailsCommentFn: async () => {
        updateCalled = true;
        return { ok: true, value: { commentId: 901 } };
      },
    });

    const result = await publishStandaloneReviewDetailsFallback(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "degraded-fallback", published: false },
    });

    const state = params.testState;
    expect(updateCalled).toBe(false);
    expect(state.phases).toEqual(["publish", "finalize"]);
    expect(state.completedLogs).toEqual([]);
    expect(state.canPublishCalls).toEqual(["degraded Review Details fallback comment"]);
  });
});
