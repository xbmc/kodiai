import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type {
  FeedbackPattern,
  FeedbackSuppressionConfig,
  FeedbackSuppressionResult,
} from "../feedback/index.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import { resolveReviewFeedbackSuppression } from "./review-feedback-suppression.ts";

describe("resolveReviewFeedbackSuppression", () => {
  const config: FeedbackSuppressionConfig = {
    enabled: true,
    thresholds: { minThumbsDown: 2, minDistinctReactors: 2, minDistinctPRs: 1 },
  };
  const logger = {} as Logger;
  const pattern: FeedbackPattern = {
    fingerprint: "fingerprint-1",
    thumbsDownCount: 3,
    thumbsUpCount: 0,
    distinctReactors: 2,
    distinctPRs: 1,
    severity: "medium",
    category: "style",
    sampleTitle: "Prefer named helper",
  };

  test("returns an empty suppression result when the knowledge store is unavailable", async () => {
    const evaluate = mock(async () => ({
      suppressedFingerprints: new Set(["unexpected"]),
      suppressedPatternCount: 1,
      patterns: [pattern],
    }));

    const result = await resolveReviewFeedbackSuppression({
      knowledgeStore: undefined,
      repo: "xbmc/kodiai",
      config,
      logger,
      evaluate,
    });

    expect(result).toEqual({
      suppressedFingerprints: new Set<string>(),
      suppressedPatternCount: 0,
      patterns: [],
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  test("delegates feedback suppression evaluation when the knowledge store is available", async () => {
    const suppression: FeedbackSuppressionResult = {
      suppressedFingerprints: new Set(["fingerprint-1"]),
      suppressedPatternCount: 1,
      patterns: [pattern],
    };
    const knowledgeStore = { listFeedbackSuppressions: async () => [] } as unknown as KnowledgeStore;
    const evaluate = mock(async () => suppression);

    const result = await resolveReviewFeedbackSuppression({
      knowledgeStore,
      repo: "xbmc/kodiai",
      config,
      logger,
      evaluate,
    });

    expect(result).toBe(suppression);
    expect(evaluate).toHaveBeenCalledWith({
      store: knowledgeStore,
      repo: "xbmc/kodiai",
      config,
      logger,
    });
  });
});
