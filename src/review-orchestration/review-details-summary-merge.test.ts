import { describe, expect, test } from "bun:test";
import {
  ensureVisibleApprovalDecision,
  mergeReviewDetailsIntoSummaryBody,
  unwrapKodiaiResponseDetails,
} from "./review-details-summary-merge.ts";

describe("unwrapKodiaiResponseDetails", () => {
  test("unwraps nested kodiai response details blocks", () => {
    const body = "<details>\n<summary>kodiai response</summary>\n\nDecision: APPROVE\nIssues: none\n</details>";
    expect(unwrapKodiaiResponseDetails(body)).toBe("Decision: APPROVE\nIssues: none");
  });
});

describe("ensureVisibleApprovalDecision", () => {
  test("promotes hidden approval decisions to the top of the body", () => {
    const body = "<details>\n<summary>Review</summary>\n\nDecision: APPROVE\nIssues: none\n</details>";
    expect(ensureVisibleApprovalDecision(body)).toBe("Decision: APPROVE\n\n<details>\n<summary>Review</summary>\n\nIssues: none\n</details>");
  });
});

describe("mergeReviewDetailsIntoSummaryBody", () => {
  test("inserts review details before the first closing details tag", () => {
    const merged = mergeReviewDetailsIntoSummaryBody({
      summaryBody: "<details>\n<summary>Review</summary>\n\nLooks good.\n</details>",
      reviewDetailsBlock: "<details>\n<summary>Review Details</summary>\n\n- Findings: 0 critical, 0 major, 0 medium, 0 minor\n</details>",
      requireDegradationDisclosure: false,
    });

    expect(merged).toContain("Review Details");
    expect(merged.indexOf("Looks good.")).toBeLessThan(merged.indexOf("Review Details"));
  });
});
