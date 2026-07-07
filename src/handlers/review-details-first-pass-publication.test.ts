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
});
