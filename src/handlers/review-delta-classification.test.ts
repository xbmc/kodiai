import { describe, expect, test } from "bun:test";
import { buildReviewDeltaPriorFindingLookup } from "./review-delta-classification.ts";
import type { PriorFinding } from "../knowledge/types.ts";

describe("buildReviewDeltaPriorFindingLookup", () => {
  test("returns undefined when no prior finding store is available", () => {
    const lookup = buildReviewDeltaPriorFindingLookup({
      knowledgeStore: undefined,
      repo: "owner/repo",
      prNumber: 123,
    });

    expect(lookup).toBeUndefined();
  });

  test("binds prior review lookup to the review repo and PR number", async () => {
    const priorFindings: PriorFinding[] = [
      {
        filePath: "src/app.ts",
        title: "Guard null input",
        titleFingerprint: "guard-null-input",
        severity: "medium",
        category: "correctness",
        startLine: 10,
        endLine: 12,
        commentId: 99,
      },
    ];
    const calls: Array<{ repo: string; prNumber: number; limit?: number }> = [];
    const lookup = buildReviewDeltaPriorFindingLookup({
      knowledgeStore: {
        async getPriorReviewFindings(params) {
          calls.push(params);
          return priorFindings;
        },
      },
      repo: "owner/repo",
      prNumber: 123,
    });

    expect(lookup).toBeDefined();
    await expect(lookup?.()).resolves.toEqual(priorFindings);
    expect(calls).toEqual([{ repo: "owner/repo", prNumber: 123 }]);
  });
});
