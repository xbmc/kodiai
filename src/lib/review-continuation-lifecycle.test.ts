import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { FileRiskScore } from "./file-risk-scorer.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";

async function loadLifecycleModule() {
  return await import("./review-continuation-lifecycle.ts").catch(() => null);
}

function makeRiskScores(entries: Array<[string, number]>): FileRiskScore[] {
  return entries.map(([filePath, score]) => ({
    filePath,
    score,
    breakdown: {
      linesChanged: 0,
      pathRisk: 0,
      fileCategory: 0,
      languageRisk: 0,
      fileExtension: 0,
    },
  }));
}

function makeFirstPass(overrides: Partial<ReviewFirstPassPayload> = {}): ReviewFirstPassPayload {
  return {
    state: "bounded-first-pass",
    boundedReason: "timeout",
    evidenceSource: "checkpoint",
    coveredScope: {
      reviewedFiles: 2,
      totalFiles: 4,
    },
    remainingScope: {
      remainingFiles: 2,
      totalFiles: 4,
    },
    findingCount: 1,
    publication: {
      eligible: true,
      hasPublishedOutput: false,
    },
    continuationPending: true,
    zeroEvidenceFailure: false,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "review-123",
    repo: "owner/repo",
    prNumber: 42,
    filesReviewed: ["src/a.ts", "src/b.ts"],
    findingCount: 1,
    summaryDraft: "Partial review draft",
    totalFiles: 4,
    ...overrides,
  };
}

describe("planReviewContinuation", () => {
  test("plans a single continuation from bounded first-pass evidence and preserves base lifecycle identity", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass(),
      checkpoint: makeCheckpoint(),
      riskScores: makeRiskScores([
        ["src/a.ts", 10],
        ["src/b.ts", 20],
        ["src/c.ts", 90],
        ["src/d.ts", 70],
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      estimateContinuationTimeout: ({ timeoutSeconds, files }) => ({
        riskLevel: "medium",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: `${files.length} files`,
        shouldReduceScope: true,
      }),
    });

    expect(decision).toEqual({
      decision: "schedule-continuation",
      reason: "remaining-scope-available",
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      continuationNumber: 1,
      continuationFiles: ["src/c.ts", "src/d.ts"],
      scopeRatio: 0.75,
      timeoutSeconds: 60,
      checkpointEnabled: true,
      timeoutEstimate: {
        riskLevel: "medium",
        dynamicTimeoutSeconds: 60,
        reasoning: "2 files",
        shouldReduceScope: true,
      },
      firstPass: makeFirstPass(),
      checkpoint: makeCheckpoint(),
    });
  });

  test("suppresses continuation planning for zero-evidence failures", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: {
        state: "zero-evidence-failure",
        boundedReason: "timeout",
        evidenceSource: "none",
        publication: {
          eligible: false,
          hasPublishedOutput: false,
        },
        continuationPending: false,
        zeroEvidenceFailure: true,
      },
      checkpoint: null,
      riskScores: makeRiskScores([["src/a.ts", 10]]),
      timeoutSeconds: 90,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision).toEqual({
      decision: "skip-continuation",
      reason: "zero-evidence-failure",
      reviewOutputKey: "review-123",
      firstPass: {
        state: "zero-evidence-failure",
        boundedReason: "timeout",
        evidenceSource: "none",
        publication: {
          eligible: false,
          hasPublishedOutput: false,
        },
        continuationPending: false,
        zeroEvidenceFailure: true,
      },
    });
  });

  test("suppresses continuation planning when inline output is already published", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass({
        publication: {
          eligible: true,
          hasPublishedOutput: true,
        },
      }),
      checkpoint: makeCheckpoint(),
      riskScores: makeRiskScores([["src/c.ts", 90], ["src/d.ts", 70]]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: true,
      isChronicTimeout: false,
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision).toEqual({
      decision: "skip-continuation",
      reason: "inline-output-already-published",
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass({
        publication: {
          eligible: true,
          hasPublishedOutput: true,
        },
      }),
    });
  });

  test("suppresses continuation planning when checkpoint scope is malformed", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass({
        coveredScope: undefined,
        remainingScope: undefined,
      }),
      checkpoint: makeCheckpoint({
        filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts"],
        totalFiles: 2,
      }),
      riskScores: makeRiskScores([["src/c.ts", 90]]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision).toEqual({
      decision: "skip-continuation",
      reason: "invalid-checkpoint-scope",
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass({
        coveredScope: undefined,
        remainingScope: undefined,
      }),
    });
  });

  test("suppresses continuation planning when no files remain", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass({
        coveredScope: {
          reviewedFiles: 4,
          totalFiles: 4,
        },
        remainingScope: {
          remainingFiles: 0,
          totalFiles: 4,
        },
      }),
      checkpoint: makeCheckpoint({
        filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      }),
      riskScores: makeRiskScores([
        ["src/a.ts", 10],
        ["src/b.ts", 20],
        ["src/c.ts", 30],
        ["src/d.ts", 40],
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision).toEqual({
      decision: "skip-continuation",
      reason: "no-remaining-scope",
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass({
        coveredScope: {
          reviewedFiles: 4,
          totalFiles: 4,
        },
        remainingScope: {
          remainingFiles: 0,
          totalFiles: 4,
        },
      }),
    });
  });

  test("suppresses continuation planning on chronic timeout", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass(),
      checkpoint: makeCheckpoint(),
      riskScores: makeRiskScores([["src/c.ts", 90], ["src/d.ts", 70]]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: true,
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision).toEqual({
      decision: "skip-continuation",
      reason: "chronic-timeout",
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass(),
    });
  });

  test("rejects missing base review output identity", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    expect(() =>
      mod!.planReviewContinuation({
        reviewOutputKey: "",
        firstPass: makeFirstPass(),
        checkpoint: makeCheckpoint(),
        riskScores: makeRiskScores([["src/c.ts", 90]]),
        timeoutSeconds: 120,
        hasPublishedInlineFindings: false,
        isChronicTimeout: false,
        estimateContinuationTimeout: ({ timeoutSeconds }) => ({
          riskLevel: "low",
          dynamicTimeoutSeconds: timeoutSeconds,
          reasoning: "ok",
          shouldReduceScope: false,
        }),
      }),
    ).toThrow("reviewOutputKey");
  });

  test("rejects empty planned continuation scope", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    expect(() =>
      mod!.planReviewContinuation({
        reviewOutputKey: "review-123",
        firstPass: makeFirstPass({
          remainingScope: {
            remainingFiles: 1,
            totalFiles: 4,
          },
        }),
        checkpoint: makeCheckpoint(),
        riskScores: makeRiskScores([
          ["src/a.ts", 10],
          ["src/b.ts", 20],
        ]),
        timeoutSeconds: 120,
        hasPublishedInlineFindings: false,
        isChronicTimeout: false,
        estimateContinuationTimeout: ({ timeoutSeconds }) => ({
          riskLevel: "low",
          dynamicTimeoutSeconds: timeoutSeconds,
          reasoning: "ok",
          shouldReduceScope: false,
        }),
      }),
    ).toThrow("continuation files");
  });
});

describe("settleReviewContinuation", () => {
  test("classifies continuation as merge-ready when it adds reviewed files and findings", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const settlement = mod!.settleReviewContinuation({
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      baseCheckpoint: makeCheckpoint(),
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: "review-123-retry-1",
        filesReviewed: ["src/c.ts", "src/d.ts"],
        findingCount: 3,
        summaryDraft: "Continuation draft",
      }),
      continuationPublished: false,
    });

    expect(settlement).toEqual({
      decision: "merge-continuation",
      reason: "new-structured-results",
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      mergedCheckpoint: {
        reviewOutputKey: "review-123",
        repo: "owner/repo",
        prNumber: 42,
        filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        findingCount: 3,
        summaryDraft: "Continuation draft",
        totalFiles: 4,
      },
      cleanupReviewOutputKeys: ["review-123", "review-123-retry-1"],
    });
  });

  test("settles with no update when continuation produces no delta", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const settlement = mod!.settleReviewContinuation({
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      baseCheckpoint: makeCheckpoint(),
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: "review-123-retry-1",
        filesReviewed: ["src/a.ts", "src/b.ts"],
        findingCount: 0,
        summaryDraft: "No delta",
      }),
      continuationPublished: false,
    });

    expect(settlement).toEqual({
      decision: "settle-without-update",
      reason: "no-new-results",
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      cleanupReviewOutputKeys: ["review-123", "review-123-retry-1"],
    });
  });

  test("treats published continuation output as merge-ready even without checkpoint findings", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const settlement = mod!.settleReviewContinuation({
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      baseCheckpoint: makeCheckpoint(),
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: "review-123-retry-1",
        filesReviewed: ["src/c.ts"],
        findingCount: 0,
        summaryDraft: "No saved findings",
      }),
      continuationPublished: true,
    });

    expect(settlement.decision).toBe("merge-continuation");
    expect(settlement.reason).toBe("inline-results-published");
  });

  test("rejects inconsistent merge inputs", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    expect(() =>
      mod!.settleReviewContinuation({
        reviewOutputKey: "review-123",
        continuationReviewOutputKey: "review-123-retry-1",
        baseCheckpoint: null,
        continuationCheckpoint: makeCheckpoint({
          reviewOutputKey: "review-123-retry-1",
        }),
        continuationPublished: false,
      }),
    ).toThrow("base checkpoint");
  });
});
