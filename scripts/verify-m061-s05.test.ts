import { describe, expect, test } from "bun:test";
import {
  M061_S05_CHECK_IDS,
  evaluateM061S05Proof,
  parseM061S05Args,
  renderM061S05Proof,
  runM061S05ProofCli,
} from "./verify-m061-s05.ts";
import type { UsageReportQueryResult } from "./usage-report.ts";

function buildUsageResult(overrides: Partial<UsageReportQueryResult> = {}): UsageReportQueryResult {
  return {
    summary: {
      totalExecutions: 4,
      totalInputTokens: 1220,
      totalOutputTokens: 330,
      totalCacheReadTokens: 260,
      totalCacheWriteTokens: 70,
      totalTokens: 1550,
      totalCostUsd: 0.44,
      distinctDeliveries: 4,
    },
    taskTypes: [
      {
        taskType: "review.full",
        executions: 2,
        totalTokens: 1040,
        totalCostUsd: 0.31,
        cacheReadTokens: 200,
        cacheWriteTokens: 70,
        cacheEffectiveness: 0.1923,
      },
      {
        taskType: "mention.response",
        executions: 1,
        totalTokens: 360,
        totalCostUsd: 0.08,
        cacheReadTokens: 60,
        cacheWriteTokens: 0,
        cacheEffectiveness: 0.1667,
      },
      {
        taskType: "slack.response",
        executions: 1,
        totalTokens: 150,
        totalCostUsd: 0.05,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheEffectiveness: 0,
      },
    ],
    deliveryBreakdown: [
      {
        deliveryId: "review-compact",
        repo: "acme/kodiai",
        taskType: "review.full",
        promptKinds: ["review.user-prompt"],
        sectionCount: 6,
        promptEstimatedTokens: 660,
        llmInputTokens: 780,
        llmOutputTokens: 160,
        cacheReadTokens: 140,
        cacheWriteTokens: 70,
        estimatedCostUsd: 0.22,
      },
      {
        deliveryId: "review-secondary",
        repo: "acme/kodiai",
        taskType: "review.full",
        promptKinds: ["review.user-prompt"],
        sectionCount: 6,
        promptEstimatedTokens: 650,
        llmInputTokens: 760,
        llmOutputTokens: 150,
        cacheReadTokens: 60,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0.09,
      },
      {
        deliveryId: "mention-lean",
        repo: "acme/kodiai",
        taskType: "mention.response",
        promptKinds: ["mention.context", "mention.user-prompt"],
        sectionCount: 3,
        promptEstimatedTokens: 230,
        llmInputTokens: 260,
        llmOutputTokens: 100,
        cacheReadTokens: 60,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0.08,
      },
      {
        deliveryId: "slack-baseline",
        repo: "acme/kodiai",
        taskType: "slack.response",
        promptKinds: ["slack.response"],
        sectionCount: 1,
        promptEstimatedTokens: 60,
        llmInputTokens: 80,
        llmOutputTokens: 70,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0.05,
      },
    ],
    promptSections: [
      {
        taskType: "mention.response",
        promptKind: "mention.context",
        sectionName: "candidate-code-pointers",
        executions: 1,
        totalEstimatedTokens: 20,
        totalCharCount: 80,
        truncatedExecutions: 0,
      },
      {
        taskType: "mention.response",
        promptKind: "mention.context",
        sectionName: "mention-conversation-history",
        executions: 1,
        totalEstimatedTokens: 35,
        totalCharCount: 140,
        truncatedExecutions: 0,
      },
      {
        taskType: "mention.response",
        promptKind: "mention.user-prompt",
        sectionName: "mention-user-prompt",
        executions: 1,
        totalEstimatedTokens: 80,
        totalCharCount: 320,
        truncatedExecutions: 0,
      },
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-pr-context",
        executions: 2,
        totalEstimatedTokens: 60,
        totalCharCount: 240,
        truncatedExecutions: 0,
      },
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-change-context",
        executions: 2,
        totalEstimatedTokens: 260,
        totalCharCount: 1040,
        truncatedExecutions: 1,
      },
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-size-context",
        executions: 2,
        totalEstimatedTokens: 50,
        totalCharCount: 200,
        truncatedExecutions: 0,
      },
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-graph-context",
        executions: 2,
        totalEstimatedTokens: 70,
        totalCharCount: 280,
        truncatedExecutions: 0,
      },
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-knowledge-context",
        executions: 2,
        totalEstimatedTokens: 80,
        totalCharCount: 320,
        truncatedExecutions: 0,
      },
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-instructions",
        executions: 2,
        totalEstimatedTokens: 90,
        totalCharCount: 360,
        truncatedExecutions: 1,
      },
    ],
    rateLimits: [
      {
        taskType: "review.full",
        executions: 2,
        avgCacheHitRate: 0.5,
        totalSkippedQueries: 1,
        degradationCount: 1,
      },
      {
        taskType: "mention.response",
        executions: 1,
        avgCacheHitRate: 1,
        totalSkippedQueries: 0,
        degradationCount: 0,
      },
    ],
    reuseEvidence: [
      {
        evidenceType: "mention.derived-context",
        executions: 2,
        hitExecutions: 1,
        missExecutions: 1,
        degradedExecutions: 0,
        bypassExecutions: 0,
        reusedUnits: 1,
        primaryWorkUnits: 1,
        avgReuseRate: 0.5,
        statuses: ["hit", "miss"],
      },
      {
        evidenceType: "review.derived-prompt",
        executions: 2,
        hitExecutions: 1,
        missExecutions: 0,
        degradedExecutions: 1,
        bypassExecutions: 0,
        reusedUnits: 1,
        primaryWorkUnits: 2,
        avgReuseRate: 0.3333,
        statuses: ["degraded", "hit"],
      },
      {
        evidenceType: "retrieval.query-embedding",
        executions: 2,
        hitExecutions: 1,
        missExecutions: 1,
        degradedExecutions: 0,
        bypassExecutions: 0,
        reusedUnits: 2,
        primaryWorkUnits: 3,
        avgReuseRate: 0.4,
        statuses: ["hit", "miss"],
      },
    ],
    ...overrides,
  };
}

describe("verify m061 s05 integrated token reduction proof", () => {
  test("parses supported cli args", () => {
    expect(M061_S05_CHECK_IDS).toEqual([
      "M061-S05-PREFLIGHT",
      "M061-S05-BASELINE-COVERAGE",
      "M061-S05-MENTION-REDUCTION",
      "M061-S05-REVIEW-COMPACTION",
      "M061-S05-REUSE-TRUTHFULNESS",
      "M061-S05-INTEGRATED-TOKEN-STORY",
    ]);
    expect(parseM061S05Args([])).toEqual({
      since: null,
      repo: null,
      json: false,
      help: false,
    });
    expect(parseM061S05Args(["--repo", "acme/kodiai", "--since", "7d", "--json"])).toEqual({
      since: expect.stringMatching(/T/),
      repo: "acme/kodiai",
      json: true,
      help: false,
    });
  });

  test("passes when baseline coverage, mention reduction, review compaction, reuse truthfulness, and integrated token evidence all hold", () => {
    const report = evaluateM061S05Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "acme/kodiai", since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: buildUsageResult(),
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.observed.representativeDeliveries.mention?.deliveryId).toBe("mention-lean");
    expect(report.observed.representativeDeliveries.review?.deliveryId).toBe("review-compact");
    expect(report.observed.integratedComparisons.mentionVsReviewInputReduction).toBeGreaterThan(0);
    expect(report.observed.integratedComparisons.mentionVsReviewPromptReduction).toBeGreaterThan(0);
    expect(renderM061S05Proof(report)).toContain("Final verdict: PASS");
    expect(renderM061S05Proof(report)).toContain("M061-S05-INTEGRATED-TOKEN-STORY PASS");
  });

  test("fails with explicit evidence gaps when representative mention/review comparisons cannot prove the lower-token story", () => {
    const report = evaluateM061S05Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: buildUsageResult({
        deliveryBreakdown: [
          {
            deliveryId: "mention-heavy",
            repo: "acme/kodiai",
            taskType: "mention.response",
            promptKinds: ["mention.context", "mention.user-prompt"],
            sectionCount: 8,
            promptEstimatedTokens: 900,
            llmInputTokens: 950,
            llmOutputTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsd: 0.2,
          },
        ],
        promptSections: [
          {
            taskType: "mention.response",
            promptKind: "mention.context",
            sectionName: "mention-conversation-history",
            executions: 1,
            totalEstimatedTokens: 100,
            totalCharCount: 400,
            truncatedExecutions: 0,
          },
        ],
        reuseEvidence: [
          {
            evidenceType: "mention.derived-context",
            executions: 1,
            hitExecutions: 1,
            missExecutions: 0,
            degradedExecutions: 0,
            bypassExecutions: 0,
            reusedUnits: 1,
            primaryWorkUnits: 0,
            avgReuseRate: 1,
            statuses: ["hit"],
          },
        ],
      }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S05-BASELINE-COVERAGE")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S05-REVIEW-COMPACTION")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S05-REUSE-TRUTHFULNESS")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S05-INTEGRATED-TOKEN-STORY")?.detail).toContain("review.full representative delivery");
    expect(renderM061S05Proof(report)).toContain("Final verdict: FAIL");
  });

  test("fails specific checks for partial prompt/reuse rows and boundary-condition telemetry", () => {
    const report = evaluateM061S05Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: buildUsageResult({
        promptSections: [
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-pr-context",
            executions: 1,
            totalEstimatedTokens: 20,
            totalCharCount: 80,
            truncatedExecutions: 0,
          },
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-change-context",
            executions: 1,
            totalEstimatedTokens: 20,
            totalCharCount: 80,
            truncatedExecutions: 0,
          },
          {
            taskType: "mention.response",
            promptKind: "mention.user-prompt",
            sectionName: "mention-user-prompt",
            executions: 1,
            totalEstimatedTokens: 10,
            totalCharCount: 40,
            truncatedExecutions: 0,
          },
        ],
        reuseEvidence: [
          {
            evidenceType: "mention.derived-context",
            executions: 1,
            hitExecutions: 0,
            missExecutions: 0,
            degradedExecutions: 0,
            bypassExecutions: 0,
            reusedUnits: 0,
            primaryWorkUnits: 0,
            avgReuseRate: 0,
            statuses: [],
          },
          {
            evidenceType: "review.derived-prompt",
            executions: 1,
            hitExecutions: 1,
            missExecutions: 0,
            degradedExecutions: 0,
            bypassExecutions: 0,
            reusedUnits: 0,
            primaryWorkUnits: 0,
            avgReuseRate: 0,
            statuses: ["hit"],
          },
          {
            evidenceType: "retrieval.query-embedding",
            executions: 1,
            hitExecutions: 0,
            missExecutions: 1,
            degradedExecutions: 0,
            bypassExecutions: 0,
            reusedUnits: 0,
            primaryWorkUnits: 1,
            avgReuseRate: 0,
            statuses: ["miss"],
          },
        ],
      }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S05-MENTION-REDUCTION")?.detail).toContain("mention.context");
    expect(report.checks.find((check) => check.id === "M061-S05-REVIEW-COMPACTION")?.detail).toContain("truncation evidence");
    expect(report.checks.find((check) => check.id === "M061-S05-REUSE-TRUTHFULNESS")?.detail).toContain("reuse evidence");
  });

  test("fails open when database access is unavailable", () => {
    const report = evaluateM061S05Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "unavailable",
      accessDetail: "connect ECONNREFUSED",
      usageResult: null,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.preflight.databaseAccess).toBe("unavailable");
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M061-S05-PREFLIGHT", passed: false }),
    ]);
    expect(renderM061S05Proof(report)).toContain("Database access: unavailable");
  });
});

describe("runM061S05ProofCli", () => {
  test("returns a fail-open missing-access report when no database URL is configured", async () => {
    const { report, exitCode, json } = await runM061S05ProofCli([], {});

    expect(exitCode).toBe(0);
    expect(json).toBe(false);
    expect(report.preflight.databaseAccess).toBe("missing");
    expect(report.checks[0]?.id).toBe("M061-S05-PREFLIGHT");
  });
});
