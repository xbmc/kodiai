import { describe, expect, test } from "bun:test";
import { buildReviewOutputMarker } from "./review-idempotency.ts";
import {
  findCanonicalReviewSurface,
  getCanonicalReviewSurfaceId,
  upsertDegradedReviewDetailsFallbackComment,
} from "./review-canonical-surface.ts";
import { buildReviewDetailsMarker } from "../lib/review-details-formatting.ts";

describe("getCanonicalReviewSurfaceId", () => {
  test("returns comment id for issue comments and review id for pull reviews", () => {
    expect(getCanonicalReviewSurfaceId({ kind: "issue_comment", commentId: 42, body: "x" })).toBe(42);
    expect(getCanonicalReviewSurfaceId({ kind: "pull_review", reviewId: 99, body: "x" })).toBe(99);
  });
});

describe("findCanonicalReviewSurface", () => {
  test("keeps pull review marker pagination in the shared marker helper", async () => {
    const source = await Bun.file(new URL("./review-canonical-surface.ts", import.meta.url)).text();

    expect(source).not.toContain("listReviews({");
    expect(source).toContain("findPullReviewByMarkerPaged");
  });

  test("finds canonical issue comments beyond the first page", async () => {
    const reviewOutputKey = "review-key-page-two";
    const marker = buildReviewOutputMarker(reviewOutputKey);
    const pagesSeen: number[] = [];
    const octokit = {
      rest: {
        issues: {
          listComments: async (params: { page?: number; per_page?: number }) => {
            const page = params.page ?? 1;
            pagesSeen.push(page);
            if (page === 1) {
              return {
                data: Array.from({ length: params.per_page ?? 100 }, (_, index) => ({
                  id: index + 1,
                  body: "old comment",
                })),
              };
            }
            return { data: [{ id: 250, body: `canonical\n${marker}` }] };
          },
        },
        pulls: {
          listReviews: async () => ({ data: [] }),
        },
      },
    };

    const result = await findCanonicalReviewSurface({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      surfaceKind: "issue_comment",
    });

    expect(result).toEqual({ kind: "issue_comment", commentId: 250, body: `canonical\n${marker}` });
    expect(pagesSeen).toEqual([1, 2]);
  });

  test("finds canonical pull reviews beyond the first page", async () => {
    const reviewOutputKey = "review-key-review-page-two";
    const marker = buildReviewOutputMarker(reviewOutputKey);
    const pagesSeen: number[] = [];
    const octokit = {
      rest: {
        issues: {
          listComments: async () => ({ data: [] }),
        },
        pulls: {
          listReviews: async (params: { page?: number; per_page?: number }) => {
            const page = params.page ?? 1;
            pagesSeen.push(page);
            if (page === 1) {
              return {
                data: Array.from({ length: params.per_page ?? 100 }, (_, index) => ({
                  id: index + 1,
                  body: "old review",
                })),
              };
            }
            return { data: [{ id: 350, body: `canonical review\n${marker}` }] };
          },
        },
      },
    };

    const result = await findCanonicalReviewSurface({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      surfaceKind: "pull_review",
    });

    expect(result).toEqual({ kind: "pull_review", reviewId: 350, body: `canonical review\n${marker}` });
    expect(pagesSeen).toEqual([1, 2]);
  });

  test("updates degraded Review Details fallback comments beyond the first page", async () => {
    const reviewOutputKey = "review-details-page-two";
    const marker = buildReviewDetailsMarker(reviewOutputKey);
    const pagesSeen: number[] = [];
    const updatedBodies: Array<{ commentId: number; body: string }> = [];
    let created = false;
    const octokit = {
      rest: {
        issues: {
          listComments: async (params: { page?: number; per_page?: number }) => {
            const page = params.page ?? 1;
            pagesSeen.push(page);
            if (page === 1) {
              return {
                data: Array.from({ length: params.per_page ?? 100 }, (_, index) => ({
                  id: index + 1,
                  body: "old comment",
                })),
              };
            }
            return { data: [{ id: 450, body: `old details\n${marker}` }] };
          },
          updateComment: async (params: { comment_id: number; body: string }) => {
            updatedBodies.push({ commentId: params.comment_id, body: params.body });
            return { data: { id: params.comment_id } };
          },
          createComment: async () => {
            created = true;
            return { data: { id: 999 } };
          },
        },
      },
    };

    const id = await upsertDegradedReviewDetailsFallbackComment({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      body: "new details",
      botHandles: ["kodiai"],
    });

    expect(id).toBe(450);
    expect(pagesSeen).toEqual([1, 2]);
    expect(updatedBodies).toHaveLength(1);
    expect(updatedBodies[0]?.body).toContain("new details");
    expect(created).toBe(false);
  });
});
