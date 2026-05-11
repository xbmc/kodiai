import { describe, expect, test } from "bun:test";

import {
  classifyDocsConfigTruthTrigger,
  DOCS_CONFIG_TRUTH_LANE_ID,
  normalizeShadowSpecialistOutput,
  type ShadowSpecialistTriggerResult,
} from "./shadow-specialist.ts";

function expectShadowOnlyContract(result: ShadowSpecialistTriggerResult): void {
  expect(result.shadowOnly).toBe(true);
  expect(result.publishesFindings).toBe(false);
  expect(result.metrics).toEqual({
    decisionCount: 0,
    duplicateCount: 0,
    disagreementCount: 0,
    tokenCountAvailable: false,
    costAvailable: false,
    latencyMsAvailable: false,
  });
}

describe("classifyDocsConfigTruthTrigger", () => {
  test("triggers exactly one docs-config-truth lane for operator docs paths", () => {
    const result = classifyDocsConfigTruthTrigger({
      changedPaths: ["docs/operators/review-details.md"],
      correlationKey: " delivery-123 ",
    });

    expect(result.status).toBe("triggered");
    expect(result.laneId).toBe(DOCS_CONFIG_TRUTH_LANE_ID);
    expect(result.selectedLaneCount).toBe(1);
    expect(result.skipReason).toBeNull();
    expect(result.degradedReason).toBeNull();
    expect(result.errorKind).toBeNull();
    expect(result.matchedPaths).toEqual(["docs/operators/review-details.md"]);
    expect(result.candidateCount).toBe(1);
    expect(result.correlationKey).toBe("delivery-123");
    expectShadowOnlyContract(result);
  });

  test("triggers for runbooks, config, GitHub workflow config, and operator verifier paths", () => {
    const result = classifyDocsConfigTruthTrigger({
      changedPaths: [
        "runbooks/live-review.md",
        "config/review.yml",
        ".github/workflows/review.yml",
        "scripts/verify-m069-s01.ts",
      ],
    });

    expect(result.status).toBe("triggered");
    expect(result.laneId).toBe(DOCS_CONFIG_TRUTH_LANE_ID);
    expect(result.selectedLaneCount).toBe(1);
    expect(result.skipReason).toBeNull();
    expect(result.matchedPaths).toEqual([
      ".github/workflows/review.yml",
      "config/review.yml",
      "runbooks/live-review.md",
      "scripts/verify-m069-s01.ts",
    ]);
    expect(result.candidateCount).toBe(4);
    expectShadowOnlyContract(result);
  });

  test("skips source-only, test-only, generated, and dependency paths with a bounded reason", () => {
    const result = classifyDocsConfigTruthTrigger({
      changedPaths: [
        "src/handlers/review.ts",
        "src/specialists/shadow-specialist.test.ts",
        "src/generated/schema.ts",
        "bun.lock",
        "package-lock.json",
        "node_modules/example/index.js",
      ],
    });

    expect(result).toMatchObject({
      status: "skipped",
      laneId: null,
      skipReason: "no-operator-truth-paths",
      degradedReason: null,
      errorKind: null,
      matchedPaths: [],
      candidateCount: 0,
      selectedLaneCount: 0,
      correlationKey: null,
    });
    expectShadowOnlyContract(result);
  });

  test("mixed lists still trigger one lane and return only matched operator-truth paths", () => {
    const result = classifyDocsConfigTruthTrigger({
      changedPaths: [
        "src/index.ts",
        "docs/review-details.md",
        "test/fixtures/output.json",
        "scripts/verify-m068-candidate-publication.ts",
      ],
    });

    expect(result.status).toBe("triggered");
    expect(result.laneId).toBe(DOCS_CONFIG_TRUTH_LANE_ID);
    expect(result.selectedLaneCount).toBe(1);
    expect(result.skipReason).toBeNull();
    expect(result.matchedPaths).toEqual([
      "docs/review-details.md",
      "scripts/verify-m068-candidate-publication.ts",
    ]);
    expect(result.candidateCount).toBe(2);
    expectShadowOnlyContract(result);
  });

  test("empty and malformed-only path lists skip without throwing", () => {
    expect(classifyDocsConfigTruthTrigger({ changedPaths: [] })).toMatchObject({
      status: "skipped",
      laneId: null,
      skipReason: "no-changed-paths",
      degradedReason: null,
      errorKind: null,
      matchedPaths: [],
      selectedLaneCount: 0,
    });

    const malformedOnly = classifyDocsConfigTruthTrigger({
      changedPaths: ["", "   ", null, 42, "../docs/runbook.md", "/docs/runbook.md", "C:\\repo\\docs\\runbook.md"],
      correlationKey: "   ",
    });

    expect(malformedOnly).toMatchObject({
      status: "skipped",
      laneId: null,
      skipReason: "no-changed-paths",
      degradedReason: "invalid-paths-ignored",
      errorKind: "invalid-path-input",
      matchedPaths: [],
      candidateCount: 0,
      selectedLaneCount: 0,
      correlationKey: null,
    });
    expectShadowOnlyContract(malformedOnly);
  });

  test("duplicates collapse deterministically and uppercase variants still match", () => {
    const result = classifyDocsConfigTruthTrigger({
      changedPaths: [
        "./DOCS/Runbook.MD",
        "docs/runbook.md",
        "docs/RUNBOOK.md",
        "src/review.ts",
      ],
    });

    expect(result.status).toBe("triggered");
    expect(result.selectedLaneCount).toBe(1);
    expect(result.matchedPaths).toEqual(["DOCS/Runbook.MD"]);
    expect(result.candidateCount).toBe(1);
    expectShadowOnlyContract(result);
  });

  test("invalid paths are bounded diagnostics when valid operator paths are also present", () => {
    const result = classifyDocsConfigTruthTrigger({
      changedPaths: ["/etc/passwd", "docs/operator-guide.md"],
    });

    expect(result.status).toBe("triggered");
    expect(result.laneId).toBe(DOCS_CONFIG_TRUTH_LANE_ID);
    expect(result.degradedReason).toBe("invalid-paths-ignored");
    expect(result.errorKind).toBe("invalid-path-input");
    expect(result.matchedPaths).toEqual(["docs/operator-guide.md"]);
    expectShadowOnlyContract(result);
  });
});

describe("normalizeShadowSpecialistOutput", () => {
  test("normalizes candidate-shaped private records and metric availability", () => {
    const result = normalizeShadowSpecialistOutput({
      status: "ok",
      deliveryId: " delivery-123 ",
      reviewOutputKey: " review-output-456 ",
      correlationKey: " corr-789 ",
      candidates: [
        { fingerprint: "candidate-a", decision: "candidate" },
        { fingerprint: "candidate-b", decision: "dismissed" },
        {
          fingerprint: "candidate-c",
          decision: "disagreement",
          disagreementCategory: "operator-runbook-gap",
        },
      ],
      metrics: {
        tokenCount: 100,
        costUsd: 0.42,
        latencyMs: 1200,
      },
    });

    expect(result).toMatchObject({
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      status: "ok",
      skipReason: null,
      degradedReasons: [],
      errorKind: null,
      candidateCount: 3,
      truncatedCandidateCount: 0,
      decisionCounts: {
        candidate: 1,
        duplicate: 0,
        disagreement: 1,
        dismissed: 1,
        unclassifiable: 0,
      },
      duplicateCount: 0,
      disagreementCount: 1,
      metricAvailability: {
        tokenCount: "available",
        costUsd: "available",
        latencyMs: "available",
      },
      metrics: {
        decisionCount: 3,
        duplicateCount: 0,
        disagreementCount: 1,
        tokenCountAvailable: true,
        costAvailable: true,
        latencyMsAvailable: true,
      },
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-456",
      correlationKey: "corr-789",
      redactionFlags: {
        unsafeFieldCount: 0,
        discardedRawPayload: false,
        discardedPublicationFields: false,
        discardedApprovalFields: false,
      },
      shadowOnly: true,
      publishesFindings: false,
    });
    expect(result.candidates).toEqual([
      {
        fingerprint: "candidate-a",
        decision: "candidate",
        disagreementCategory: null,
        duplicate: false,
        privateOnly: true,
      },
      {
        fingerprint: "candidate-b",
        decision: "dismissed",
        disagreementCategory: null,
        duplicate: false,
        privateOnly: true,
      },
      {
        fingerprint: "candidate-c",
        decision: "disagreement",
        disagreementCategory: "operator-runbook-gap",
        duplicate: false,
        privateOnly: true,
      },
    ]);
  });

  test("maps malformed status and numeric metrics to bounded unavailable diagnostics", () => {
    const result = normalizeShadowSpecialistOutput({
      status: "ship-it",
      candidates: [
        { fingerprint: "a", decision: "candidate" },
        { fingerprint: "b", decision: "mystery" },
      ],
      metrics: {
        tokenCount: -1,
        costUsd: Number.NaN,
        latencyMs: 1.5,
      },
    });

    expect(result.status).toBe("unclassifiable");
    expect(result.degradedReasons).toEqual(["invalid-status"]);
    expect(result.errorKind).toBeNull();
    expect(result.decisionCounts).toEqual({
      candidate: 1,
      duplicate: 0,
      disagreement: 0,
      dismissed: 0,
      unclassifiable: 1,
    });
    expect(result.metricAvailability).toEqual({
      tokenCount: "unavailable",
      costUsd: "unavailable",
      latencyMs: "unavailable",
    });
    expect(result.metrics).toMatchObject({
      tokenCountAvailable: false,
      costAvailable: false,
      latencyMsAvailable: false,
    });
  });

  test("bounds oversized candidate arrays and counts duplicate fingerprints deterministically", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      fingerprint: index === 1 ? "fp-0" : `fp-${index}`,
      decision: "candidate",
    }));

    const result = normalizeShadowSpecialistOutput({
      status: "ok",
      candidates,
    });

    expect(result.status).toBe("degraded");
    expect(result.degradedReasons).toEqual(["candidates-truncated"]);
    expect(result.candidateCount).toBe(25);
    expect(result.truncatedCandidateCount).toBe(5);
    expect(result.duplicateCount).toBe(1);
    expect(result.decisionCounts).toEqual({
      candidate: 24,
      duplicate: 1,
      disagreement: 0,
      dismissed: 0,
      unclassifiable: 0,
    });
    expect(result.candidates[1]).toMatchObject({
      fingerprint: "fp-0",
      decision: "duplicate",
      duplicate: true,
      privateOnly: true,
    });
  });

  test("normalizes disagreement categories without raw model text", () => {
    const result = normalizeShadowSpecialistOutput({
      status: "ok",
      candidates: [
        {
          fingerprint: "known",
          decision: "disagreement",
          disagreementCategory: "docs-config-conflict",
          modelText: "raw specialist prose must not escape",
        },
        {
          fingerprint: "unknown",
          decision: "disagreement",
          disagreementCategory: "novel-category",
        },
      ],
    });

    expect(result.status).toBe("degraded");
    expect(result.degradedReasons).toEqual(["unsafe-fields-discarded"]);
    expect(result.disagreementCount).toBe(2);
    expect(result.candidates).toEqual([
      {
        fingerprint: "known",
        decision: "disagreement",
        disagreementCategory: "docs-config-conflict",
        duplicate: false,
        privateOnly: true,
      },
      {
        fingerprint: "unknown",
        decision: "disagreement",
        disagreementCategory: "unclassifiable",
        duplicate: false,
        privateOnly: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("raw specialist prose");
    expect(result.redactionFlags).toMatchObject({
      unsafeFieldCount: 1,
      discardedRawPayload: true,
      discardedPublicationFields: false,
      discardedApprovalFields: false,
    });
  });

  test("discards raw payload and publication-looking fields into private redaction flags", () => {
    const result = normalizeShadowSpecialistOutput({
      status: "ok",
      prompt: "raw prompt",
      toolPayload: { secret: "tool output" },
      candidates: [
        {
          fingerprint: "unsafe",
          decision: "candidate",
          commentBody: "GitHub-visible body",
          approved: true,
          inlineComment: "publication shaped text",
        },
      ],
    });

    expect(result.status).toBe("degraded");
    expect(result.errorKind).toBe("unsafe-publication-field");
    expect(result.degradedReasons).toEqual(["unsafe-fields-discarded"]);
    expect(result.redactionFlags).toEqual({
      unsafeFieldCount: 5,
      discardedRawPayload: true,
      discardedPublicationFields: true,
      discardedApprovalFields: true,
    });
    expect(result.candidates).toEqual([
      {
        fingerprint: "unsafe",
        decision: "candidate",
        disagreementCategory: null,
        duplicate: false,
        privateOnly: true,
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("tool output");
    expect(serialized).not.toContain("GitHub-visible body");
    expect(serialized).not.toContain("publication shaped text");
    expect(serialized).not.toContain("approved");
  });

  test("invalid candidate shape and skipped outputs become bounded private diagnostics", () => {
    const invalidCandidates = normalizeShadowSpecialistOutput({
      status: "ok",
      candidates: { fingerprint: "not-an-array" },
    });

    expect(invalidCandidates).toMatchObject({
      status: "degraded",
      degradedReasons: ["invalid-candidates"],
      errorKind: "invalid-output-shape",
      candidateCount: 0,
      duplicateCount: 0,
      disagreementCount: 0,
      shadowOnly: true,
      publishesFindings: false,
    });

    const skipped = normalizeShadowSpecialistOutput({
      status: "skipped",
      candidates: [],
    });

    expect(skipped).toMatchObject({
      status: "skipped",
      skipReason: "missing-output",
      candidateCount: 0,
      errorKind: null,
      shadowOnly: true,
      publishesFindings: false,
    });
  });
});
