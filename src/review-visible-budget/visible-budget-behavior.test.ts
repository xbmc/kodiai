import { describe, expect, test } from "bun:test";

import {
  aggregateVisibleBudgetProjections,
  buildReviewDetailsBudgetLines,
  buildVisibleBudgetProjection,
  evaluateVisibleBudgetFixture,
  type VisibleBudgetProjection,
} from "./visible-budget-behavior.ts";

const HAPPY_PATH_PROJECTION: VisibleBudgetProjection = buildVisibleBudgetProjection({
  scenario: "happy-path",
  promptBudgetEvidence: [
    {
      caseId: "normal-review",
      deliveryId: "delivery-budget-happy",
      repo: "octo/example",
      taskType: "review",
      promptKind: "system",
      sections: [
        {
          sectionName: "persona",
          sectionPosition: 0,
          budgetChars: 600,
          budgetTokens: 150,
          includedChars: 400,
          includedTokens: 100,
          trimmedChars: 0,
          trimmedTokens: 0,
          budgetStatus: "included",
          budgetReason: "within-budget",
        },
      ],
    },
  ],
  cacheTelemetryObservations: [
    {
      cacheSurface: "review-derived-prompt",
      status: "hit",
      reason: "safe-reuse",
      deliveryId: "delivery-cache-happy",
      repo: "octo/example",
      fingerprintVersion: "review-cache-fp-v1",
      safetySignalNames: ["base-ref"],
    },
  ],
  continuationCompactionObservations: [],
});

function fixtureWith(projections: readonly VisibleBudgetProjection[]): Record<string, unknown> {
  return {
    generatedAt: "2026-05-18T05:00:00.000Z",
    visibleBudgetProjections: projections,
    visibleBudgetSummary: aggregateVisibleBudgetProjections(projections),
  };
}

describe("visible budget behavior contract", () => {
  test("builds a happy-path Review Details projection from bounded statuses and counts only", () => {
    expect(HAPPY_PATH_PROJECTION).toMatchObject({
      scenario: "happy-path",
      visibleStatus: "complete",
      visibleReason: "within-budget",
      promptBudget: {
        observationCount: 1,
        sectionCount: 1,
        statusCounts: { included: 1, trimmed: 0, bypassed: 0 },
        reasonCounts: { "within-budget": 1, "section-over-budget": 0, "zero-budget": 0 },
        totalTrimmedTokens: 0,
      },
      cache: {
        observationCount: 1,
        statusCounts: { hit: 1, miss: 0, degraded: 0, bypass: 0 },
        reasonCounts: { "safe-reuse": 1 },
      },
      continuation: {
        observationCount: 0,
        statusCounts: { compacted: 0, fallback: 0, degraded: 0, bypass: 0 },
      },
    });

    expect(JSON.stringify(HAPPY_PATH_PROJECTION)).not.toContain("delivery-budget-happy");
    expect(JSON.stringify(HAPPY_PATH_PROJECTION)).not.toContain("octo/example");
  });

  test("marks scoped review when prompt sections are trimmed or bypassed", () => {
    const projection = buildVisibleBudgetProjection({
      scenario: "scoped-review",
      promptBudgetEvidence: [
        {
          caseId: "large-review",
          deliveryId: "delivery-budget-scoped",
          repo: "octo/example",
          taskType: "review",
          promptKind: "user",
          sections: [
            {
              sectionName: "changed-files-summary",
              sectionPosition: 0,
              budgetChars: 1200,
              budgetTokens: 300,
              includedChars: 1200,
              includedTokens: 300,
              trimmedChars: 600,
              trimmedTokens: 150,
              budgetStatus: "trimmed",
              budgetReason: "section-over-budget",
            },
            {
              sectionName: "retrieval-context",
              sectionPosition: 1,
              budgetChars: 0,
              budgetTokens: 0,
              includedChars: 0,
              includedTokens: 0,
              trimmedChars: 0,
              trimmedTokens: 0,
              budgetStatus: "bypassed",
              budgetReason: "zero-budget",
            },
          ],
        },
      ],
      cacheTelemetryObservations: [
        {
          cacheSurface: "retrieval-query-embedding",
          status: "miss",
          reason: "cache-miss",
          deliveryId: "delivery-cache-scoped",
          repo: "octo/example",
        },
      ],
      continuationCompactionObservations: [],
    });

    expect(projection.visibleStatus).toBe("scoped");
    expect(projection.visibleReason).toBe("prompt-budget-limited");
    expect(projection.promptBudget.statusCounts.trimmed).toBe(1);
    expect(projection.promptBudget.statusCounts.bypassed).toBe(1);
    expect(projection.promptBudget.totalTrimmedTokens).toBe(150);
  });

  test("marks fallback review when continuation compaction fails closed", () => {
    const projection = buildVisibleBudgetProjection({
      scenario: "fallback-review",
      promptBudgetEvidence: [],
      cacheTelemetryObservations: [
        {
          cacheSurface: "review-derived-prompt",
          status: "bypass",
          reason: "disabled-cache",
          deliveryId: "delivery-cache-fallback",
          repo: "octo/example",
        },
      ],
      continuationCompactionObservations: [
        {
          caseId: "missing-checkpoint",
          deliveryId: "delivery-continuation-fallback",
          repo: "octo/example",
          attemptId: "attempt-001",
          attemptOrdinal: 1,
          status: "fallback",
          reason: "missing-checkpoint",
          fallbackState: "fuller-context",
          includedDeltaCount: 5,
          reusedCheckpointCount: 0,
          omittedScopeCount: 0,
          remainingScopeCount: 5,
          missingSignalNames: ["checkpoint.summary"],
        },
      ],
    });

    expect(projection.visibleStatus).toBe("fallback");
    expect(projection.visibleReason).toBe("continuation-fallback");
    expect(projection.continuation.statusCounts.fallback).toBe(1);
    expect(projection.continuation.fallbackStateCounts["fuller-context"]).toBe(1);
    expect(projection.continuation.missingSignalCount).toBe(1);
  });

  test("renders bounded Review Details lines from projection counts", () => {
    const lines = buildReviewDetailsBudgetLines(HAPPY_PATH_PROJECTION);

    expect(lines).toEqual([
      "Budget behavior: complete (within-budget).",
      "Prompt budget: 1 sections, 0 trimmed, 0 bypassed, 0 trimmed tokens.",
      "Cache behavior: 1 observations, 1 hits, 0 misses, 0 degraded, 0 bypassed.",
      "Continuation behavior: 0 observations, 0 compacted, 0 fallback, 0 degraded, 0 bypassed.",
    ]);
  });

  test("passes a fixture with happy-path, scoped-review, and fallback-review coverage", () => {
    const scoped = buildVisibleBudgetProjection({
      scenario: "scoped-review",
      promptBudgetEvidence: [
        {
          caseId: "scoped",
          deliveryId: "delivery-scoped",
          repo: "octo/example",
          taskType: "review",
          promptKind: "user",
          sections: [
            {
              sectionName: "code-context",
              sectionPosition: 0,
              budgetChars: 10,
              budgetTokens: 3,
              includedChars: 10,
              includedTokens: 3,
              trimmedChars: 20,
              trimmedTokens: 5,
              budgetStatus: "trimmed",
              budgetReason: "section-over-budget",
            },
          ],
        },
      ],
      cacheTelemetryObservations: [],
      continuationCompactionObservations: [],
    });
    const fallback = buildVisibleBudgetProjection({
      scenario: "fallback-review",
      promptBudgetEvidence: [],
      cacheTelemetryObservations: [],
      continuationCompactionObservations: [
        {
          caseId: "missing-budget-signal",
          deliveryId: "delivery-fallback",
          repo: "octo/example",
          attemptId: "attempt-001",
          status: "fallback",
          reason: "missing-budget-signal",
          fallbackState: "fuller-context",
          includedDeltaCount: 9,
          reusedCheckpointCount: 0,
          omittedScopeCount: 0,
          remainingScopeCount: 9,
          missingSignalNames: ["prompt-budget-outcomes"],
        },
      ],
    });

    const evaluation = evaluateVisibleBudgetFixture(fixtureWith([HAPPY_PATH_PROJECTION, scoped, fallback]));

    expect(evaluation.status).toBe("pass");
    expect(evaluation.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "projection-cases.present",
      "scenario-coverage.present",
      "vocabulary.bounded",
      "projection-safety.valid",
      "totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails impossible projection vocabulary and status/reason combinations", () => {
    const unsafeProjection = {
      ...HAPPY_PATH_PROJECTION,
      scenario: "scoped-review",
      visibleStatus: "complete",
      visibleReason: "within-budget",
      promptBudget: {
        ...HAPPY_PATH_PROJECTION.promptBudget,
        statusCounts: { included: 0, trimmed: 1, bypassed: 0 },
        totalTrimmedTokens: 99,
      },
    };
    const evaluation = evaluateVisibleBudgetFixture(fixtureWith([unsafeProjection as never]));
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "projection-safety.valid")?.status).toBe("fail");
    expect(issues).toContain("scoped-review scenario requires scoped status");
    expect(issues).toContain("prompt-budget-limited");
  });

  test("redaction rejects raw prompts, diffs, comments, cache keys, fingerprints, candidates, model output, and secrets without echoing payloads", () => {
    const fixture = fixtureWith([HAPPY_PATH_PROJECTION]);
    fixture.rawPrompt = "PROMPT SHOULD NOT APPEAR";
    fixture.diffHunk = "DIFF SHOULD NOT APPEAR";
    fixture.commentBody = "COMMENT SHOULD NOT APPEAR";
    fixture.cacheKey = "CACHE KEY SHOULD NOT APPEAR";
    fixture.fingerprintHash = "FINGERPRINT SHOULD NOT APPEAR";
    fixture.candidateText = "CANDIDATE SHOULD NOT APPEAR";
    fixture.modelOutput = "MODEL OUTPUT SHOULD NOT APPEAR";
    fixture.token = "github_pat_secret SHOULD NOT APPEAR";

    const evaluation = evaluateVisibleBudgetFixture(fixture);
    const serialized = JSON.stringify(evaluation);

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "redaction.safe")?.status).toBe("fail");
    expect(serialized).toContain("rawPrompt is a forbidden raw-text field");
    expect(serialized).toContain("cacheKey is a forbidden raw-fingerprint field");
    expect(serialized).toContain("fingerprintHash is a forbidden raw-fingerprint field");
    expect(serialized).not.toContain("PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("DIFF SHOULD NOT APPEAR");
    expect(serialized).not.toContain("COMMENT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("CACHE KEY SHOULD NOT APPEAR");
    expect(serialized).not.toContain("FINGERPRINT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("CANDIDATE SHOULD NOT APPEAR");
    expect(serialized).not.toContain("MODEL OUTPUT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("github_pat_secret SHOULD NOT APPEAR");
  });
});
