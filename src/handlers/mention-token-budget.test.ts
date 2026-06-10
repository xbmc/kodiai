import { describe, expect, test } from "bun:test";
import { selectExplicitReviewPromptDiffContent } from "./mention-token-budget.ts";

describe("selectExplicitReviewPromptDiffContent", () => {
  test("keeps tiny fallback diffs in explicit review prompts", () => {
    const diff = "diff --git a/a.ts b/a.ts\n+change";

    expect(selectExplicitReviewPromptDiffContent({
      diffContent: diff,
      changedFileCount: 2,
    })).toBe(diff);
  });

  test("omits fallback diffs when too many files changed", () => {
    expect(selectExplicitReviewPromptDiffContent({
      diffContent: "small diff",
      changedFileCount: 4,
    })).toBeUndefined();
  });

  test("omits fallback diffs when raw patch text is too large", () => {
    expect(selectExplicitReviewPromptDiffContent({
      diffContent: "x".repeat(12_001),
      changedFileCount: 1,
    })).toBeUndefined();
  });
});
