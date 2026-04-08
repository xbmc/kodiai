import { describe, expect, test } from "bun:test";
import {
  buildApprovedReviewBody,
  buildReviewOutputKey,
  buildReviewOutputMarker,
  buildReviewOutputPublicationLogFields,
  ensureReviewOutputNotPublished,
} from "./review-idempotency.ts";

function createOctokitStub(options: {
  reviewCommentBodies?: string[];
  issueCommentBodies?: string[];
  reviewBodies?: string[];
}) {
  const reviewCommentBodies = options.reviewCommentBodies ?? [];
  const issueCommentBodies = options.issueCommentBodies ?? [];
  const reviewBodies = options.reviewBodies ?? [];

  return {
    rest: {
      pulls: {
        listReviewComments: async () => ({
          data: reviewCommentBodies.map((body, index) => ({
            id: index + 1,
            body,
          })),
        }),
        listReviews: async () => ({
          data: reviewBodies.map((body, index) => ({
            id: index + 1,
            body,
          })),
        }),
      },
      issues: {
        listComments: async () => ({
          data: issueCommentBodies.map((body, index) => ({
            id: index + 1,
            body,
          })),
        }),
      },
    },
  };
}

describe("review idempotency helpers", () => {
  test("buildReviewOutputKey returns same key for identical inputs", () => {
    const input = {
      installationId: 42,
      owner: "Acme",
      repo: "Repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "DELIVERY-123",
      headSha: "ABCDEF1234",
    };

    const first = buildReviewOutputKey(input);
    const second = buildReviewOutputKey(input);

    expect(first).toBe(second);
  });

  test("buildReviewOutputKey changes when key components change", () => {
    const base = {
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    };

    const baseKey = buildReviewOutputKey(base);

    expect(buildReviewOutputKey({ ...base, deliveryId: "delivery-456" })).not.toBe(baseKey);
    expect(buildReviewOutputKey({ ...base, headSha: "fedcba9876" })).not.toBe(baseKey);
    expect(buildReviewOutputKey({ ...base, prNumber: 102 })).not.toBe(baseKey);
  });

  test("buildApprovedReviewBody returns a review-structured approval body with marker", () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "mention-review",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });

    const result = buildApprovedReviewBody({
      reviewOutputKey,
      approvalConfidence: ":green_circle: **Merge Confidence: High** — Safe to merge.",
    });

    expect(result).toContain("<summary>kodiai response</summary>");
    expect(result).toContain("Decision: APPROVE");
    expect(result).toContain("Issues: none");
    expect(result).toContain("Merge Confidence: High");
    expect(result).toContain(buildReviewOutputMarker(reviewOutputKey));
  });

  test("ensureReviewOutputNotPublished returns skip decision when marker exists in review comments", async () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const result = await ensureReviewOutputNotPublished({
      octokit: createOctokitStub({
        reviewCommentBodies: [
          "Non-marker body",
          `Existing inline output\n\n${marker}`,
        ],
      }) as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    expect(marker).toBe(`<!-- kodiai:review-output-key:${reviewOutputKey} -->`);
    expect(result.shouldPublish).toBe(false);
    expect(result.publicationState).toBe("skip-existing-output");
    expect(result.existingLocation).toBe("review-comment");
    expect(result.idempotencyDecision).toBe("skip-existing-review-comment");
    expect(result.marker).toBe(marker);
    expect(result.scanStats.reviewComments.scanned).toBe(2);
    expect(result.scanStats.issueComments.scanned).toBe(0);
    expect(result.scanStats.reviews.scanned).toBe(0);
  });

  test("ensureReviewOutputNotPublished allows publish when marker absent", async () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });

    const result = await ensureReviewOutputNotPublished({
      octokit: createOctokitStub({
        reviewCommentBodies: ["Looks good"],
        reviewBodies: ["General review without marker"],
      }) as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    expect(result.marker).toBe(`<!-- kodiai:review-output-key:${reviewOutputKey} -->`);
    expect(result.shouldPublish).toBe(true);
    expect(result.publicationState).toBe("publish");
    expect(result.existingLocation).toBeNull();
    expect(result.idempotencyDecision).toBe("publish");
    expect(result.scanStats.reviewComments.scanned).toBe(1);
    expect(result.scanStats.issueComments.scanned).toBe(0);
    expect(result.scanStats.reviews.scanned).toBe(1);
  });

  test("ensureReviewOutputNotPublished returns skip decision when marker exists in issue comments", async () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const result = await ensureReviewOutputNotPublished({
      octokit: createOctokitStub({
        issueCommentBodies: [
          "Unrelated comment",
          `Summary comment body\n\n${marker}`,
        ],
      }) as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    expect(result.shouldPublish).toBe(false);
    expect(result.publicationState).toBe("skip-existing-output");
    expect(result.existingLocation).toBe("issue-comment");
    expect(result.idempotencyDecision).toBe("skip-existing-issue-comment");
    expect(result.marker).toBe(marker);
    expect(result.scanStats.reviewComments.scanned).toBe(0);
    expect(result.scanStats.issueComments.scanned).toBe(2);
    expect(result.scanStats.reviews.scanned).toBe(0);
  });

  test("ensureReviewOutputNotPublished returns skip decision when marker exists in review bodies", async () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const result = await ensureReviewOutputNotPublished({
      octokit: createOctokitStub({
        reviewBodies: [
          "General review without marker",
          `Silent approval\n\n${marker}`,
        ],
      }) as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    expect(result.shouldPublish).toBe(false);
    expect(result.publicationState).toBe("skip-existing-output");
    expect(result.existingLocation).toBe("review");
    expect(result.idempotencyDecision).toBe("skip-existing-review");
    expect(result.scanStats.reviewComments.scanned).toBe(0);
    expect(result.scanStats.issueComments.scanned).toBe(0);
    expect(result.scanStats.reviews.scanned).toBe(2);
  });

  test("buildReviewOutputPublicationLogFields exposes normalized publication state", async () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const result = await ensureReviewOutputNotPublished({
      octokit: createOctokitStub({
        reviewBodies: [`Silent approval\n\n${marker}`],
      }) as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    const fields = buildReviewOutputPublicationLogFields(result);
    expect(fields.reviewOutputKey).toBe(reviewOutputKey);
    expect(fields.reviewOutputPublicationState).toBe("skip-existing-output");
    expect(fields.idempotencyDecision).toBe("skip-existing-review");
    expect(fields.existingLocation).toBe("review");
    expect(fields.reviewsScanned).toBe(1);
  });
});
