import { describe, expect, test } from "bun:test";
import { buildReviewOutputMarker } from "./review-idempotency.ts";
import {
  findCanonicalReviewSurface,
  getCanonicalReviewSurfaceId,
  reconcileSupersededCanonicalSurface,
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

    const result = await upsertDegradedReviewDetailsFallbackComment({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      body: "new details",
      botHandles: ["kodiai"],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        commentId: 450,
      },
    });
    expect(pagesSeen).toEqual([1, 2]);
    expect(updatedBodies).toHaveLength(1);
    expect(updatedBodies[0]?.body).toContain("new details");
    expect(created).toBe(false);
  });

  test("returns an explicit skipped result when publish rights are superseded", async () => {
    const result = await upsertDegradedReviewDetailsFallbackComment({
      octokit: {
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              throw new Error("should not publish");
            },
          },
        },
      } as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      body: "new details",
      botHandles: ["kodiai"],
      recheckCanPublish: () => false,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: false,
        commentId: undefined,
      },
    });
  });

  test("returns an explicit error result when fallback publication fails", async () => {
    const error = new Error("create failed");
    const result = await upsertDegradedReviewDetailsFallbackComment({
      octokit: {
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              throw error;
            },
          },
        },
      } as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      body: "new details",
      botHandles: ["kodiai"],
    });

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        error,
      },
    });
  });
});

describe("reconcileSupersededCanonicalSurface", () => {
  test("annotates a stale pull-review surface when a new issue-comment verdict is published", async () => {
    const reviewOutputKey = "reconcile-key-1";
    const marker = buildReviewOutputMarker(reviewOutputKey);
    const updatedBodies: Array<{ reviewId: number; body: string }> = [];
    const octokit = {
      rest: {
        issues: { listComments: async () => ({ data: [] }) },
        pulls: {
          listReviews: async () => ({
            data: [{ id: 77, body: `Decision: APPROVE\n${marker}` }],
          }),
        },
      },
      request: async (route: string, params: { review_id: number; body: string }) => {
        expect(route).toBe("PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}");
        updatedBodies.push({ reviewId: params.review_id, body: params.body });
        return { data: { id: params.review_id, body: params.body } };
      },
    };

    await reconcileSupersededCanonicalSurface({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      newSurfaceKind: "issue_comment",
      botHandles: ["kodiai"],
    });

    expect(updatedBodies).toHaveLength(1);
    expect(updatedBodies[0]?.reviewId).toBe(77);
    expect(updatedBodies[0]?.body).toContain("Superseded by a newer kodiai review decision");
  });

  test("does nothing when no stale alternate-kind surface exists", async () => {
    const reviewOutputKey = "reconcile-key-2";
    let updateCalled = false;
    const octokit = {
      rest: {
        issues: { listComments: async () => ({ data: [] }) },
        pulls: {
          listReviews: async () => ({ data: [] }),
          updateReview: async () => {
            updateCalled = true;
            return { data: {} };
          },
        },
      },
    };

    await reconcileSupersededCanonicalSurface({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      newSurfaceKind: "issue_comment",
      botHandles: ["kodiai"],
    });

    expect(updateCalled).toBe(false);
  });

  test("does not re-annotate an already-superseded surface", async () => {
    const reviewOutputKey = "reconcile-key-3";
    const marker = buildReviewOutputMarker(reviewOutputKey);
    let updateCalled = false;
    const octokit = {
      rest: {
        issues: { listComments: async () => ({ data: [] }) },
        pulls: {
          listReviews: async () => ({
            data: [{
              id: 88,
              body: `Decision: APPROVE\n${marker}\n<!-- kodiai:superseded -->`,
            }],
          }),
          updateReview: async () => {
            updateCalled = true;
            return { data: {} };
          },
        },
      },
    };

    await reconcileSupersededCanonicalSurface({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      newSurfaceKind: "issue_comment",
      botHandles: ["kodiai"],
    });

    expect(updateCalled).toBe(false);
  });

  test("swallows errors and does not throw (best-effort)", async () => {
    const reviewOutputKey = "reconcile-key-4";
    const warnCalls: unknown[] = [];
    const octokit = {
      rest: {
        issues: { listComments: async () => ({ data: [] }) },
        pulls: {
          listReviews: async () => {
            throw new Error("boom");
          },
        },
      },
    };

    await expect(reconcileSupersededCanonicalSurface({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      newSurfaceKind: "issue_comment",
      botHandles: ["kodiai"],
      logger: { warn: (fields) => warnCalls.push(fields) },
    })).resolves.toBeUndefined();

    expect(warnCalls).toHaveLength(1);
  });
});
