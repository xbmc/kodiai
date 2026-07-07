import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import { resolveReviewTimeoutPublicationContext } from "./review-timeout-publication-context.ts";

function checkpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "review-key",
    repo: "acme/repo",
    prNumber: 42,
    filesReviewed: ["src/a.ts"],
    filesInspected: ["src/a.ts", "src/b.ts"],
    findingCount: 2,
    summaryDraft: "Checkpoint summary.",
    totalFiles: 4,
    ...overrides,
  };
}

function boundedFirstPass(overrides: Partial<ReviewFirstPassPayload> = {}): ReviewFirstPassPayload {
  return {
    state: "bounded-first-pass",
    boundedReason: "timeout",
    evidenceSource: "checkpoint",
    coveredScope: { reviewedFiles: 2, totalFiles: 4 },
    remainingScope: { remainingFiles: 2, totalFiles: 4 },
    publication: { eligible: true, hasPublishedOutput: false },
    continuationPending: true,
    zeroEvidenceFailure: false,
    ...overrides,
  };
}

describe("resolveReviewTimeoutPublicationContext", () => {
  test("builds a partial review body from checkpoint summary plus retry note", () => {
    const context = resolveReviewTimeoutPublicationContext({
      reviewOutputKey: "review-key",
      checkpoint: checkpoint(),
      hasPublishedInlines: false,
      hasPartialResults: true,
      retryState: "scheduled reduced-scope retry",
      retrySummaryNote: "Scheduling a reduced-scope retry.",
      timeoutInspectedFiles: ["src/a.ts", "src/b.ts"],
      timeoutFindingCount: 2,
      timeoutTotalFiles: 4,
      turnBudgetExhausted: false,
      retryScheduled: true,
      timeoutFirstPass: boundedFirstPass(),
      timeoutDurationSeconds: 120,
      timeoutBudget: {
        remoteRuntimeBudgetSeconds: 120,
        infraOverheadBudgetSeconds: 180,
        totalTimeoutSeconds: 300,
      },
      isChronicTimeout: false,
    });

    expect(context.summaryDraft).toBe("Checkpoint summary.\n\nScheduling a reduced-scope retry.");
    expect(context.timeoutReviewDetails).toEqual({
      analyzedFiles: 2,
      totalFiles: 4,
      findingCount: 2,
      retryState: "scheduled reduced-scope retry",
    });
    expect(context.deferredPublicOutputForContinuation).toBe(false);
    expect(context.partialBody).toContain("Checkpoint summary.\n\nScheduling a reduced-scope retry.");
    expect(context.partialBody).toContain("<!-- kodiai:review-output-key:review-key -->");
  });

  test("defers public output when max-turns continuation can publish later", () => {
    const context = resolveReviewTimeoutPublicationContext({
      reviewOutputKey: "review-key",
      checkpoint: null,
      hasPublishedInlines: false,
      hasPartialResults: false,
      retryState: "scheduled reduced-scope retry",
      timeoutInspectedFiles: [],
      timeoutFindingCount: 0,
      timeoutTotalFiles: 6,
      turnBudgetExhausted: true,
      retryScheduled: true,
      timeoutFirstPass: boundedFirstPass({ boundedReason: "max-turns" }),
      timeoutDurationSeconds: 90,
      timeoutBudget: null,
      isChronicTimeout: false,
    });

    expect(context.deferredPublicOutputForContinuation).toBe(true);
    expect(context.partialBody).toBeUndefined();
    expect(context.summaryDraft).toBe("Review stopped before producing trustworthy structured output.");
  });

  test("adds chronic timeout skip warning to publishable partial bodies", () => {
    const context = resolveReviewTimeoutPublicationContext({
      reviewOutputKey: "review-key",
      checkpoint: checkpoint({ summaryDraft: "Timeout summary." }),
      hasPublishedInlines: false,
      hasPartialResults: true,
      retryState: "skipped (frequent timeouts for this repo/author)",
      timeoutInspectedFiles: ["src/a.ts"],
      timeoutFindingCount: 1,
      timeoutTotalFiles: 2,
      turnBudgetExhausted: false,
      retryScheduled: false,
      timeoutFirstPass: boundedFirstPass(),
      timeoutDurationSeconds: 60,
      timeoutBudget: null,
      isChronicTimeout: true,
    });

    expect(context.partialBody).toContain("Retry skipped -- this repo has timed out frequently for this author.");
    expect(context.partialBody).toContain("Consider splitting large PRs");
  });
});
