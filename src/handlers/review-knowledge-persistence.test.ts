import { describe, expect, mock, test } from "bun:test";
import type { ReviewRecord } from "../knowledge/types.ts";
import { fingerprintFindingTitle } from "../lib/review-finding-metadata.ts";
import {
  buildReviewKnowledgeConfigSnapshot,
  buildReviewKnowledgeRecord,
  persistReviewKnowledgeIfAvailable,
  persistReviewKnowledge,
} from "./review-knowledge-persistence.ts";

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

describe("buildReviewKnowledgeConfigSnapshot", () => {
  test("serializes safe review config and publication metadata without raw prompt or diff content", () => {
    const snapshot = buildReviewKnowledgeConfigSnapshot({
      reviewConfig: {
        mode: "enhanced",
        severityMinLevel: "medium",
        focusAreas: ["correctness"],
        maxComments: 8,
        suppressionCount: 2,
        minConfidence: 0.7,
        profile: "balanced",
      },
      shareGlobal: true,
      reviewPlan: {
        status: "ok",
        graphValidationStatus: "enabled",
      },
      reviewReducer: {
        status: "degraded",
        counts: { input: 4, output: 2 },
        reason: "reducer fallback",
      },
      reviewCandidateFinding: {
        enabled: true,
        status: "candidate-present",
      },
      reviewCandidatePublication: {
        mode: "candidate-approved",
        prompt: "RAW BODY MUST NOT LEAK",
      },
      reviewCandidatePublicationFlow: {
        outcome: "published",
        body: "diff --git a/src/a.ts b/src/a.ts",
      },
    });

    const parsed = JSON.parse(snapshot) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      mode: "enhanced",
      severityMinLevel: "medium",
      focusAreas: ["correctness"],
      maxComments: 8,
      suppressionCount: 2,
      minConfidence: 0.7,
      profile: "balanced",
      shareGlobal: true,
      reviewPlan: {
        status: "ok",
        graphValidationStatus: "enabled",
      },
      reviewReducer: {
        status: "degraded",
        counts: { input: 4, output: 2 },
        reason: "reducer fallback",
      },
      reviewCandidateFinding: {
        enabled: true,
        status: "candidate-present",
      },
      reviewCandidatePublication: {
        mode: "candidate-approved",
      },
      reviewCandidatePublicationFlow: {
        outcome: "published",
      },
    });
    expect(snapshot).not.toContain("RAW BODY MUST NOT LEAK");
    expect(snapshot).not.toContain("diff --git");
  });
});

describe("buildReviewKnowledgeRecord", () => {
  test("maps review summary fields and builds a sanitized config snapshot", () => {
    const record = buildReviewKnowledgeRecord({
      repo: "octo/repo",
      prNumber: 42,
      headSha: "abc123",
      deliveryId: "delivery-1",
      filesAnalyzed: 3,
      linesChanged: 99,
      findingCounts: {
        critical: 1,
        major: 2,
        medium: 3,
        minor: 4,
      },
      findingsTotal: 10,
      suppressionsApplied: 2,
      reviewConfig: {
        mode: "enhanced",
        severityMinLevel: "medium",
        focusAreas: ["security"],
        maxComments: 7,
        suppressionCount: 5,
        minConfidence: 0.75,
        profile: "balanced",
      },
      shareGlobal: false,
      reviewPlan: { status: "ready", rawPrompt: "do not store" },
      reviewReducer: { status: "ready", counts: { output: 10 } },
      reviewCandidateFinding: { enabled: true },
      reviewCandidatePublication: { mode: "candidate-approved", body: "raw body" },
      reviewCandidatePublicationFlow: { outcome: "published" },
      durationMs: 1234,
      model: "claude-test",
      conclusion: "success",
    });

    expect(record).toMatchObject({
      repo: "octo/repo",
      prNumber: 42,
      headSha: "abc123",
      deliveryId: "delivery-1",
      filesAnalyzed: 3,
      linesChanged: 99,
      findingsCritical: 1,
      findingsMajor: 2,
      findingsMedium: 3,
      findingsMinor: 4,
      findingsTotal: 10,
      suppressionsApplied: 2,
      durationMs: 1234,
      model: "claude-test",
      conclusion: "success",
    });
    expect(record.configSnapshot).toContain("\"shareGlobal\":false");
    expect(record.configSnapshot).not.toContain("do not store");
    expect(record.configSnapshot).not.toContain("raw body");
  });
});

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

describe("persistReviewKnowledgeIfAvailable", () => {
  test("returns undefined without a knowledge store", async () => {
    const logger = { debug: mock(() => {}), warn: mock(() => {}) };

    const result = await persistReviewKnowledgeIfAvailable({
      knowledgeStore: undefined,
      logger,
      repo: "octo/repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      record: {
        repo: "octo/repo",
        prNumber: 42,
        headSha: "abc123",
        deliveryId: "delivery-1",
        filesAnalyzed: 1,
        linesChanged: 10,
        findingCounts: { critical: 0, major: 0, medium: 0, minor: 0 },
        findingsTotal: 0,
        suppressionsApplied: 0,
        reviewConfig: {
          mode: "enhanced",
          severityMinLevel: "medium",
          focusAreas: [],
          maxComments: 5,
          suppressionCount: 0,
          minConfidence: 0.7,
          profile: "balanced",
        },
        shareGlobal: false,
        reviewPlan: null,
        reviewReducer: { status: "ready", counts: {} },
        reviewCandidateFinding: null,
        reviewCandidatePublication: null,
        reviewCandidatePublicationFlow: null,
        durationMs: 10,
        model: "claude-test",
        conclusion: "success",
      },
      processedFindings: [],
      suppressionMatchCounts: new Map(),
      visibleFindingCount: 0,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 0,
      shareGlobal: false,
    });

    expect(result).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("builds the review record and returns the persisted review id", async () => {
    const store = {
      recordReview: mock(async (_entry: ReviewRecord) => 321),
      recordFindings: mock(async (_entries: unknown[]) => {}),
      recordSuppressionLog: mock(async (_entries: unknown[]) => {}),
      recordGlobalPattern: mock(async (_entry: unknown) => {}),
    };
    const logger = { debug: mock(() => {}), warn: mock(() => {}) };

    const result = await persistReviewKnowledgeIfAvailable({
      knowledgeStore: store,
      logger,
      repo: "octo/repo",
      prNumber: 42,
      reviewOutputKey: "review-key",
      record: {
        repo: "octo/repo",
        prNumber: 42,
        headSha: "abc123",
        deliveryId: "delivery-1",
        filesAnalyzed: 1,
        linesChanged: 10,
        findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
        findingsTotal: 1,
        suppressionsApplied: 0,
        reviewConfig: {
          mode: "enhanced",
          severityMinLevel: "medium",
          focusAreas: ["correctness"],
          maxComments: 5,
          suppressionCount: 0,
          minConfidence: 0.7,
          profile: "balanced",
        },
        shareGlobal: false,
        reviewPlan: { status: "ready" },
        reviewReducer: { status: "ready", counts: { output: 1 } },
        reviewCandidateFinding: null,
        reviewCandidatePublication: null,
        reviewCandidatePublicationFlow: null,
        durationMs: 10,
        model: "claude-test",
        conclusion: "success",
      },
      processedFindings: [],
      suppressionMatchCounts: new Map(),
      visibleFindingCount: 0,
      lowConfidenceFindingCount: 0,
      suppressionsApplied: 0,
      shareGlobal: false,
    });

    expect(result).toBe(321);
    expect(store.recordReview).toHaveBeenCalledWith(expect.objectContaining({
      repo: "octo/repo",
      prNumber: 42,
      findingsMajor: 1,
      configSnapshot: expect.stringContaining("\"focusAreas\":[\"correctness\"]"),
    }));
  });
});
