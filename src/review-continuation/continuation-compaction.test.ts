import { describe, expect, test } from "bun:test";

import {
  aggregateContinuationCompactionObservations,
  evaluateContinuationCompactionFixture,
  type ContinuationCompactionObservation,
} from "./continuation-compaction.ts";

const VALID_OBSERVATIONS: ContinuationCompactionObservation[] = [
  {
    caseId: "safe-retry-delta",
    deliveryId: "delivery-continuation-001",
    repo: "octo/example",
    attemptId: "attempt-002",
    priorAttemptId: "attempt-001",
    attemptOrdinal: 2,
    status: "compacted",
    reason: "safe-delta-reuse",
    fallbackState: "none",
    includedDeltaCount: 3,
    reusedCheckpointCount: 2,
    omittedScopeCount: 8,
    remainingScopeCount: 3,
    safetySignalNames: ["budget-window", "cache-hit-safe", "checkpoint-integrity"],
    budgetSignalNames: ["remaining-token-budget"],
    cacheSignalNames: ["review-derived-prompt"],
  },
  {
    caseId: "missing-budget-signal",
    deliveryId: "delivery-continuation-002",
    repo: "octo/example",
    attemptId: "attempt-001",
    attemptOrdinal: 1,
    status: "fallback",
    reason: "missing-budget-signal",
    fallbackState: "fuller-context",
    includedDeltaCount: 9,
    reusedCheckpointCount: 0,
    omittedScopeCount: 0,
    remainingScopeCount: 9,
    missingSignalNames: ["prompt-budget-outcomes"],
  },
  {
    caseId: "degraded-cache-signal",
    deliveryId: "delivery-continuation-003",
    repo: "octo/example",
    attemptId: "attempt-003",
    priorAttemptId: "attempt-002",
    attemptOrdinal: 3,
    status: "degraded",
    reason: "degraded-cache-signal",
    fallbackState: "partial-context",
    includedDeltaCount: 2,
    reusedCheckpointCount: 1,
    omittedScopeCount: 4,
    remainingScopeCount: 2,
    safetySignalNames: ["budget-window"],
    budgetSignalNames: ["remaining-token-budget"],
    cacheSignalNames: ["retrieval-query-embedding", "cache-ttl"],
  },
  {
    caseId: "no-remaining-scope",
    deliveryId: "delivery-continuation-004",
    repo: "octo/example",
    attemptId: "attempt-001",
    attemptOrdinal: 1,
    status: "bypass",
    reason: "no-remaining-scope",
    fallbackState: "none",
    includedDeltaCount: 0,
    reusedCheckpointCount: 0,
    omittedScopeCount: 0,
    remainingScopeCount: 0,
  },
];

function validFixture(): Record<string, unknown> {
  return {
    generatedAt: "2026-05-18T03:45:00.000Z",
    continuationCompactionObservations: VALID_OBSERVATIONS,
    continuationCompactionSummary: aggregateContinuationCompactionObservations(VALID_OBSERVATIONS),
  };
}

describe("continuation compaction contract", () => {
  test("aggregates deterministic text-free continuation counts", () => {
    const totals = aggregateContinuationCompactionObservations(VALID_OBSERVATIONS);

    expect(totals).toMatchObject({
      observationCount: 4,
      deliveryCount: 4,
      attemptCount: 4,
      statusCounts: { compacted: 1, fallback: 1, degraded: 1, bypass: 1 },
      reasonCounts: {
        "safe-delta-reuse": 1,
        "missing-budget-signal": 1,
        "degraded-cache-signal": 1,
        "no-remaining-scope": 1,
      },
      fallbackStateCounts: { none: 2, "fuller-context": 1, "partial-context": 1 },
      includedDeltaCount: 14,
      reusedCheckpointCount: 3,
      omittedScopeCount: 12,
      remainingScopeCount: 14,
    });
    expect(totals.safetySignalNames).toEqual(["budget-window", "cache-hit-safe", "checkpoint-integrity"]);
    expect(totals.budgetSignalNames).toEqual(["remaining-token-budget"]);
    expect(totals.cacheSignalNames).toEqual(["cache-ttl", "retrieval-query-embedding", "review-derived-prompt"]);
    expect(totals.missingSignalNames).toEqual(["prompt-budget-outcomes"]);
  });

  test("passes compacted, fallback, degraded, and bypass scenarios with declared totals", () => {
    const evaluation = evaluateContinuationCompactionFixture(validFixture());

    expect(evaluation.status).toBe("pass");
    expect(evaluation.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "compaction-observations.present",
      "vocabulary.bounded",
      "attempt-identity.valid",
      "decision-safety.valid",
      "totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails unknown vocabulary and duplicate attempt identity", () => {
    const fixture = validFixture();
    fixture.continuationCompactionObservations = [
      ...VALID_OBSERVATIONS,
      {
        caseId: "bad-vocabulary",
        deliveryId: "delivery-continuation-001",
        repo: "octo/example",
        attemptId: "attempt-002",
        status: "compressed-ish",
        reason: "unsafe-freeform-reason",
        fallbackState: "maybe",
        includedDeltaCount: 0,
        reusedCheckpointCount: 0,
        omittedScopeCount: 0,
        remainingScopeCount: 0,
      },
    ];

    const evaluation = evaluateContinuationCompactionFixture(fixture);
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "vocabulary.bounded")?.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "attempt-identity.valid")?.status).toBe("fail");
    expect(issues).toContain("status is not allowed");
    expect(issues).toContain("reason is not allowed");
    expect(issues).toContain("fallbackState is not allowed");
    expect(issues).toContain("duplicates deliveryId/attemptId");
  });

  test("fails unsafe compacted reuse when checkpoint, budget, or cache safety signals are missing", () => {
    const observations = [
      {
        caseId: "unsafe-compacted",
        deliveryId: "delivery-continuation-unsafe",
        repo: "octo/example",
        attemptId: "attempt-002",
        status: "compacted",
        reason: "safe-delta-reuse",
        fallbackState: "none",
        includedDeltaCount: 1,
        reusedCheckpointCount: 1,
        omittedScopeCount: 0,
        remainingScopeCount: 1,
      },
    ];

    const evaluation = evaluateContinuationCompactionFixture({
      continuationCompactionObservations: observations,
      continuationCompactionSummary: aggregateContinuationCompactionObservations(observations as ContinuationCompactionObservation[]),
    });
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "decision-safety.valid")?.status).toBe("fail");
    expect(issues).toContain("compacted status requires priorAttemptId");
    expect(issues).toContain("safetySignalNames must contain at least one bounded signal name");
    expect(issues).toContain("budgetSignalNames must contain at least one bounded signal name");
    expect(issues).toContain("cacheSignalNames must contain at least one bounded signal name");
  });

  test("fails fallback that reuses checkpoints or omits missing signal names", () => {
    const observations = [
      {
        caseId: "bad-fallback",
        deliveryId: "delivery-continuation-fallback",
        repo: "octo/example",
        attemptId: "attempt-001",
        status: "fallback",
        reason: "missing-checkpoint",
        fallbackState: "partial-context",
        includedDeltaCount: 8,
        reusedCheckpointCount: 1,
        omittedScopeCount: 0,
        remainingScopeCount: 8,
      },
    ];

    const evaluation = evaluateContinuationCompactionFixture({
      continuationCompactionObservations: observations,
      continuationCompactionSummary: aggregateContinuationCompactionObservations(observations as ContinuationCompactionObservation[]),
    });
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(issues).toContain("fallback status requires fallbackState fuller-context");
    expect(issues).toContain("fallback status cannot reuse checkpoints");
    expect(issues).toContain("missing-* fallback reason requires missingSignalNames");
  });

  test("fails impossible totals", () => {
    const fixture = validFixture();
    fixture.continuationCompactionSummary = {
      ...(fixture.continuationCompactionSummary as Record<string, unknown>),
      includedDeltaCount: 999,
    };

    const evaluation = evaluateContinuationCompactionFixture(fixture);
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "totals.deterministic")?.status).toBe("fail");
    expect(issues).toContain("continuationCompactionSummary.includedDeltaCount expected 14 but found 999");
  });

  test("redaction rejects raw prompt text, diff hunks, candidate text, model output, raw fingerprints, and secrets without echoing payloads", () => {
    const fixture = validFixture();
    fixture.promptText = "PROMPT SHOULD NOT APPEAR";
    fixture.diffHunk = "DIFF HUNK SHOULD NOT APPEAR";
    fixture.candidateText = "CANDIDATE SHOULD NOT APPEAR";
    fixture.modelOutput = "MODEL OUTPUT SHOULD NOT APPEAR";
    fixture.rawFingerprint = "FINGERPRINT SHOULD NOT APPEAR";
    fixture.token = "github_pat_secret SHOULD NOT APPEAR";

    const evaluation = evaluateContinuationCompactionFixture(fixture);
    const serialized = JSON.stringify(evaluation);

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "redaction.safe")?.status).toBe("fail");
    expect(serialized).toContain("promptText is a forbidden raw-text field");
    expect(serialized).toContain("diffHunk is a forbidden raw-text field");
    expect(serialized).toContain("candidateText is a forbidden raw-text field");
    expect(serialized).toContain("modelOutput is a forbidden raw-text field");
    expect(serialized).toContain("rawFingerprint is a forbidden raw-fingerprint field");
    expect(serialized).not.toContain("PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("DIFF HUNK SHOULD NOT APPEAR");
    expect(serialized).not.toContain("CANDIDATE SHOULD NOT APPEAR");
    expect(serialized).not.toContain("MODEL OUTPUT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("FINGERPRINT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("github_pat_secret SHOULD NOT APPEAR");
  });
});
