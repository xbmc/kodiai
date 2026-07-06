import { describe, expect, test } from "bun:test";
import { buildCleanReviewApprovalBody } from "./review-clean-approval.ts";

describe("buildCleanReviewApprovalBody", () => {
  test("builds approval evidence for one changed file", () => {
    const body = buildCleanReviewApprovalBody({
      reviewOutputKey: "v1:install:owner/repo:7:review:delivery:sha",
      promptFileCount: 1,
      visibleBudgetDisclosureEvidence: null,
      mergeConfidence: null,
      reviewDetailsBlock: null,
    });

    expect(body).toContain("Decision: APPROVE");
    expect(body).toContain("- Review prompt covered 1 changed file.");
    expect(body).not.toContain("Merge Confidence:");
  });

  test("includes visible budget disclosure and review details", () => {
    const body = buildCleanReviewApprovalBody({
      reviewOutputKey: "v1:install:owner/repo:7:review:delivery:sha",
      promptFileCount: 3,
      visibleBudgetDisclosureEvidence: "Visible budget covered all relevant hunks.",
      mergeConfidence: null,
      reviewDetailsBlock: "<details>\n<summary>Review Details</summary>\n</details>",
    });

    expect(body).toContain("- Review prompt covered 3 changed files.");
    expect(body).toContain("- Visible budget covered all relevant hunks.");
    expect(body).toContain("<summary>Review Details</summary>");
  });

  test("renders dependency-bump merge confidence", () => {
    const body = buildCleanReviewApprovalBody({
      reviewOutputKey: "v1:install:owner/repo:7:review:delivery:sha",
      promptFileCount: 2,
      visibleBudgetDisclosureEvidence: null,
      mergeConfidence: {
        level: "medium",
        rationale: ["Major version bump (potential breaking changes)"],
      },
      reviewDetailsBlock: null,
    });

    expect(body).toContain("- Review prompt covered 2 changed files.");
    expect(body).toContain(":yellow_circle: **Merge Confidence: Review Recommended**");
    expect(body).toContain("Major version bump (potential breaking changes)");
  });
});
