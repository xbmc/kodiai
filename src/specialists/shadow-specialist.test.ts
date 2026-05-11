import { describe, expect, test } from "bun:test";

import {
  classifyDocsConfigTruthTrigger,
  DOCS_CONFIG_TRUTH_LANE_ID,
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
