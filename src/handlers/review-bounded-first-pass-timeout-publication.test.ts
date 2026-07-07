import { describe, expect, mock, test } from "bun:test";
import { publishBoundedFirstPassTimeoutOutput } from "./review-bounded-first-pass-timeout-publication.ts";

function baseParams(
  overrides: Partial<Parameters<typeof publishBoundedFirstPassTimeoutOutput>[0]> = {},
): Parameters<typeof publishBoundedFirstPassTimeoutOutput>[0] {
  return {
    timeoutFirstPass: null,
    deferredPublicOutputForContinuation: false,
    partialBody: undefined,
    octokit: {} as never,
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 42,
    reviewOutputKey: "xbmc/kodiai#42:delivery",
    botHandles: ["kodiai"],
    canPublishVisibleOutput: mock(() => true),
    setReviewWorkPhase: mock(() => undefined),
    logger: { info: mock(() => undefined), warn: mock(() => undefined), error: mock(() => undefined) } as never,
    deliveryId: "delivery-1",
    knowledgeStore: undefined,
    filesReviewed: [],
    filesInspected: [],
    findingCount: 0,
    summaryDraft: "",
    totalFiles: 0,
    hasPartialResults: false,
    chronicTimeout: false,
    recentTimeouts: 0,
    retryState: "none",
    timeoutReviewDetails: {} as never,
    timeoutBudget: null,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    baseLog: {},
    renderReviewDetailsBody: mock(() => "Review Details"),
    telemetryEnabled: false,
    telemetryStore: { recordResilienceEvent: mock(async () => undefined) },
    prAuthor: "octocat",
    eventType: "pull_request.opened",
    executionConclusion: "error",
    hadInlineOutput: false,
    timeoutClassificationTelemetry: {} as never,
    ...overrides,
  };
}

describe("publishBoundedFirstPassTimeoutOutput", () => {
  test("returns a shared Result envelope when there is no bounded first pass to publish", async () => {
    await expect(publishBoundedFirstPassTimeoutOutput(baseParams())).resolves.toEqual({
      ok: true,
      value: {
        partialCommentId: undefined,
        publishedPartialReview: false,
        continuationProjectionDegraded: false,
      },
    });
  });
});
