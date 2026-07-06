import { describe, expect, test } from "bun:test";
import type { ReviewCacheTelemetryObservation } from "../review-cache-telemetry/cache-telemetry.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import { createReviewVisibleBudgetProjectionState } from "./review-visible-budget-state.ts";

const promptSectionRecord: PromptSectionRecord = {
  deliveryId: "delivery-1",
  repo: "xbmc/xbmc",
  taskType: "review.full",
  promptKind: "review.user-prompt",
  sections: [{
    sectionName: "changed-files",
    sectionPosition: 1,
    charCount: 1000,
    estimatedTokens: 250,
    budgetChars: 500,
    budgetTokens: 125,
    includedChars: 500,
    includedTokens: 125,
    trimmedChars: 500,
    trimmedTokens: 125,
    budgetStatus: "trimmed",
    budgetReason: "section-over-budget",
  }],
};

const cacheObservation: ReviewCacheTelemetryObservation = {
  cacheSurface: "review-derived-prompt",
  status: "degraded",
  reason: "bookkeeping-failure",
  deliveryId: "delivery-1",
  repo: "xbmc/xbmc",
  prNumber: 42,
};

describe("createReviewVisibleBudgetProjectionState", () => {
  test("refreshes a projection from mutable review handler evidence", () => {
    const state = createReviewVisibleBudgetProjectionState();

    expect(state.refresh()).toBeNull();

    state.promptSectionRecords = [promptSectionRecord];
    state.reviewCacheObservations.push(cacheObservation);

    expect(state.refresh()).toMatchObject({
      visibleStatus: "scoped",
      visibleReason: "prompt-budget-limited",
    });
    expect(state.projection).toMatchObject({
      visibleStatus: "scoped",
    });
  });

  test("keeps prompt records replaceable after executor updates them", () => {
    const state = createReviewVisibleBudgetProjectionState();
    state.promptSectionRecords = [promptSectionRecord];

    expect(state.refresh()).toMatchObject({
      visibleStatus: "scoped",
    });

    state.promptSectionRecords = [];

    expect(state.refresh()).toBeNull();
    expect(state.projection).toBeNull();
  });
});
