import { describe, expect, test } from "bun:test";
import {
  classifyAddonCheckOutcome,
  type AddonCheckClassificationInput,
  type AddonCheckClassificationMode,
} from "./addon-check-classification.ts";

function classify(overrides: Partial<AddonCheckClassificationInput> = {}) {
  return classifyAddonCheckOutcome({
    deliveryId: "delivery-123",
    repo: "xbmc/repo-plugins",
    prNumber: 42,
    timeBudgetMs: 240_000,
    ...overrides,
  });
}

function expectNoRawProjection(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("delivery-123");
  expect(serialized).not.toContain("xbmc/repo-plugins");
  expect(serialized).not.toContain("plugin.video.example");
  expect(serialized).not.toContain("/home/keith/workspace");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("sk-live-secret-token");
  expect(serialized).not.toContain("BEGIN CHECKER");
}

describe("classifyAddonCheckOutcome", () => {
  test.each([
    [
      "all-timeout",
      { addonCount: 3, completedCount: 0, timedOutCount: 3, toolNotFoundCount: 0 },
      "all-timeout",
      "actionable-diagnostic",
      true,
      ["all-timeout"],
    ],
    [
      "partial-timeout with findings",
      {
        addons: [
          { completed: true, findingCount: 2, errorCount: 1, warningCount: 1 },
          { timedOut: true },
          { completed: true, findings: [{ level: "WARN" }, { level: "INFO" }] },
        ],
      },
      "partial-timeout",
      "actionable-diagnostic",
      true,
      ["partial-timeout", "findings-present"],
    ],
    [
      "tool-unavailable",
      { addonCount: 2, completedCount: 0, timedOutCount: 0, toolNotFoundCount: 2 },
      "tool-unavailable",
      "expected-bounded-outcome",
      false,
      ["tool-unavailable"],
    ],
    [
      "completed clean",
      { addonCount: 2, completedCount: 2, timedOutCount: 0, toolNotFoundCount: 0, findingCount: 0 },
      "completed-clean",
      "expected-bounded-outcome",
      false,
      ["completed-clean"],
    ],
    [
      "empty addon list",
      { addons: [] },
      "no-addons",
      "expected-bounded-outcome",
      false,
      ["no-addons"],
    ],
    [
      "mixed incomplete",
      { addonCount: 3, completedCount: 1, timedOutCount: 0, toolNotFoundCount: 1 },
      "mixed-incomplete",
      "actionable-diagnostic",
      true,
      ["mixed-incomplete"],
    ],
  ] satisfies Array<[
    string,
    Partial<AddonCheckClassificationInput>,
    AddonCheckClassificationMode,
    string,
    boolean,
    string[],
  ]>)("classifies %s", (_name, input, mode, classification, actionableDiagnostic, reasonCodes) => {
    const result = classify(input);

    expect(result.gate).toBe("addon-check-classification");
    expect(result.mode).toBe(mode);
    expect(result.classification).toBe(classification);
    expect(result.actionableDiagnostic).toBe(actionableDiagnostic);
    expect(result.expectedBoundedOutcome).toBe(true);
    for (const reasonCode of reasonCodes) {
      expect(result.reasonCodes).toContain(reasonCode);
    }
    expect(result.redaction).toMatchObject({
      rawCheckerOutputOmitted: true,
      workspacePathsOmitted: true,
      githubPayloadOmitted: true,
      addonIdentifiersOmitted: true,
      rawCanaryDetected: false,
    });
    expectNoRawProjection(result);
  });

  test("derives bounded counts from summaries without exposing addon identifiers or finding messages", () => {
    const result = classify({
      addons: [
        {
          completed: true,
          findings: [
            { level: "ERROR", addonId: "plugin.video.example", message: "raw detail omitted" },
            { level: "WARN", addonId: "plugin.video.example", message: "raw detail omitted" },
          ],
        },
        { completed: true, findingCount: 1, errorCount: 1, warningCount: 0 },
      ],
    });

    expect(result.counts).toEqual({
      addonCount: 2,
      completedCount: 2,
      timedOutCount: 0,
      toolNotFoundCount: 0,
      findingCount: 3,
      errorCount: 2,
      warningCount: 1,
      timeBudgetMs: 240000,
    });
    expect(result.mode).toBe("completed-with-findings");
    expect(JSON.stringify(result)).not.toContain("raw detail omitted");
  });

  test("caps huge counts and does not create raw addon arrays at 10x load", () => {
    const result = classify({
      addonCount: 999_999,
      completedCount: 999_998,
      timedOutCount: 50_000,
      toolNotFoundCount: 20_000,
      findingCount: 42_000,
      errorCount: 41_000,
      warningCount: 40_000,
      timeBudgetMs: 9_999_999,
    });

    expect(result.counts).toEqual({
      addonCount: 10000,
      completedCount: 10000,
      timedOutCount: 10000,
      toolNotFoundCount: 10000,
      findingCount: 10000,
      errorCount: 10000,
      warningCount: 10000,
      timeBudgetMs: 3600000,
    });
    expect(Object.keys(result.counts).sort()).toEqual([
      "addonCount",
      "completedCount",
      "errorCount",
      "findingCount",
      "timeBudgetMs",
      "timedOutCount",
      "toolNotFoundCount",
      "warningCount",
    ]);
    expect(JSON.stringify(result)).not.toContain("addons");
  });

  test.each([
    ["unsafe reason token", { evidence: { mode: "partial-timeout", reasonCodes: ["partial-timeout", "diff --git TOKEN=abc123"] } }],
    ["raw canary keys", { evidence: { mode: "partial-timeout", reasonCodes: ["partial-timeout"], rawCheckerOutput: "BEGIN CHECKER diff --git sk-live-secret-token" } }],
    ["raw canary values", { addons: [{ completed: true, findingCount: 1, note: "/home/keith/workspace/plugin.video.example" }] }],
    ["negative counts", { addonCount: -1, completedCount: 0 }],
    ["empty reason fallback", { evidence: { mode: "completed-clean", reasonCodes: [] } }],
    ["malformed summaries", { addons: { plugin: { timedOut: true } } }],
  ])("fails closed for Q7 negative case: %s", (_name, input) => {
    const result = classify(input);

    expect(result.mode).toBe("unknown-malformed-evidence");
    expect(result.classification).toBe("unknown");
    expect(result.expectedBoundedOutcome).toBe(false);
    expect(result.actionableDiagnostic).toBe(false);
    expect(result.reasonCodes).toContain("safe-degraded");
    expect(result.redaction.rawCheckerOutputOmitted).toBe(true);
    expect(result.redaction.workspacePathsOmitted).toBe(true);
    expect(result.redaction.githubPayloadOmitted).toBe(true);
    expect(result.redaction.unsafeInputOmitted).toBe(true);
    expectNoRawProjection(result);
  });

  test("keeps evidence reason overrides only when closed-vocabulary, non-empty, and bounded", () => {
    const result = classify({
      addonCount: 1,
      completedCount: 1,
      findingCount: 0,
      evidence: { mode: "completed-clean", reasonCodes: ["completed-clean", "completed-clean"] },
    });

    expect(result.mode).toBe("completed-clean");
    expect(result.reasonCodes).toEqual(["completed-clean"]);
    expect(result.redaction.boundedReasonCodes).toBe(true);
  });

  test("fails closed when evidence reason arrays are oversized", () => {
    const result = classify({
      evidence: {
        mode: "completed-clean",
        reasonCodes: Array.from({ length: 40 }, () => "completed-clean"),
      },
    });

    expect(result.mode).toBe("unknown-malformed-evidence");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["unbounded-reason-codes", "safe-degraded"]));
    expect(result.redaction.boundedReasonCodes).toBe(false);
  });
});
