import { describe, expect, test } from "bun:test";
import type { CanonicalReviewSurface } from "../review-orchestration/review-canonical-surface.ts";
import { publishPublishedReviewDetailsMerge } from "./review-details-published-merge.ts";

type TestState = {
  warnings: Array<{ data: Record<string, unknown>; message: string }>;
  completedLogs: Array<Record<string, unknown>>;
  canonicalLogs: Array<CanonicalReviewSurface | undefined>;
  phases: string[];
  canPublishCalls: string[];
};

type TestParams = Parameters<typeof publishPublishedReviewDetailsMerge>[0] & {
  testState: TestState;
};

function makeParams(overrides: Partial<Parameters<typeof publishPublishedReviewDetailsMerge>[0]> = {}): TestParams {
  const warnings: Array<{ data: Record<string, unknown>; message: string }> = [];
  const completedLogs: Array<Record<string, unknown>> = [];
  const canonicalLogs: Array<CanonicalReviewSurface | undefined> = [];
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
    acceptedCanonicalSurface: undefined,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: {
      warn: (data: Record<string, unknown>, message: string) => warnings.push({ data, message }),
    },
    canPublishVisibleOutput: (reason: string) => {
      canPublishCalls.push(reason);
      return true;
    },
    setReviewWorkPhase: (phase: "publish") => phases.push(phase),
    renderReviewDetailsBody: () => "details-final",
    finalizePublicationPhaseTiming: () => phases.push("finalize"),
    logReviewDetailsPublicationCompleted: (entry) => completedLogs.push(entry),
    logCanonicalReviewDetailsPublicationCompleted: (surface) => canonicalLogs.push(surface),
    upsertCanonicalReviewSurfaceFn: async () => ({
      kind: "issue_comment",
      commentId: 900,
      body: "summary-with-details",
    }),
    upsertDegradedReviewDetailsFallbackCommentFn: async () => ({
      ok: true,
      value: { published: true, commentId: 901 },
    }),
    ...overrides,
    testState: {
      warnings,
      completedLogs,
      canonicalLogs,
      phases,
      canPublishCalls,
    },
  } as TestParams;
}

describe("publishPublishedReviewDetailsMerge", () => {
  test("merges details into the canonical issue comment and refreshes finalized timings", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      upsertCanonicalReviewSurfaceFn: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return {
          kind: "issue_comment",
          commentId: 900,
          body: String(input.summaryBody ?? "summary-with-details"),
        };
      },
    });

    await publishPublishedReviewDetailsMerge(params);

    const state = params.testState;
    expect(upsertCalls).toHaveLength(2);
    const [initialUpsert, finalizedUpsert] = upsertCalls as [Record<string, unknown>, Record<string, unknown>];
    expect(initialUpsert.reviewDetailsBlock).toBe("details-initial");
    expect(finalizedUpsert.reviewDetailsBlock).toBe("details-final");
    expect(state.phases).toEqual(["publish", "finalize"]);
    expect(state.canonicalLogs).toHaveLength(1);
    expect(state.warnings).toHaveLength(0);
  });

  test("falls back to a degraded details comment when canonical merge fails", async () => {
    const params = makeParams({
      upsertCanonicalReviewSurfaceFn: async () => {
        throw new Error("canonical failed");
      },
    });

    await publishPublishedReviewDetailsMerge(params);

    const state = params.testState;
    expect(state.phases).toEqual(["publish", "publish"]);
    expect(state.completedLogs).toEqual([
      {
        surfaceKind: "issue_comment",
        commentId: 901,
        publicationMode: "degraded-fallback",
      },
    ]);
    expect(state.warnings).toHaveLength(1);
    const [warning] = state.warnings as [{ data: Record<string, unknown>; message: string }];
    expect(warning.data.gateResult).toBe("degraded-fallback");
  });

  test("does not publish when publish rights are unavailable", async () => {
    let upsertCalled = false;
    const params = makeParams({
      canPublishVisibleOutput: () => false,
      upsertCanonicalReviewSurfaceFn: async () => {
        upsertCalled = true;
        return undefined;
      },
    });

    await publishPublishedReviewDetailsMerge(params);

    const state = params.testState;
    expect(upsertCalled).toBe(false);
    expect(state.phases).toEqual([]);
    expect(state.completedLogs).toEqual([]);
    expect(state.canonicalLogs).toEqual([]);
  });
});
