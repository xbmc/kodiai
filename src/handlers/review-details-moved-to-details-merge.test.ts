import { describe, expect, test } from "bun:test";
import type { CanonicalReviewSurface } from "../review-orchestration/review-canonical-surface.ts";
import { publishMovedToDetailsReviewDetailsMerge } from "./review-details-moved-to-details-merge.ts";

type TestState = {
  warnings: Array<{ data: Record<string, unknown>; message: string }>;
  completedLogs: Array<Record<string, unknown>>;
  canonicalLogs: Array<CanonicalReviewSurface | undefined>;
  phases: string[];
};

type TestParams = Parameters<typeof publishMovedToDetailsReviewDetailsMerge>[0] & {
  testState: TestState;
};

function makeParams(overrides: Partial<Parameters<typeof publishMovedToDetailsReviewDetailsMerge>[0]> = {}): TestParams {
  const warnings: Array<{ data: Record<string, unknown>; message: string }> = [];
  const completedLogs: Array<Record<string, unknown>> = [];
  const canonicalLogs: Array<CanonicalReviewSurface | undefined> = [];
  const phases: string[] = [];

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
    canPublishVisibleOutput: () => true,
    setReviewWorkPhase: (phase: "publish") => phases.push(phase),
    renderReviewDetailsBody: () => "details-final",
    finalizePublicationPhaseTiming: () => phases.push("finalize"),
    logReviewDetailsPublicationCompleted: (entry) => completedLogs.push(entry),
    logCanonicalReviewDetailsPublicationCompleted: (surface) => canonicalLogs.push(surface),
    upsertCanonicalReviewSurfaceFn: async () => ({
      kind: "issue_comment",
      commentId: 900,
      body: "details-initial",
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
    },
  } as TestParams;
}

describe("publishMovedToDetailsReviewDetailsMerge", () => {
  test("publishes moved-to-details output as canonical issue comment and refreshes finalized timing", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const params = makeParams({
      upsertCanonicalReviewSurfaceFn: async (input) => {
        upsertCalls.push(input as Record<string, unknown>);
        return {
          kind: "issue_comment",
          commentId: 900,
          body: String(input.reviewDetailsBlock ?? input.body),
        };
      },
    });

    const result = await publishMovedToDetailsReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "canonical-merge", published: true },
    });

    const state = params.testState;
    expect(upsertCalls).toHaveLength(2);
    const [initialUpsert, finalizedUpsert] = upsertCalls as [Record<string, unknown>, Record<string, unknown>];
    expect(initialUpsert.reviewDetailsBlock).toBe("details-initial");
    // The finalize step must merge into the existing surface, not overwrite it with a raw
    // Review-Details-only body -- otherwise it silently wipes the Decision/summary text.
    expect(finalizedUpsert.reviewDetailsBlock).toBe("details-final");
    expect(finalizedUpsert.summaryBody).toBe("details-initial");
    expect(finalizedUpsert.body).toBeUndefined();
    expect(state.phases).toEqual(["publish", "finalize"]);
    expect(state.canonicalLogs).toHaveLength(1);
    expect(state.warnings).toHaveLength(0);
  });

  test("falls back to degraded details comment when canonical moved-to-details publication fails", async () => {
    const params = makeParams({
      upsertCanonicalReviewSurfaceFn: async () => {
        throw new Error("canonical failed");
      },
    });

    const result = await publishMovedToDetailsReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "degraded-fallback", published: true },
    });

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
    expect(warning.data.gateResult).toBe("moved-to-details-canonical-merge-failed");
  });

  test("does not publish when moved-to-details publish rights are unavailable", async () => {
    let upsertCalled = false;
    const params = makeParams({
      canPublishVisibleOutput: () => false,
      upsertCanonicalReviewSurfaceFn: async () => {
        upsertCalled = true;
        return undefined;
      },
    });

    const result = await publishMovedToDetailsReviewDetailsMerge(params);

    expect(result).toEqual({
      ok: true,
      value: { delivery: "skipped", published: false },
    });

    const state = params.testState;
    expect(upsertCalled).toBe(false);
    expect(state.phases).toEqual([]);
    expect(state.completedLogs).toEqual([]);
    expect(state.canonicalLogs).toEqual([]);
  });
});
