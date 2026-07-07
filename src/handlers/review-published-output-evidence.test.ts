import { describe, expect, mock, test } from "bun:test";
import { logPublishedReviewOutputEvidence } from "./review-published-output-evidence.ts";

function baseParams(overrides: Partial<Parameters<typeof logPublishedReviewOutputEvidence>[0]> = {}) {
  return {
    result: { conclusion: "success", published: true },
    logger: { info: mock(() => {}) },
    deliveryId: "delivery-1",
    installationId: 123,
    owner: "owner",
    repo: "owner/repo",
    repoName: "repo",
    prNumber: 17,
    reviewOutputKey: "review-key",
    ...overrides,
  };
}

describe("logPublishedReviewOutputEvidence", () => {
  test("logs a review evidence bundle only for successful published output", () => {
    const params = baseParams();

    logPublishedReviewOutputEvidence(params);

    expect(params.logger.info).toHaveBeenCalledWith(
      {
        evidenceType: "review",
        outcome: "published-output",
        deliveryId: "delivery-1",
        installationId: 123,
        owner: "owner",
        repoName: "repo",
        repo: "owner/repo",
        prNumber: 17,
        reviewOutputKey: "review-key",
      },
      "Evidence bundle",
    );
  });

  test("skips logging when the run did not publish output", () => {
    const params = baseParams({ result: { conclusion: "success", published: false } });

    logPublishedReviewOutputEvidence(params);

    expect(params.logger.info).not.toHaveBeenCalled();
  });
});
