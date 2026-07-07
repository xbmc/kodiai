import { describe, expect, test } from "bun:test";
import { publishTimeoutReviewDetailsMerge } from "./review-details-timeout-publication.ts";

type TestState = {
  warnings: Array<{ data: Record<string, unknown>; message: string }>;
  canPublishCalls: string[];
  renderCalls: unknown[];
};

type TestParams = Parameters<typeof publishTimeoutReviewDetailsMerge>[0] & {
  testState: TestState;
};

function makeParams(
  overrides: Partial<Parameters<typeof publishTimeoutReviewDetailsMerge>[0]> = {},
): TestParams {
  const warnings: Array<{ data: Record<string, unknown>; message: string }> = [];
  const canPublishCalls: string[] = [];
  const renderCalls: unknown[] = [];

  return {
    octokit: {} as never,
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    reviewOutputKey: "review-key",
    partialCommentId: 321,
    partialBody: "partial body",
    botHandles: ["kodiai", "claude"],
    timeoutReviewDetailsRuntime: {
      timeoutProgress: { analyzedFiles: 5, totalFiles: 8, findingCount: 2, retryState: "scheduled" },
      reviewFirstPass: { state: "bounded", boundedReason: "timeout", evidenceSource: "checkpoint" } as never,
      timeoutBudget: {
        remoteRuntimeBudgetSeconds: 120,
        infraOverheadBudgetSeconds: 30,
        totalTimeoutSeconds: 150,
      },
    },
    authorSearchEnrichmentDegraded: true,
    reviewBoundedness: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: {
      warn: (data: Record<string, unknown>, message: string) => warnings.push({ data, message }),
    },
    canPublishVisibleOutput: (reason: string) => {
      canPublishCalls.push(reason);
      return true;
    },
    renderReviewDetailsBody: (runtime) => {
      renderCalls.push(runtime);
      return "details body";
    },
    upsertCanonicalReviewSurfaceFn: async () => ({
      kind: "issue_comment",
      commentId: 321,
      body: "partial body",
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
    },
  } as TestParams;
}

describe("publishTimeoutReviewDetailsMerge", () => {
  test("merges timeout Review Details into the partial comment canonical surface", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      upsertCanonicalReviewSurfaceFn: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return undefined;
      },
    });

    const result = await publishTimeoutReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "canonical-merge", published: true },
    });

    expect(upsertCalls).toHaveLength(1);
    const [upsertCall] = upsertCalls as [Record<string, unknown>];
    expect(upsertCall).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 195,
      reviewOutputKey: "review-key",
      preferredKind: "issue_comment",
      canonicalSurface: { kind: "issue_comment", commentId: 321, body: "partial body" },
      summaryBody: "partial body",
      reviewDetailsBlock: "details body",
      botHandles: ["kodiai", "claude"],
      requireDegradationDisclosure: true,
      reviewBoundedness: null,
    });
    const recheckCanPublish = upsertCall.recheckCanPublish as () => boolean;
    expect(recheckCanPublish()).toBe(true);
    expect(params.testState.canPublishCalls).toEqual([
      "timeout canonical Review Details merge",
      "timeout canonical Review Details merge",
    ]);
    expect(params.testState.renderCalls).toEqual([params.timeoutReviewDetailsRuntime]);
    expect(params.testState.warnings).toEqual([]);
  });

  test("skips timeout details rendering when canonical publish rights are unavailable", async () => {
    let upsertCalled = false;
    let fallbackCalled = false;
    const params = makeParams({
      canPublishVisibleOutput: () => false,
      upsertCanonicalReviewSurfaceFn: async () => {
        upsertCalled = true;
        return undefined;
      },
      publishDegradedReviewDetailsFallbackFailOpenFn: async () => {
        fallbackCalled = true;
        return {
          ok: true,
          value: { delivery: "degraded-fallback", published: true },
        };
      },
    });

    const result = await publishTimeoutReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "skipped", published: false },
    });

    expect(upsertCalled).toBe(false);
    expect(fallbackCalled).toBe(false);
    expect(params.testState.renderCalls).toEqual([]);
    expect(params.testState.warnings).toEqual([]);
  });

  test("logs canonical merge failure and delegates degraded fallback publication", async () => {
    const error = new Error("canonical failed");
    const fallbackCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
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

    const result = await publishTimeoutReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "degraded-fallback", published: true },
    });

    expect(params.testState.warnings).toHaveLength(1);
    const [warning] = params.testState.warnings as [{ data: Record<string, unknown>; message: string }];
    expect(warning.message).toBe(
      "Failed to update timeout canonical review surface with Review Details; using degraded fallback comment",
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
    expect(fallbackCall.publishReason).toBe("timeout degraded Review Details fallback comment");
    expect(fallbackCall.failureMessage).toBe(
      "Failed to publish degraded Review Details fallback comment for timeout partial output",
    );
    const renderBody = fallbackCall.renderBody as () => string;
    expect(renderBody()).toBe("details body");
    expect(params.testState.renderCalls).toEqual([
      params.timeoutReviewDetailsRuntime,
      params.timeoutReviewDetailsRuntime,
    ]);
  });
});
