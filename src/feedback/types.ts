import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";

export type FeedbackPattern = {
  fingerprint: string;
  thumbsDownCount: number;
  thumbsUpCount: number;
  distinctReactors: number;
  distinctPRs: number;
  severity: FindingSeverity;
  category: FindingCategory;
  sampleTitle: string;
};

export type FeedbackThresholds = {
  minThumbsDown: number;
  minDistinctReactors: number;
  minDistinctPRs: number;
};

export type FeedbackSuppressionResult = {
  suppressedFingerprints: Set<string>;
  suppressedPatternCount: number;
  patterns: FeedbackPattern[];
};

export type FeedbackSuppressionConfig = {
  enabled: boolean;
  thresholds: FeedbackThresholds;
};
