import { describe, expect, test } from "bun:test";
import type { PriorFinding } from "../knowledge/types.ts";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";
import { fingerprintFindingTitle } from "../lib/review-finding-metadata.ts";
import { resolveReviewContinuationRevisionCounts } from "./review-continuation-revision-counts.ts";

function priorFinding(title: string, filePath = "src/a.ts"): PriorFinding {
  return {
    filePath,
    title,
    titleFingerprint: fingerprintFindingTitle(title),
    severity: "major",
    category: "correctness",
    startLine: null,
    endLine: null,
    commentId: null,
  };
}

function extractedFinding(title: string, filePath = "src/a.ts", commentId = 10): ExtractedFinding {
  return {
    commentId,
    filePath,
    title,
    severity: "major",
    category: "correctness",
  };
}

describe("resolveReviewContinuationRevisionCounts", () => {
  test("returns null when prior finding lookup is unavailable", async () => {
    const counts = await resolveReviewContinuationRevisionCounts({
      repo: "acme/widget",
      prNumber: 42,
      reviewOutputKey: "review-key",
      logger: { warn: () => undefined } as never,
      baseLog: {},
    });

    expect(counts).toBeNull();
  });

  test("returns null when no prior findings exist", async () => {
    let extracted = false;

    const counts = await resolveReviewContinuationRevisionCounts({
      repo: "acme/widget",
      prNumber: 42,
      reviewOutputKey: "review-key",
      logger: { warn: () => undefined } as never,
      baseLog: {},
      getPriorReviewFindings: async () => [],
      extractFindings: async () => {
        extracted = true;
        return [extractedFinding("New issue")];
      },
    });

    expect(counts).toBeNull();
    expect(extracted).toBe(false);
  });

  test("classifies new, still-open, and resolved continuation findings", async () => {
    const counts = await resolveReviewContinuationRevisionCounts({
      repo: "acme/widget",
      prNumber: 42,
      reviewOutputKey: "review-key",
      logger: { warn: () => undefined } as never,
      baseLog: {},
      getPriorReviewFindings: async () => [
        priorFinding("Existing issue"),
        priorFinding("Resolved issue", "src/old.ts"),
      ],
      extractFindings: async () => [
        extractedFinding("Existing issue"),
        extractedFinding("New issue", "src/new.ts", 11),
      ],
    });

    expect(counts).toEqual({
      new: 1,
      stillOpen: 1,
      resolved: 1,
    });
  });

  test("fails open and logs when revision classification dependencies fail", async () => {
    const warnings: Array<[Record<string, unknown>, string]> = [];

    const counts = await resolveReviewContinuationRevisionCounts({
      repo: "acme/widget",
      prNumber: 42,
      reviewOutputKey: "review-key",
      logger: {
        warn: (payload: Record<string, unknown>, message: string) => warnings.push([payload, message]),
      } as never,
      baseLog: { deliveryId: "delivery-1" },
      getPriorReviewFindings: async () => {
        throw new Error("store unavailable");
      },
      extractFindings: async () => [extractedFinding("Existing issue")],
    });

    expect(counts).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toEqual(expect.objectContaining({
      deliveryId: "delivery-1",
      gate: "continuation-delta",
      gateResult: "failed",
      reviewOutputKey: "review-key",
      err: expect.any(Error),
    }));
  });
});
