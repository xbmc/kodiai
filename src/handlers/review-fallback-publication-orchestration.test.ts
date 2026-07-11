import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import {
  buildReviewFallbackPublicationAdapters,
  publishAndApplyReviewFallbackOutputs,
  publishReviewFallbackOutputs,
  type ReviewFallbackPublicationStatePatch,
  type ReviewFallbackPublicationStateTarget,
} from "./review-fallback-publication-orchestration.ts";

function baseParams(
  overrides: Partial<Parameters<typeof publishReviewFallbackOutputs>[0]> = {},
): Parameters<typeof publishReviewFallbackOutputs>[0] {
  return {
    result: {
      conclusion: "error",
      published: false,
      errorMessage: "boom",
    },
    publishedPartialReview: false,
    deferredPublicOutputForContinuation: false,
    turnBudgetExhausted: false,
    fallbackRetryState: undefined,
    executionErrorContext: {
      category: "api_error",
      timeoutDuration: 600,
      complexityInfo: "risk=low",
    },
    appliedTimeoutBudget: null,
    getOctokit: mock(async () => ({} as never)),
    getAppSlug: mock(() => "kodiai"),
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 42,
    autoApprove: false,
    reviewOutputKey: "xbmc/kodiai#42:delivery",
    deliveryId: "delivery-1",
    installationId: 123,
    promptFileCount: 4,
    canonicalReviewDetailsBody: null,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    mergeConfidence: null,
    logger: { info: mock(() => undefined), error: mock(() => undefined) } as unknown as Logger,
    canPublishVisibleOutput: mock(() => true),
    setReviewWorkPhase: mock(() => undefined),
    refreshVisibleBudgetProjection: mock(() => null),
    renderReviewDetailsBody: mock(() => "details"),
    finalizePublicationPhaseTiming: mock(() => undefined),
    logReviewDetailsPublicationCompleted: mock(() => undefined),
    logCanonicalReviewDetailsPublicationCompleted: mock(() => undefined),
    publishExecutionErrorFallback: mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "error-fallback" as const,
          fallbackDelivery: "error-comment-created",
        },
      })
    ),
    publishFailureFallback: mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "failure-fallback" as const,
          fallbackDelivery: "error-comment-created",
        },
      })
    ),
    publishCleanReviewApproval: mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "clean-review-comment" as const,
        },
      })
    ),
    ...overrides,
  };
}

describe("publishReviewFallbackOutputs", () => {
  test("builds fallback publication adapters from handler dependencies", async () => {
    const octokit = { rest: {} } as never;
    let refreshCount = 0;
    const adapters = buildReviewFallbackPublicationAdapters({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
      appSlug: "kodiai",
      visibleBudgetProjection: {
        refresh: () => {
          refreshCount += 1;
          return null;
        },
      },
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
    expect(adapters.getAppSlug()).toBe("kodiai");
    expect(adapters.refreshVisibleBudgetProjection()).toBeNull();
    expect(refreshCount).toBe(1);
  });

  test("maps execution error fallback publication into a state patch", async () => {
    await expect(publishReviewFallbackOutputs(baseParams())).resolves.toEqual({
      ok: true,
      value: {
        reviewOutputPublished: true,
        reviewPublishResolution: "error-fallback",
        reviewPublishFallbackDelivery: "error-comment-created",
      } satisfies ReviewFallbackPublicationStatePatch,
    });
  });

  test("does not update state when execution error fallback publication is skipped", async () => {
    await expect(publishReviewFallbackOutputs(baseParams({
      publishExecutionErrorFallback: mock(async () =>
        ({
          ok: true as const,
          value: {
            published: false as const,
            resolution: "skipped" as const,
            fallbackDelivery: undefined,
          },
        })
      ),
    }))).resolves.toEqual({
      ok: true,
      value: {},
    });
  });

  test("maps generic failure fallback errors into a state patch", async () => {
    await expect(publishReviewFallbackOutputs(baseParams({
      result: {
        conclusion: "failure",
        published: false,
        errorMessage: undefined,
      },
      publishFailureFallback: mock(async () =>
        ({
          ok: false as const,
          err: {
            published: false as const,
            resolution: "failure-fallback-failed" as const,
            fallbackDelivery: "error-comment-failed",
          },
        })
      ),
    }))).resolves.toEqual({
      ok: true,
      value: {
        reviewOutputPublished: false,
        reviewPublishResolution: "failure-fallback-failed",
        reviewPublishFallbackDelivery: "error-comment-failed",
      } satisfies ReviewFallbackPublicationStatePatch,
    });
  });

  test("uses execution fallback and not generic failure fallback for turn-budget exhaustion", async () => {
    const publishExecutionErrorFallback = mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "turn-limit-fallback" as const,
          fallbackDelivery: "turn-limit-comment-created",
        },
      })
    );
    const publishFailureFallback = mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "failure-fallback" as const,
          fallbackDelivery: "error-comment-created",
        },
      })
    );

    await expect(publishReviewFallbackOutputs(baseParams({
      result: {
        conclusion: "failure",
        published: false,
        errorMessage: undefined,
      },
      turnBudgetExhausted: true,
      publishExecutionErrorFallback,
      publishFailureFallback,
    }))).resolves.toEqual({
      ok: true,
      value: {
        reviewOutputPublished: true,
        reviewPublishResolution: "turn-limit-fallback",
        reviewPublishFallbackDelivery: "turn-limit-comment-created",
      } satisfies ReviewFallbackPublicationStatePatch,
    });
    expect(publishExecutionErrorFallback).toHaveBeenCalledTimes(1);
    expect(publishFailureFallback).not.toHaveBeenCalled();
  });

  test("publishes turn-limit fallback even when no execution error context is available", async () => {
    const publishExecutionErrorFallback = mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "turn-limit-fallback" as const,
          fallbackDelivery: "turn-limit-comment-created",
        },
      })
    );
    const publishFailureFallback = mock(async () =>
      ({
        ok: true as const,
        value: {
          published: true as const,
          resolution: "failure-fallback" as const,
          fallbackDelivery: "error-comment-created",
        },
      })
    );

    await expect(publishReviewFallbackOutputs(baseParams({
      result: {
        conclusion: "failure",
        published: false,
        errorMessage: undefined,
      },
      executionErrorContext: undefined,
      turnBudgetExhausted: true,
      publishExecutionErrorFallback,
      publishFailureFallback,
    }))).resolves.toEqual({
      ok: true,
      value: {
        reviewOutputPublished: true,
        reviewPublishResolution: "turn-limit-fallback",
        reviewPublishFallbackDelivery: "turn-limit-comment-created",
      } satisfies ReviewFallbackPublicationStatePatch,
    });
    expect(publishExecutionErrorFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        exhaustedTurnBudget: true,
        category: "timeout",
        errorMessage: "Review stopped after reaching its turn budget.",
      }),
    );
    expect(publishFailureFallback).not.toHaveBeenCalled();
  });

  test("maps clean review publication into a state patch only when it published", async () => {
    await expect(publishReviewFallbackOutputs(baseParams({
      result: {
        conclusion: "success",
        published: false,
        errorMessage: undefined,
      },
    }))).resolves.toEqual({
      ok: true,
      value: {
        reviewOutputPublished: true,
        reviewPublishResolution: "clean-review-comment",
      } satisfies ReviewFallbackPublicationStatePatch,
    });
  });

  test("returns Result after applying fallback publication state patch", async () => {
    const publicationState: ReviewFallbackPublicationStateTarget = {
      reviewOutputPublished: false,
      reviewPublishResolution: "none",
      reviewPublishFallbackDelivery: undefined,
    };

    const result = await publishAndApplyReviewFallbackOutputs({
      ...baseParams(),
      publicationState,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        reviewOutputPublished: true,
        reviewPublishResolution: "error-fallback",
        reviewPublishFallbackDelivery: "error-comment-created",
      },
    });
    expect(publicationState).toEqual({
      reviewOutputPublished: true,
      reviewPublishResolution: "error-fallback",
      reviewPublishFallbackDelivery: "error-comment-created",
    });
  });
});
