import { describe, expect, mock, test } from "bun:test";
import type { ReviewRecord } from "../knowledge/types.ts";
import { fingerprintFindingTitle } from "../lib/review-finding-metadata.ts";
import { persistReviewKnowledge } from "./review-knowledge-persistence.ts";

const reviewRecord = {
  repo: "octo/repo",
  prNumber: 42,
  filesAnalyzed: 2,
  linesChanged: 30,
  findingsCritical: 0,
  findingsMajor: 1,
  findingsMedium: 1,
  findingsMinor: 0,
  findingsTotal: 2,
  suppressionsApplied: 1,
  conclusion: "success",
} satisfies ReviewRecord;

describe("persistReviewKnowledge", () => {
  test("records the review, findings, and suppression log rows", async () => {
    const store = {
      recordReview: mock(async (_entry: ReviewRecord) => 123),
      recordFindings: mock(async (_entries: unknown[]) => {}),
      recordSuppressionLog: mock(async (_entries: unknown[]) => {}),
      recordGlobalPattern: mock(async (_entry: unknown) => {}),
    };
    const logger = { debug: mock(() => {}), warn: mock(() => {}) };

    const result = await persistReviewKnowledge({
      knowledgeStore: store,
      logger,
      repo: "octo/repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      reviewRecord,
      processedFindings: [
        {
          commentId: 10,
          filePath: "src/a.ts",
          startLine: 1,
          endLine: 2,
          severity: "major",
          category: "correctness",
          confidence: 0.92,
          title: "Missing guard",
          suppressed: false,
        },
      ],
      suppressionMatchCounts: new Map([["*.snap", 2]]),
      visibleFindingCount: 1,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 1,
      shareGlobal: false,
    });

    expect(result).toEqual({ ok: true, value: { reviewId: 123 } });
    expect(store.recordReview).toHaveBeenCalledWith(reviewRecord);
    expect(store.recordFindings).toHaveBeenCalledWith([
      {
        reviewId: 123,
        commentId: 10,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "review-key",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 2,
        severity: "major",
        category: "correctness",
        confidence: 0.92,
        title: "Missing guard",
        suppressed: false,
        suppressionPattern: undefined,
      },
    ]);
    expect(store.recordSuppressionLog).toHaveBeenCalledWith([
      { reviewId: 123, pattern: "*.snap", matchedCount: 2 },
    ]);
    expect(store.recordGlobalPattern).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("aggregates global patterns by severity, category, confidence band, and fingerprint", async () => {
    const store = {
      recordReview: mock(async (_entry: ReviewRecord) => 456),
      recordFindings: mock(async (_entries: unknown[]) => {}),
      recordSuppressionLog: mock(async (_entries: unknown[]) => {}),
      recordGlobalPattern: mock(async (_entry: unknown) => {}),
    };
    const logger = { debug: mock(() => {}), warn: mock(() => {}) };

    await persistReviewKnowledge({
      knowledgeStore: store,
      logger,
      repo: "octo/repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      reviewRecord,
      processedFindings: [
        {
          commentId: 10,
          filePath: "src/a.ts",
          severity: "major",
          category: "correctness",
          confidence: 90,
          title: "Missing guard!",
          suppressed: false,
        },
        {
          commentId: 11,
          filePath: "src/b.ts",
          severity: "major",
          category: "correctness",
          confidence: 85,
          title: "Missing guard!",
          suppressed: true,
          suppressionPattern: "*.generated.ts",
        },
      ],
      suppressionMatchCounts: new Map(),
      visibleFindingCount: 1,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 1,
      shareGlobal: true,
    });

    expect(store.recordGlobalPattern).toHaveBeenCalledTimes(1);
    expect(store.recordGlobalPattern).toHaveBeenCalledWith({
      severity: "major",
      category: "correctness",
      confidenceBand: "high",
      patternFingerprint: fingerprintFindingTitle("Missing guard!"),
      count: 2,
    });
  });

  test("logs and swallows global aggregate failures", async () => {
    const err = new Error("global unavailable");
    const store = {
      recordReview: mock(async (_entry: ReviewRecord) => 789),
      recordFindings: mock(async (_entries: unknown[]) => {}),
      recordSuppressionLog: mock(async (_entries: unknown[]) => {}),
      recordGlobalPattern: mock(async (_entry: unknown) => {
        throw err;
      }),
    };
    const logger = { debug: mock(() => {}), warn: mock(() => {}) };

    const result = await persistReviewKnowledge({
      knowledgeStore: store,
      logger,
      repo: "octo/repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      reviewRecord,
      processedFindings: [
        {
          commentId: 10,
          filePath: "src/a.ts",
          severity: "major",
          category: "correctness",
          confidence: 0.9,
          title: "Missing guard",
          suppressed: false,
        },
      ],
      suppressionMatchCounts: new Map(),
      visibleFindingCount: 1,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 0,
      shareGlobal: true,
    });

    expect(result).toEqual({ ok: true, value: { reviewId: 789 } });
    expect(logger.warn).toHaveBeenCalledWith(
      { err, repo: "octo/repo", prNumber: 42 },
      "Knowledge store global aggregate write failed (non-fatal)",
    );
  });

  test("logs and swallows primary knowledge store failures", async () => {
    const err = new Error("store unavailable");
    const store = {
      recordReview: mock(async (_entry: ReviewRecord) => {
        throw err;
      }),
      recordFindings: mock(async (_entries: unknown[]) => {}),
      recordSuppressionLog: mock(async (_entries: unknown[]) => {}),
      recordGlobalPattern: mock(async (_entry: unknown) => {}),
    };
    const logger = { debug: mock(() => {}), warn: mock(() => {}) };

    const result = await persistReviewKnowledge({
      knowledgeStore: store,
      logger,
      repo: "octo/repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      reviewRecord,
      processedFindings: [],
      suppressionMatchCounts: new Map(),
      visibleFindingCount: 0,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 0,
      shareGlobal: true,
    });

    expect(result).toEqual({ ok: false, err });
    expect(store.recordFindings).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { err, repo: "octo/repo", prNumber: 42 },
      "Knowledge store write failed (non-fatal)",
    );
  });
});
