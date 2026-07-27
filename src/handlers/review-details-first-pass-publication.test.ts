import { describe, expect, mock, test } from "bun:test";
import { publishFirstPassReviewDetails } from "./review-details-first-pass-publication.ts";

function baseParams(
  overrides: Partial<Parameters<typeof publishFirstPassReviewDetails>[0]> = {},
): Parameters<typeof publishFirstPassReviewDetails>[0] {
  return {
    reviewOutputSucceeded: false,
    resultPublished: false,
    resultConclusion: "failure",
    candidateMovedToDetailsCount: 0,
    blockedFindingsNoticeWillPublish: false,
    octokit: {} as never,
    owner: "xbmc",
    repo: "kodiai",
    prNumber: 195,
    reviewOutputKey: "review-key",
    botHandles: ["kodiai"],
    acceptedCanonicalSurface: null,
    authorSearchEnrichmentDegraded: false,
    reviewBoundedness: null,
    baseLog: { deliveryId: "delivery-1" },
    logger: { info: mock(() => undefined), warn: mock(() => undefined) },
    canPublishVisibleOutput: mock(() => true),
    setReviewWorkPhase: mock(() => undefined),
    renderReviewDetailsBody: mock(() => "Review Details"),
    finalizePublicationPhaseTiming: mock(() => undefined),
    logReviewDetailsPublicationCompleted: mock(() => undefined),
    logCanonicalReviewDetailsPublicationCompleted: mock(() => undefined),
    ...overrides,
  };
}

describe("publishFirstPassReviewDetails", () => {
  test("returns a shared Result envelope when review output did not succeed", async () => {
    await expect(publishFirstPassReviewDetails(baseParams())).resolves.toEqual({
      ok: true,
      value: { canonicalReviewDetailsBody: null },
    });
  });

  test("posts the standalone telemetry fallback when nothing else will own the surface", async () => {
    const publishStandaloneReviewDetailsFallbackFn = mock(() =>
      Promise.resolve({ ok: true as const, value: { delivery: "degraded-fallback" as const, published: true } }),
    );

    await publishFirstPassReviewDetails(baseParams({
      reviewOutputSucceeded: true,
      blockedFindingsNoticeWillPublish: false,
      publishStandaloneReviewDetailsFallbackFn,
    }));

    expect(publishStandaloneReviewDetailsFallbackFn).toHaveBeenCalledTimes(1);
  });

  test("skips the standalone telemetry fallback when the blocked-findings notice will publish the verdict", async () => {
    const publishStandaloneReviewDetailsFallbackFn = mock(() =>
      Promise.resolve({ ok: true as const, value: { delivery: "degraded-fallback" as const, published: true } }),
    );

    await publishFirstPassReviewDetails(baseParams({
      reviewOutputSucceeded: true,
      blockedFindingsNoticeWillPublish: true,
      publishStandaloneReviewDetailsFallbackFn,
    }));

    expect(publishStandaloneReviewDetailsFallbackFn).not.toHaveBeenCalled();
  });

  test("posts the moved-to-details merge when nothing else will own the surface", async () => {
    const publishMovedToDetailsReviewDetailsMergeFn = mock(() =>
      Promise.resolve({ ok: true as const, value: { delivery: "canonical-merge" as const, published: true } }),
    );

    await publishFirstPassReviewDetails(baseParams({
      reviewOutputSucceeded: true,
      candidateMovedToDetailsCount: 1,
      blockedFindingsNoticeWillPublish: false,
      publishMovedToDetailsReviewDetailsMergeFn,
    }));

    expect(publishMovedToDetailsReviewDetailsMergeFn).toHaveBeenCalledTimes(1);
  });

  test("skips the moved-to-details merge when the blocked-findings notice will publish the verdict", async () => {
    const publishMovedToDetailsReviewDetailsMergeFn = mock(() =>
      Promise.resolve({ ok: true as const, value: { delivery: "canonical-merge" as const, published: true } }),
    );
    const publishStandaloneReviewDetailsFallbackFn = mock(() =>
      Promise.resolve({ ok: true as const, value: { delivery: "degraded-fallback" as const, published: true } }),
    );

    await publishFirstPassReviewDetails(baseParams({
      reviewOutputSucceeded: true,
      candidateMovedToDetailsCount: 1,
      blockedFindingsNoticeWillPublish: true,
      publishMovedToDetailsReviewDetailsMergeFn,
      publishStandaloneReviewDetailsFallbackFn,
    }));

    expect(publishMovedToDetailsReviewDetailsMergeFn).not.toHaveBeenCalled();
    expect(publishStandaloneReviewDetailsFallbackFn).not.toHaveBeenCalled();
  });
});
