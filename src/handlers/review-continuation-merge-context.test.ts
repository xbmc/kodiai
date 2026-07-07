import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import { resolveReviewContinuationMergeContext } from "./review-continuation-merge-context.ts";

const BASE_BOUNDEDNESS: ReviewBoundednessContract = {
  requestedProfile: {
    selectedProfile: "balanced",
    source: "auto",
    autoBand: "large",
    linesChanged: 500,
  },
  effectiveProfile: {
    selectedProfile: "minimal",
    source: "auto",
    autoBand: "large",
    linesChanged: 500,
  },
  reasonCodes: ["timeout-auto-reduced"],
  disclosureRequired: true,
  disclosureSentence: "Review was bounded.",
  largePR: null,
  timeout: {
    riskLevel: "high",
    dynamicTimeoutSeconds: 120,
    shouldReduceScope: true,
    reductionApplied: true,
    reductionSkippedReason: null,
  },
};

function checkpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "review-key",
    repo: "xbmc/kodiai",
    prNumber: 195,
    filesReviewed: ["src/a.ts", "src/b.ts"],
    findingCount: 2,
    summaryDraft: "Merged summary.",
    totalFiles: 4,
    ...overrides,
  };
}

describe("resolveReviewContinuationMergeContext", () => {
  test("formats a retry partial review merge for publishable bounded first-pass state", () => {
    const context = resolveReviewContinuationMergeContext({
      reviewBoundedness: BASE_BOUNDEDNESS,
      mergedCheckpoint: checkpoint(),
      retryCheckpoint: checkpoint({
        reviewOutputKey: "review-key-retry-1",
        filesReviewed: ["src/c.ts"],
        summaryDraft: "Retry summary.",
      }),
      baseCheckpoint: checkpoint({ summaryDraft: "Base summary." }),
      firstPassOutcome: {
        conclusion: "failure",
        stopReason: null,
        failureSubtype: null,
        isTimeout: true,
        published: true,
      },
      timeoutFirstPassBoundedReason: "timeout",
      timeoutDurationSeconds: 90,
      retryFilesCount: 1,
      reviewOutputKey: "review-key",
      continuationRevisionCounts: { new: 1, stillOpen: 0, resolved: 1 },
    });

    expect(context.status).toBe("publishable");
    if (context.status !== "publishable") return;
    expect(context.retryFilesReviewed).toBe(1);
    expect(context.completedMaxTurnsContinuation).toBe(false);
    expect(context.reviewDetailsFirstPass).toBe(context.mergedFirstPass);
    expect(context.body).toContain("> **Bounded first-pass review**");
    expect(context.body).toContain("Retry complete -- analyzed 2 of 4 files total after a reduced-scope follow-up.");
    expect(context.body).toContain("Continuation revisions: 1 new finding, 0 still-open findings, and 1 resolved or revised finding.");
    expect(context.body).toContain("Merged summary.");
  });

  test("formats completed max-turn continuation without bounded first-pass Review Details runtime", () => {
    const context = resolveReviewContinuationMergeContext({
      reviewBoundedness: BASE_BOUNDEDNESS,
      mergedCheckpoint: checkpoint({
        filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        totalFiles: 4,
        summaryDraft: "",
      }),
      retryCheckpoint: checkpoint({ summaryDraft: "Retry completed summary." }),
      baseCheckpoint: checkpoint({ summaryDraft: "Base fallback summary." }),
      firstPassOutcome: {
        conclusion: "failure",
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
        isTimeout: false,
        published: true,
      },
      timeoutFirstPassBoundedReason: "max-turns",
      timeoutDurationSeconds: 90,
      retryFilesCount: 2,
      reviewOutputKey: "review-key",
      continuationRevisionCounts: null,
    });

    expect(context.status).toBe("publishable");
    if (context.status !== "publishable") return;
    expect(context.completedMaxTurnsContinuation).toBe(true);
    expect(context.reviewDetailsFirstPass).toBeNull();
    expect(context.body).toContain("> **Review complete**");
    expect(context.body).toContain("> Coverage: 4 of 4 changed files reviewed.");
    expect(context.body).toContain("Retry completed summary.");
  });

  test("returns non-publishable when merged first-pass evidence cannot be normalized", () => {
    const context = resolveReviewContinuationMergeContext({
      reviewBoundedness: null,
      mergedCheckpoint: checkpoint(),
      retryCheckpoint: null,
      baseCheckpoint: checkpoint(),
      firstPassOutcome: {
        conclusion: "failure",
        stopReason: null,
        failureSubtype: null,
        isTimeout: false,
        published: true,
      },
      timeoutFirstPassBoundedReason: "timeout",
      timeoutDurationSeconds: 90,
      retryFilesCount: 2,
      reviewOutputKey: "review-key",
      continuationRevisionCounts: null,
    });

    expect(context).toEqual({
      status: "non-publishable",
      reason: "non-publishable-merged-first-pass",
    });
  });
});
