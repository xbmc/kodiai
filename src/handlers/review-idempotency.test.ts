import { describe, expect, test } from "bun:test";
import {
  buildApprovedReviewBody,
  buildReviewOutputKey,
  buildReviewOutputMarker,
  buildReviewOutputPublicationLogFields,
  ensureReviewOutputNotPublished,
  extractReviewOutputKey,
  parseReviewOutputKey,
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

function extractEvidenceBullets(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
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

  test("parseReviewOutputKey returns structured identity for a base key", () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "Acme",
      repo: "Repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "DELIVERY-123",
      headSha: "ABCDEF1234",
    });

    const result = parseReviewOutputKey(reviewOutputKey);

    expect(result).not.toBeNull();
    expect(result?.reviewOutputKey).toBe(reviewOutputKey);
    expect(result?.baseReviewOutputKey).toBe(reviewOutputKey);
    expect(result?.retryAttempt).toBeNull();
    expect(result?.installationId).toBe(42);
    expect(result?.owner).toBe("acme");
    expect(result?.repo).toBe("repo");
    expect(result?.repoFullName).toBe("acme/repo");
    expect(result?.prNumber).toBe(101);
    expect(result?.action).toBe("review_requested");
    expect(result?.deliveryId).toBe("delivery-123");
    expect(result?.effectiveDeliveryId).toBe("delivery-123");
    expect(result?.headSha).toBe("abcdef1234");
  });

  test("parseReviewOutputKey normalizes retry-suffixed keys", () => {
    const baseReviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });

    const result = parseReviewOutputKey(`${baseReviewOutputKey}-retry-1`);

    expect(result).not.toBeNull();
    expect(result?.reviewOutputKey).toBe(`${baseReviewOutputKey}-retry-1`);
    expect(result?.baseReviewOutputKey).toBe(baseReviewOutputKey);
    expect(result?.retryAttempt).toBe(1);
    expect(result?.deliveryId).toBe("delivery-123");
    expect(result?.effectiveDeliveryId).toBe("delivery-123-retry-1");
  });

  test("parseReviewOutputKey returns null for malformed keys", () => {
    expect(parseReviewOutputKey("kodiai-review-output:v1:bad")).toBeNull();
    expect(parseReviewOutputKey("not-a-review-output-key")).toBeNull();
    expect(parseReviewOutputKey("kodiai-review-output:v2:inst-42:acme/repo:pr-101:action-review_requested:delivery-d:head-h")).toBeNull();
  });

  test("extractReviewOutputKey finds a review-output marker in a body", () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "mention-review",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });

    const result = extractReviewOutputKey(`Before\n\n${buildReviewOutputMarker(reviewOutputKey)}\n\nAfter`);

    expect(result).toBe(reviewOutputKey);
  });

  test("extractReviewOutputKey also finds a review-details marker in a body", () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });

    const result = extractReviewOutputKey(`Before\n\n<!-- kodiai:review-details:${reviewOutputKey} -->\n\nAfter`);

    expect(result).toBe(reviewOutputKey);
  });

  test("buildApprovedReviewBody emits visible markdown with bounded evidence bullets and marker continuity", () => {
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      action: "mention-review",
      deliveryId: "delivery-123",
      headSha: "abcdef1234",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const result = buildApprovedReviewBody({
      reviewOutputKey,
      evidence: [
        "  Reviewed 12 changed files across 3 directories.  ",
        "Dependency bumps are limited to patch releases.",
        "   ",
        "This overflow evidence must not be emitted.",
      ],
      approvalConfidence: "  :green_circle: **Merge Confidence: High** — Safe to merge.  ",
    });

    expect(result).toContain("Decision: APPROVE");
    expect(result).toContain("Issues: none");
    expect(result).toContain("Evidence:");
    expect(result).toContain(marker);
    expect(result).not.toContain("<details>");
    expect(result).not.toContain("<summary>kodiai response</summary>");
    expect(result).not.toContain("This overflow evidence must not be emitted.");
    expect(result).toContain("- Reviewed 12 changed files across 3 directories.");
    expect(result).toContain("- Dependency bumps are limited to patch releases.");
    expect(result).toContain("- :green_circle: **Merge Confidence: High** — Safe to merge.");
    expect(extractEvidenceBullets(result)).toEqual([
      "- Reviewed 12 changed files across 3 directories.",
      "- Dependency bumps are limited to patch releases.",
      "- :green_circle: **Merge Confidence: High** — Safe to merge.",
    ]);
    expect(extractReviewOutputKey(result)).toBe(reviewOutputKey);
    expect(result.trimEnd().endsWith(marker)).toBe(true);
  });

  test("buildApprovedReviewBody falls back to one default evidence bullet when inputs are empty", () => {
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
      evidence: ["   ", "\n\t  "],
      approvalConfidence: "   ",
    });

    expect(result).toContain("Evidence:");
    expect(extractEvidenceBullets(result)).toEqual([
      "- No actionable issues were identified in the reviewed changes.",
    ]);
    expect(result).not.toContain("<details>");
  });

  test("buildApprovedReviewBody preserves exactly three normalized evidence bullets without approval confidence", () => {
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
      evidence: [
        "  Reviewed only source files.  ",
        "No runtime config changes detected.",
        "Tests relevant to touched files are already green.",
      ],
    });

    expect(extractEvidenceBullets(result)).toEqual([
      "- Reviewed only source files.",
      "- No runtime config changes detected.",
      "- Tests relevant to touched files are already green.",
    ]);
    expect(result).toContain(buildReviewOutputMarker(reviewOutputKey));
    expect(result).not.toContain("<details>");
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
