import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import type { FileRiskScore } from "../lib/file-risk-scorer.ts";
import {
  buildReviewContinuationTimeoutEstimator,
  resolveReviewTimeoutRetryContext,
} from "./review-timeout-retry-context.ts";

function risk(filePath: string, score: number): FileRiskScore {
  return {
    filePath,
    score,
    breakdown: {
      linesChanged: 0,
      pathRisk: 0,
      fileCategory: 0,
      languageRisk: 0,
      fileExtension: 0,
    },
  };
}

function checkpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "review-key",
    repo: "acme/repo",
    prNumber: 42,
    filesReviewed: ["src/a.ts"],
    findingCount: 0,
    summaryDraft: "Partial summary.",
    totalFiles: 3,
    ...overrides,
  };
}

function boundedFirstPass(overrides: Partial<ReviewFirstPassPayload> = {}): ReviewFirstPassPayload {
  return {
    state: "bounded-first-pass",
    boundedReason: "timeout",
    evidenceSource: "checkpoint",
    coveredScope: { reviewedFiles: 1, totalFiles: 3 },
    remainingScope: { remainingFiles: 2, totalFiles: 3 },
    publication: { eligible: true, hasPublishedOutput: false },
    continuationPending: true,
    zeroEvidenceFailure: false,
    ...overrides,
  };
}

function zeroEvidenceFirstPass(): ReviewFirstPassPayload {
  return {
    state: "zero-evidence-failure",
    boundedReason: "timeout",
    evidenceSource: "none",
    publication: { eligible: false, hasPublishedOutput: false },
    continuationPending: false,
    zeroEvidenceFailure: true,
  };
}

describe("resolveReviewTimeoutRetryContext", () => {
  test("builds continuation timeout estimates from reduced-scope file stats", () => {
    const estimate = buildReviewContinuationTimeoutEstimator({
      perFileStats: new Map([
        ["src/a.ts", { added: 20, removed: 5 }],
        ["src/b.ts", { added: 10, removed: 3 }],
        ["src/ignored.ts", { added: 999, removed: 999 }],
      ]),
      languageComplexity: 0.4,
    });

    const result = estimate({
      timeoutSeconds: 120,
      files: ["src/a.ts", "src/missing.ts", "src/b.ts"],
    });

    expect(result.reasoning).toContain("files: 3");
    expect(result.reasoning).toContain("lines: 38");
  });

  test("maps scheduled continuation plans to retry state and summary note", () => {
    const context = resolveReviewTimeoutRetryContext({
      reviewOutputKey: "review-key",
      timeoutFirstPass: boundedFirstPass(),
      checkpoint: checkpoint(),
      riskScores: [
        risk("src/a.ts", 10),
        risk("src/b.ts", 90),
        risk("src/c.ts", 40),
      ],
      timeoutDurationSeconds: 120,
      hasPublishedInlines: false,
      isChronicTimeout: false,
      timeoutReviewedFiles: ["src/a.ts"],
      timeoutTotalFiles: 3,
      checkpointPersistenceUnavailableForFamilyState: false,
      forceCheckpointEnabled: false,
      estimateContinuationTimeout: ({ files }) => ({
        riskLevel: files.length > 1 ? "medium" : "low",
        dynamicTimeoutSeconds: 45,
        reasoning: "test estimate",
        shouldReduceScope: false,
      }),
    });

    expect(context.retryState).toBe("scheduled reduced-scope retry");
    expect(context.retrySummaryNote).toBe("Scheduling a reduced-scope retry.");
    expect(context.retryPlan?.decision).toBe("schedule-continuation");
    if (context.retryPlan?.decision !== "schedule-continuation") {
      throw new Error("expected scheduled continuation");
    }
    expect(context.retryPlan.continuationFiles).toEqual(["src/b.ts", "src/c.ts"]);
    expect(context.retryPlan.timeoutSeconds).toBe(45);
  });

  test("preserves inline-output skip reason as visible retry note", () => {
    const context = resolveReviewTimeoutRetryContext({
      reviewOutputKey: "review-key",
      timeoutFirstPass: boundedFirstPass({
        publication: { eligible: true, hasPublishedOutput: true },
      }),
      checkpoint: checkpoint(),
      riskScores: [risk("src/a.ts", 10), risk("src/b.ts", 90)],
      timeoutDurationSeconds: 120,
      hasPublishedInlines: true,
      isChronicTimeout: false,
      timeoutReviewedFiles: ["src/a.ts"],
      timeoutTotalFiles: 2,
      checkpointPersistenceUnavailableForFamilyState: false,
      forceCheckpointEnabled: false,
      estimateContinuationTimeout: () => {
        throw new Error("should not estimate skipped retries");
      },
    });

    expect(context.timeoutFirstPass).not.toBeNull();
    if (!context.timeoutFirstPass) {
      throw new Error("expected timeout first pass");
    }
    expect(context.retryPlan).toEqual({
      decision: "skip-continuation",
      reason: "inline-output-already-published",
      reviewOutputKey: "review-key",
      firstPass: context.timeoutFirstPass,
    });
    expect(context.retryState).toBe("not scheduled (GitHub-visible findings already posted)");
    expect(context.retrySummaryNote).toBe("Retry not scheduled because GitHub-visible findings were already posted.");
  });

  test("schedules zero-evidence fallback retries when persistence and remaining scope exist", () => {
    const context = resolveReviewTimeoutRetryContext({
      reviewOutputKey: "review-key",
      timeoutFirstPass: zeroEvidenceFirstPass(),
      checkpoint: null,
      riskScores: [risk("src/a.ts", 10), risk("src/b.ts", 90)],
      timeoutDurationSeconds: 80,
      hasPublishedInlines: false,
      isChronicTimeout: false,
      timeoutReviewedFiles: [],
      timeoutTotalFiles: 2,
      checkpointPersistenceUnavailableForFamilyState: false,
      forceCheckpointEnabled: true,
      estimateContinuationTimeout: ({ timeoutSeconds, files }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds + files.length,
        totalTimeoutSeconds: 222,
        reasoning: "test estimate",
        shouldReduceScope: false,
      }),
    });

    expect(context.retryState).toBe("scheduled reduced-scope retry");
    expect(context.retrySummaryNote).toBe("Scheduling a reduced-scope retry.");
    expect(context.retryPlan).toMatchObject({
      decision: "schedule-continuation",
      reason: "remaining-scope-available",
      continuationReviewOutputKey: "review-key-retry-1",
      continuationFiles: ["src/b.ts", "src/a.ts"],
      checkpointEnabled: true,
      timeoutSeconds: 222,
    });
  });
});
