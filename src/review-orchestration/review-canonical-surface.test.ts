import { describe, expect, test } from "bun:test";
import { getCanonicalReviewSurfaceId } from "./review-canonical-surface.ts";

describe("getCanonicalReviewSurfaceId", () => {
  test("returns comment id for issue comments and review id for pull reviews", () => {
    expect(getCanonicalReviewSurfaceId({ kind: "issue_comment", commentId: 42, body: "x" })).toBe(42);
    expect(getCanonicalReviewSurfaceId({ kind: "pull_review", reviewId: 99, body: "x" })).toBe(99);
  });
});
