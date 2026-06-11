import { describe, expect, test } from "bun:test";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import {
  appendReviewDetailsBudgetLines,
  buildPromptBudgetOutcomes,
  buildVisibleBudgetProjectionFromEvidence,
  chooseVisibleBudgetScenario,
} from "./review-visible-budget-evidence.ts";

const samplePromptSectionRecord: PromptSectionRecord = {
  deliveryId: "delivery-1",
  repo: "xbmc/xbmc",
  taskType: "review.full",
  promptKind: "review",
  sections: [{
    sectionName: "changed-files",
    sectionPosition: 1,
    charCount: 500,
    estimatedTokens: 125,
    budgetChars: 1000,
    budgetTokens: 250,
    includedChars: 500,
    includedTokens: 125,
    trimmedChars: 500,
    trimmedTokens: 125,
    budgetStatus: "trimmed",
    budgetReason: "section-over-budget",
  }],
};

describe("chooseVisibleBudgetScenario", () => {
  test("returns scoped-review when prompt sections were trimmed", () => {
    const promptBudgetEvidence = [{
      caseId: "review:budget",
      deliveryId: "delivery-1",
      repo: "xbmc/xbmc",
      taskType: "review.full",
      promptKind: "review",
      sections: [{
        sectionName: "changed-files",
        sectionPosition: 1,
        charCount: 500,
        estimatedTokens: 125,
        budgetChars: 1000,
        budgetTokens: 250,
        includedChars: 500,
        includedTokens: 125,
        trimmedChars: 500,
        trimmedTokens: 125,
        budgetStatus: "trimmed" as const,
        budgetReason: "section-over-budget" as const,
      }],
    }];

    expect(chooseVisibleBudgetScenario({
      promptBudgetEvidence,
      cacheTelemetryObservations: [],
      continuationCompactionObservations: [],
    })).toBe("scoped-review");
  });
});

describe("buildVisibleBudgetProjectionFromEvidence", () => {
  test("returns null when no budget evidence is present", () => {
    expect(buildVisibleBudgetProjectionFromEvidence({
      promptSectionRecords: [],
      cacheTelemetryObservations: [],
      continuationCompactionObservations: [],
    })).toBeNull();
  });

  test("builds a projection from prompt section records", () => {
    expect(buildVisibleBudgetProjectionFromEvidence({
      promptSectionRecords: [samplePromptSectionRecord],
      cacheTelemetryObservations: [],
      continuationCompactionObservations: [],
    })).toMatchObject({
      visibleStatus: "scoped",
      visibleReason: "prompt-budget-limited",
    });
  });
});

describe("appendReviewDetailsBudgetLines", () => {
  test("appends budget lines before closing details marker", () => {
    const projection = buildVisibleBudgetProjectionFromEvidence({
      promptSectionRecords: [samplePromptSectionRecord],
      cacheTelemetryObservations: [],
      continuationCompactionObservations: [],
    });
    const body = appendReviewDetailsBudgetLines("<details>\nSummary\n\n</details>", projection);
    expect(body).toContain("- Prompt budget:");
    expect(body.endsWith("</details>")).toBeTrue();
  });
});

describe("buildPromptBudgetOutcomes", () => {
  test("flattens prompt section budget outcomes", () => {
    expect(buildPromptBudgetOutcomes([samplePromptSectionRecord])).toEqual([{
      sectionName: "changed-files",
      sectionPosition: 1,
      budgetChars: 1000,
      budgetTokens: 250,
      includedChars: 500,
      includedTokens: 125,
      trimmedChars: 500,
      trimmedTokens: 125,
      status: "trimmed",
      reason: "section-over-budget",
    }]);
  });
});
