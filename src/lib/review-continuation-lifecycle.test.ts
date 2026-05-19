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

  test("adds compact retry evidence when checkpoint, prompt budget, and cache safety signals are complete", async () => {
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
      continuationCompaction: {
        attemptId: "attempt-2",
        priorAttemptId: "attempt-1",
        attemptOrdinal: 2,
        promptBudgetOutcomes: [
          {
            sectionName: "review-change-context",
            sectionPosition: 0,
            budgetChars: 4000,
            budgetTokens: 1000,
            includedChars: 500,
            includedTokens: 125,
            trimmedChars: 0,
            trimmedTokens: 0,
            status: "included",
            reason: "within-budget",
          },
        ],
        cacheTelemetryObservations: [
          {
            cacheSurface: "review-derived-prompt",
            status: "hit",
            reason: "safe-reuse",
            deliveryId: "review-123",
            repo: "owner/repo",
            attemptOrdinal: 2,
            fingerprintVersion: "v1",
            safetySignalNames: ["cache.safe-reuse"],
          },
        ],
      },
      estimateContinuationTimeout: ({ timeoutSeconds, files }) => ({
        riskLevel: "medium",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: `${files.length} files`,
        shouldReduceScope: true,
      }),
    });

    expect(decision.decision).toBe("schedule-continuation");
    if (decision.decision !== "schedule-continuation") throw new Error("expected scheduled continuation");
    expect(decision.continuationCompaction).toEqual({
      caseId: "retry-prompt-compaction",
      deliveryId: "review-123",
      repo: "owner/repo",
      attemptId: "attempt-2",
      priorAttemptId: "attempt-1",
      attemptOrdinal: 2,
      status: "compacted",
      reason: "safe-delta-reuse",
      fallbackState: "none",
      includedDeltaCount: 2,
      reusedCheckpointCount: 1,
      omittedScopeCount: 2,
      remainingScopeCount: 2,
      safetySignalNames: ["cache.safe-reuse", "checkpoint.summary", "prompt-budget.included"],
      budgetSignalNames: ["prompt-budget.included"],
      cacheSignalNames: ["cache.safe-reuse"],
    });
  });

  test("falls back to fuller retry context when prompt budget safety is incomplete", async () => {
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
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      continuationCompaction: {
        attemptId: "attempt-2",
        promptBudgetOutcomes: [
          {
            sectionName: "review-instructions",
            sectionPosition: 0,
            budgetChars: 100,
            budgetTokens: 25,
            includedChars: 100,
            includedTokens: 25,
            trimmedChars: 50,
            trimmedTokens: 13,
            status: "trimmed",
            reason: "section-over-budget",
          },
        ],
        cacheTelemetryObservations: [
          {
            cacheSurface: "review-derived-prompt",
            status: "hit",
            reason: "safe-reuse",
            deliveryId: "review-123",
            repo: "owner/repo",
            fingerprintVersion: "v1",
            safetySignalNames: ["cache.safe-reuse"],
          },
        ],
      },
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision.decision).toBe("schedule-continuation");
    if (decision.decision !== "schedule-continuation") throw new Error("expected scheduled continuation");
    expect(decision.continuationCompaction).toEqual(expect.objectContaining({
      status: "fallback",
      reason: "missing-budget-signal",
      fallbackState: "fuller-context",
      reusedCheckpointCount: 0,
      missingSignalNames: ["prompt-budget.included"],
      budgetSignalNames: ["prompt-budget.trimmed"],
      cacheSignalNames: ["cache.safe-reuse"],
    }));
  });

  test("falls back to fuller retry context when checkpoint evidence is missing", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass(),
      checkpoint: null,
      riskScores: makeRiskScores([
        ["src/a.ts", 10],
        ["src/b.ts", 20],
        ["src/c.ts", 90],
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      continuationCompaction: {
        attemptId: "attempt-2",
        promptBudgetOutcomes: [
          {
            sectionName: "review-change-context",
            sectionPosition: 0,
            budgetChars: 100,
            budgetTokens: 25,
            includedChars: 40,
            includedTokens: 10,
            trimmedChars: 0,
            trimmedTokens: 0,
            status: "included",
            reason: "within-budget",
          },
        ],
        cacheTelemetryObservations: [
          {
            cacheSurface: "review-derived-prompt",
            status: "hit",
            reason: "safe-reuse",
            deliveryId: "review-123",
            repo: "owner/repo",
            fingerprintVersion: "v1",
            safetySignalNames: ["cache.safe-reuse"],
          },
        ],
      },
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision.decision).toBe("schedule-continuation");
    if (decision.decision !== "schedule-continuation") throw new Error("expected scheduled continuation");
    expect(decision.continuationCompaction).toEqual(expect.objectContaining({
      status: "fallback",
      reason: "missing-checkpoint",
      fallbackState: "fuller-context",
      reusedCheckpointCount: 0,
      missingSignalNames: ["checkpoint.summary"],
    }));
  });

  test("falls back to fuller retry context when prior checkpoint summary is malformed", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const decision = mod!.planReviewContinuation({
      reviewOutputKey: "review-123",
      firstPass: makeFirstPass(),
      checkpoint: makeCheckpoint({ summaryDraft: "   " }),
      riskScores: makeRiskScores([
        ["src/a.ts", 10],
        ["src/b.ts", 20],
        ["src/c.ts", 90],
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      continuationCompaction: {
        attemptId: "attempt-2",
        promptBudgetOutcomes: [
          {
            sectionName: "review-change-context",
            sectionPosition: 0,
            budgetChars: 100,
            budgetTokens: 25,
            includedChars: 40,
            includedTokens: 10,
            trimmedChars: 0,
            trimmedTokens: 0,
            status: "included",
            reason: "within-budget",
          },
        ],
        cacheTelemetryObservations: [
          {
            cacheSurface: "review-derived-prompt",
            status: "hit",
            reason: "safe-reuse",
            deliveryId: "review-123",
            repo: "owner/repo",
            fingerprintVersion: "v1",
            safetySignalNames: ["cache.safe-reuse"],
          },
        ],
      },
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision.decision).toBe("schedule-continuation");
    if (decision.decision !== "schedule-continuation") throw new Error("expected scheduled continuation");
    expect(decision.continuationCompaction).toEqual(expect.objectContaining({
      status: "fallback",
      reason: "malformed-prior-state",
      fallbackState: "fuller-context",
      reusedCheckpointCount: 0,
      missingSignalNames: ["checkpoint.summary"],
    }));
  });

  test("marks degraded cache telemetry as partial-context fallback instead of compacting", async () => {
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
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      continuationCompaction: {
        attemptId: "attempt-2",
        promptBudgetOutcomes: [
          {
            sectionName: "review-change-context",
            sectionPosition: 0,
            budgetChars: 100,
            budgetTokens: 25,
            includedChars: 40,
            includedTokens: 10,
            trimmedChars: 0,
            trimmedTokens: 0,
            status: "included",
            reason: "within-budget",
          },
        ],
        cacheTelemetryObservations: [
          {
            cacheSurface: "review-derived-prompt",
            status: "degraded",
            reason: "bookkeeping-failure",
            deliveryId: "review-123",
            repo: "owner/repo",
            bookkeepingErrorCount: 1,
            safetySignalNames: ["cache.safe-reuse"],
          },
        ],
      },
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision.decision).toBe("schedule-continuation");
    if (decision.decision !== "schedule-continuation") throw new Error("expected scheduled continuation");
    expect(decision.continuationCompaction).toEqual(expect.objectContaining({
      status: "degraded",
      reason: "degraded-cache-signal",
      fallbackState: "partial-context",
      reusedCheckpointCount: 1,
      safetySignalNames: ["prompt-budget.included"],
      budgetSignalNames: ["prompt-budget.included"],
      cacheSignalNames: ["cache.bookkeeping-failure", "cache.safe-reuse"],
    }));
  });

  test("falls back to fuller retry context when cache telemetry is bypassed", async () => {
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
      ]),
      timeoutSeconds: 120,
      hasPublishedInlineFindings: false,
      isChronicTimeout: false,
      continuationCompaction: {
        attemptId: "attempt-2",
        promptBudgetOutcomes: [
          {
            sectionName: "review-change-context",
            sectionPosition: 0,
            budgetChars: 100,
            budgetTokens: 25,
            includedChars: 40,
            includedTokens: 10,
            trimmedChars: 0,
            trimmedTokens: 0,
            status: "included",
            reason: "within-budget",
          },
        ],
        cacheTelemetryObservations: [
          {
            cacheSurface: "review-derived-prompt",
            status: "bypass",
            reason: "disabled-cache",
            deliveryId: "review-123",
            repo: "owner/repo",
            missingSignalNames: ["cache.safe-reuse"],
          },
        ],
      },
      estimateContinuationTimeout: ({ timeoutSeconds }) => ({
        riskLevel: "low",
        dynamicTimeoutSeconds: timeoutSeconds,
        reasoning: "ok",
        shouldReduceScope: false,
      }),
    });

    expect(decision.decision).toBe("schedule-continuation");
    if (decision.decision !== "schedule-continuation") throw new Error("expected scheduled continuation");
    expect(decision.continuationCompaction).toEqual(expect.objectContaining({
      status: "fallback",
      reason: "unsafe-cache-state",
      fallbackState: "fuller-context",
      reusedCheckpointCount: 0,
      cacheSignalNames: ["cache.disabled-cache", "cache.safe-reuse"],
    }));
  });

  test("uses the continuation timeout estimate for the scheduled retry budget", async () => {
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
      estimateContinuationTimeout: ({ files }) => ({
        riskLevel: "high",
        dynamicTimeoutSeconds: 45,
        reasoning: `${files.length} files adjusted`,
        shouldReduceScope: true,
      }),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        decision: "schedule-continuation",
        timeoutSeconds: 45,
        timeoutEstimate: expect.objectContaining({
          dynamicTimeoutSeconds: 45,
        }),
      }),
    );
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

  test("rejects invalid timeout budgets before scheduling a continuation", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    expect(() =>
      mod!.planReviewContinuation({
        reviewOutputKey: "review-123",
        firstPass: makeFirstPass(),
        checkpoint: makeCheckpoint(),
        riskScores: makeRiskScores([["src/c.ts", 90]]),
        timeoutSeconds: Number.NaN,
        hasPublishedInlineFindings: false,
        isChronicTimeout: false,
        estimateContinuationTimeout: ({ timeoutSeconds }) => ({
          riskLevel: "low",
          dynamicTimeoutSeconds: timeoutSeconds,
          reasoning: "ok",
          shouldReduceScope: false,
        }),
      }),
    ).toThrow("timeoutSeconds must be a positive finite number");
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

  test("preserves higher base finding counts when continuation checkpoint is attempt-scoped", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const settlement = mod!.settleReviewContinuation({
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      baseCheckpoint: makeCheckpoint({
        findingCount: 3,
      }),
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: "review-123-retry-1",
        filesReviewed: ["src/c.ts"],
        findingCount: 1,
        summaryDraft: "Continuation draft",
      }),
      continuationPublished: false,
    });

    expect(settlement).toEqual(
      expect.objectContaining({
        decision: "merge-continuation",
        mergedCheckpoint: expect.objectContaining({
          findingCount: 3,
          filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts"],
        }),
      }),
    );
  });

  test("prefers the continuation partial comment id when merge settlement has newer comment state", async () => {
    const mod = await loadLifecycleModule();
    expect(mod).not.toBeNull();

    const settlement = mod!.settleReviewContinuation({
      reviewOutputKey: "review-123",
      continuationReviewOutputKey: "review-123-retry-1",
      baseCheckpoint: makeCheckpoint({
        partialCommentId: 2001,
      }),
      continuationCheckpoint: makeCheckpoint({
        reviewOutputKey: "review-123-retry-1",
        filesReviewed: ["src/c.ts"],
        findingCount: 2,
        partialCommentId: 3001,
        summaryDraft: "Continuation draft",
      }),
      continuationPublished: false,
    });

    expect(settlement).toEqual(
      expect.objectContaining({
        decision: "merge-continuation",
        mergedCheckpoint: expect.objectContaining({
          partialCommentId: 3001,
        }),
      }),
    );
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
