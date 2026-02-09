import { describe, expect, test } from "bun:test";
import {
  buildReviewOutputKey,
  buildReviewOutputMarker,
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

  test("ensureReviewOutputNotPublished returns skip when marker exists in review comments", async () => {
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
    expect(result.existingLocation).toBe("review-comment");
    expect(result.marker).toBe(marker);
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
    expect(result.existingLocation).toBeNull();
  });

  test("ensureReviewOutputNotPublished returns skip when marker exists in issue comments", async () => {
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
    expect(result.existingLocation).toBe("issue-comment");
    expect(result.marker).toBe(marker);
  });
});
