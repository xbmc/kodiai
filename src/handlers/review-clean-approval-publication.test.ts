import { describe, expect, mock, test } from "bun:test";
import { publishCleanReviewApproval } from "./review-clean-approval-publication.ts";

function createOctokit(overrides: {
  createComment?: () => Promise<{ data: { id?: number } }>;
} = {}) {
  return {
    rest: {
      issues: {
        listComments: mock(async () => ({ data: [] })),
        createComment: mock(overrides.createComment ?? (async () => ({ data: { id: 501 } }))),
        updateComment: mock(async () => ({ data: {} })),
      },
      pulls: {
        listReviewComments: mock(async () => ({ data: [] })),
        listReviews: mock(async () => ({ data: [] })),
        createReview: mock(async () => ({ data: { id: 601 } })),
        updateReview: mock(async () => ({ data: {} })),
      },
    },
  };
}

function baseParams(overrides: Partial<Parameters<typeof publishCleanReviewApproval>[0]> = {}) {
  const octokit = createOctokit();
  return {
    resultPublished: false,
    autoApprove: false,
    getOctokit: async () => octokit as never,
    getAppSlug: () => "kodiai",
    owner: "owner",
    repo: "repo",
    prNumber: 42,
    reviewOutputKey: "owner/repo#42:delivery",
    deliveryId: "delivery-1",
    installationId: 123,
    promptFileCount: 3,
    canonicalReviewDetailsBody: null,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    mergeConfidence: null,
    logger: {
      info: mock(() => undefined),
      error: mock(() => undefined),
      warn: mock(() => undefined),
    },
    canPublishVisibleOutput: mock(() => true),
    setReviewWorkPhase: mock(() => undefined),
    refreshVisibleBudgetProjection: mock(() => null),
    renderReviewDetailsBody: mock(() => "details body"),
    finalizePublicationPhaseTiming: mock(() => undefined),
    logReviewDetailsPublicationCompleted: mock(() => undefined),
    logCanonicalReviewDetailsPublicationCompleted: mock(() => undefined),
    ...overrides,
  };
}

describe("publishCleanReviewApproval", () => {
  test("returns a successful Result when publishing a clean review comment", async () => {
    const params = baseParams();

    const result = await publishCleanReviewApproval(params);

    expect(result).toEqual({
      ok: true,
      value: { published: true, resolution: "clean-review-comment" },
    });
    expect(params.setReviewWorkPhase).toHaveBeenCalledWith("publish");
  });

  test("returns a skipped successful Result when executor output was already published", async () => {
    const params = baseParams({ resultPublished: true });

    const result = await publishCleanReviewApproval(params);

    expect(result).toEqual({
      ok: true,
      value: { published: false, resolution: "skipped" },
    });
  });

  test("returns a failed Result when publication throws", async () => {
    const error = new Error("publication failed");
    const octokit = createOctokit({
      createComment: async () => {
        throw error;
      },
    });
    const params = baseParams({
      getOctokit: async () => octokit as never,
    });

    const result = await publishCleanReviewApproval(params);

    expect(result).toEqual({ ok: false, err: error });
    expect(params.logger.error).toHaveBeenCalledWith(
      { err: error, prNumber: 42 },
      "Failed to publish clean review comment",
    );
  });
});
