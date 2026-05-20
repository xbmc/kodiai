import { describe, expect, test } from "bun:test";
import {
  classifyReviewTimeoutOutcome,
  type ReviewTimeoutClassificationInput,
  type ReviewTimeoutClassificationMode,
} from "./review-timeout-classification.ts";

function classify(overrides: Partial<ReviewTimeoutClassificationInput> = {}) {
  return classifyReviewTimeoutOutcome({
    reviewOutputKey: "review-output-123",
    deliveryId: "delivery-123",
    ...overrides,
  });
}

describe("classifyReviewTimeoutOutcome", () => {
  test.each([
    [
      "bounded partial timeout",
      {
        outcome: { isTimeout: true },
        firstPass: {
          state: "bounded-first-pass",
          boundedReason: "timeout",
          evidenceSource: "checkpoint",
          coveredScope: { reviewedFiles: 3, totalFiles: 10 },
          inspectedScope: { inspectedFiles: 4, totalFiles: 10 },
          remainingScope: { remainingFiles: 7, totalFiles: 10 },
          findingCount: 2,
          continuationPending: true,
          zeroEvidenceFailure: false,
        },
        checkpoint: { filesReviewed: 3, filesInspected: 4, findingCount: 2, totalFiles: 10 },
      },
      "bounded-partial-timeout",
      false,
      true,
      ["partial-timeout", "checkpoint-present"],
    ],
    [
      "zero evidence hard timeout",
      {
        outcome: { isTimeout: true },
        firstPass: {
          state: "zero-evidence-failure",
          boundedReason: "timeout",
          evidenceSource: "none",
          continuationPending: false,
          zeroEvidenceFailure: true,
        },
      },
      "zero-evidence-hard-timeout",
      true,
      false,
      ["zero-evidence", "timeout"],
    ],
    [
      "max turns continuation",
      {
        outcome: { stopReason: "max_turns" },
        firstPass: {
          state: "bounded-first-pass",
          boundedReason: "max-turns",
          evidenceSource: "checkpoint",
          coveredScope: { reviewedFiles: 8, totalFiles: 12 },
          remainingScope: { remainingFiles: 4, totalFiles: 12 },
          continuationPending: true,
          zeroEvidenceFailure: false,
        },
        retry: { enqueued: true, filesCount: 4, scopeRatio: 0.33, timeoutSeconds: 120, checkpointEnabled: true },
      },
      "max-turns-continuation",
      false,
      true,
      ["max-turns", "continuation-pending"],
    ],
    [
      "chronic timeout skip",
      {
        chronicTimeout: true,
        continuation: { decision: "skip-continuation", reason: "chronic-timeout" },
        recentTimeouts: 6,
      },
      "chronic-timeout-skip",
      true,
      false,
      ["chronic-timeout", "continuation-skipped"],
    ],
    [
      "retry enqueued",
      {
        retry: { enqueued: true, filesCount: 5, scopeRatio: 0.5, timeoutSeconds: 90, checkpointEnabled: true },
      },
      "retry-enqueued",
      false,
      true,
      ["retry-enqueued"],
    ],
    [
      "retry completed",
      {
        retry: { enqueued: true, completed: true, hasResults: true, filesCount: 5 },
      },
      "retry-completed",
      false,
      true,
      ["retry-completed", "retry-has-results"],
    ],
    [
      "retry failed",
      {
        retry: { enqueued: true, failed: true, filesCount: 5 },
      },
      "retry-failed",
      true,
      false,
      ["retry-failed"],
    ],
    [
      "long-run threshold exceeded",
      {
        longRun: { thresholdExceeded: true, durationSeconds: 905, thresholdSeconds: 900 },
      },
      "long-run-threshold-exceeded",
      true,
      false,
      ["long-run-threshold-exceeded"],
    ],
  ] satisfies Array<[
    string,
    Partial<ReviewTimeoutClassificationInput>,
    ReviewTimeoutClassificationMode,
    boolean,
    boolean,
    string[],
  ]>)("classifies %s", (_name, input, mode, hardFailure, expectedBoundedOutcome, reasonCodes) => {
    const result = classify(input);

    expect(result.gate).toBe("review-timeout-classification");
    expect(result.classification).toBe(hardFailure ? "hard-failure" : "expected-bounded-outcome");
    expect(result.mode).toBe(mode);
    expect(result.hardFailure).toBe(hardFailure);
    expect(result.expectedBoundedOutcome).toBe(expectedBoundedOutcome);
    for (const reasonCode of reasonCodes) {
      expect(result.reasonCodes).toContain(reasonCode);
    }
    expect(JSON.stringify(result)).not.toContain("review-output-123");
    expect(JSON.stringify(result)).not.toContain("delivery-123");
  });

  test("returns only bounded count fields and clamps invalid optional counts", () => {
    const result = classify({
      outcome: { isTimeout: true },
      firstPass: {
        state: "bounded-first-pass",
        boundedReason: "timeout",
        evidenceSource: "checkpoint",
        continuationPending: true,
        zeroEvidenceFailure: false,
      },
      checkpoint: {
        filesReviewed: 9,
        filesInspected: Number.POSITIVE_INFINITY,
        findingCount: -1,
        totalFiles: 12,
      },
      retry: {
        enqueued: true,
        filesCount: 999_999,
        scopeRatio: 999,
        timeoutSeconds: Number.NaN,
        attemptCount: 1_000,
      },
      recentTimeouts: 10_000,
      longRun: { thresholdExceeded: false, durationSeconds: 1_000_000, thresholdSeconds: 900 },
    });

    expect(result.counts).toEqual({
      checkpointFilesReviewed: 9,
      checkpointTotalFiles: 12,
      retryFilesCount: 10000,
      retryAttemptCount: 100,
      recentTimeouts: 100,
      longRunDurationSeconds: 86400,
      longRunThresholdSeconds: 900,
    });
    expect(Object.keys(result.counts).sort()).toEqual([
      "checkpointFilesReviewed",
      "checkpointTotalFiles",
      "longRunDurationSeconds",
      "longRunThresholdSeconds",
      "recentTimeouts",
      "retryAttemptCount",
      "retryFilesCount",
    ]);
  });

  test("degrades malformed checkpoint metadata to an explicit safe mode without throwing", () => {
    const result = classify({
      outcome: { isTimeout: true },
      firstPass: {
        state: "bounded-first-pass",
        boundedReason: "timeout",
        evidenceSource: "checkpoint",
        continuationPending: true,
        zeroEvidenceFailure: false,
      },
      checkpoint: { filesReviewed: 20, totalFiles: 10, findingCount: 1 },
    });

    expect(result.mode).toBe("unknown-malformed-evidence");
    expect(result.classification).toBe("hard-failure");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["malformed-checkpoint", "safe-degraded"]));
  });

  test.each([
    ["empty reasons", { mode: "retry-enqueued", reasonCodes: [] }],
    ["unsafe reason token", { mode: "retry-enqueued", reasonCodes: ["retry-enqueued", "diff --git TOKEN=abc123"] }],
    ["unknown mode", { mode: "published-success", reasonCodes: ["retry-enqueued"] }],
    ["unbounded reason array", { mode: "retry-enqueued", reasonCodes: Array.from({ length: 40 }, (_, index) => `retry-${index}`) }],
    ["raw canary keys", { mode: "retry-enqueued", reasonCodes: ["retry-enqueued"], rawPrompt: "BEGIN PROMPT sk-live-secret diff --git" }],
  ])("fails closed for Q7 negative case: %s", (_name, evidence) => {
    const result = classify({ evidence });

    expect(result.mode).toBe("unknown-malformed-evidence");
    expect(result.classification).toBe("hard-failure");
    expect(result.expectedBoundedOutcome).toBe(false);
    expect(result.hardFailure).toBe(true);
    expect(result.reasonCodes).toContain("safe-degraded");
    expect(result.redaction.rawPayloadOmitted).toBe(true);
  });

  test("omits raw payload canaries and unsafe values from the public projection", () => {
    const result = classify({
      evidence: {
        mode: "bounded-partial-timeout",
        reasonCodes: ["partial-timeout", "checkpoint-present"],
        rawModelOutput: "BEGIN PROMPT diff --git sk-live-secret-token",
      },
      retry: {
        enqueued: true,
        riskLevel: "high with TOKEN=abc123 and diff --git",
        files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts", "src/g.ts", "src/h.ts", "src/i.ts"],
      },
    });
    const serialized = JSON.stringify(result);

    expect(result.mode).toBe("unknown-malformed-evidence");
    expect(result.reasonCodes).not.toContain("high with TOKEN=abc123 and diff --git");
    expect(serialized).not.toContain("BEGIN PROMPT");
    expect(serialized).not.toContain("diff --git");
    expect(serialized).not.toContain("sk-live-secret-token");
    expect(serialized).not.toContain("src/a.ts");
  });
});
