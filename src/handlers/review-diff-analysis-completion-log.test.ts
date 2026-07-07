import { describe, expect, mock, test } from "bun:test";
import { logReviewDiffAnalysisCompleted } from "./review-diff-analysis-completion-log.ts";

describe("logReviewDiffAnalysisCompleted", () => {
  test("logs diff-analysis completion fields", () => {
    const logger = { info: mock(() => {}) };

    logReviewDiffAnalysisCompleted({
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      totalFiles: 6,
      isLargePR: false,
      riskSignals: 2,
      matchedInstructions: 3,
      detectedLanguages: 4,
      profile: "balanced",
      diffCollectionStrategy: "merge-base",
      mergeBaseRecovered: true,
      diffCollectionAttempts: 1,
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        deliveryId: "delivery-1",
        prNumber: 42,
        gate: "diff-analysis",
        totalFiles: 6,
        isLargePR: false,
        riskSignals: 2,
        matchedInstructions: 3,
        detectedLanguages: 4,
        profile: "balanced",
        diffCollectionStrategy: "merge-base",
        mergeBaseRecovered: true,
        diffCollectionAttempts: 1,
      },
      "Diff analysis and context enrichment complete",
    );
  });
});
