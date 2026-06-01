import { describe, expect, test } from "bun:test";
import { REVIEW_WORKSPACE_FETCH_DEPTH } from "./review-diff-collection.ts";

describe("REVIEW_WORKSPACE_FETCH_DEPTH", () => {
  test("uses bounded workspace fetch depth for review clones", () => {
    expect(REVIEW_WORKSPACE_FETCH_DEPTH).toBe(50);
  });
});
