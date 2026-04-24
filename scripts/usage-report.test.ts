import { describe, expect, test } from "bun:test";
import {
  buildUsageReport,
  renderUsageReportText,
  type UsageReportQueryResult,
} from "./usage-report.ts";

function buildFixtureResult(overrides: Partial<UsageReportQueryResult> = {}): UsageReportQueryResult {
  return {
    summary: {
      totalExecutions: 4,
      totalInputTokens: 1400,
      totalOutputTokens: 600,
      totalCacheReadTokens: 500,
      totalCacheWriteTokens: 250,
      totalTokens: 2000,
      totalCostUsd: 1.23,
      distinctDeliveries: 4,
    },
    taskTypes: [
      {
        taskType: "review.full",
        executions: 2,
        totalTokens: 1300,
        totalCostUsd: 0.98,
        cacheReadTokens: 400,
        cacheWriteTokens: 200,
        cacheEffectiveness: 0.31,
      },
      {
        taskType: "mention.response",
        executions: 1,
        totalTokens: 500,
        totalCostUsd: 0.15,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        cacheEffectiveness: 0.2,
      },
    ],
    deliveryBreakdown: [
      {
        deliveryId: "review-1",
        repo: "xbmc/xbmc",
        taskType: "review.full",
        promptKinds: ["review.user-prompt"],
        sectionCount: 3,
        promptEstimatedTokens: 900,
        llmInputTokens: 800,
        llmOutputTokens: 220,
        cacheReadTokens: 250,
        cacheWriteTokens: 120,
        estimatedCostUsd: 0.61,
      },
      {
        deliveryId: "mention-1",
        repo: "xbmc/xbmc",
        taskType: "mention.response",
        promptKinds: ["mention.context", "mention.response"],
        sectionCount: 4,
        promptEstimatedTokens: 430,
        llmInputTokens: 350,
        llmOutputTokens: 110,
        cacheReadTokens: 90,
        cacheWriteTokens: 50,
        estimatedCostUsd: 0.15,
      },
    ],
    promptSections: [
      {
        taskType: "review.full",
        promptKind: "review.user-prompt",
        sectionName: "review-change-context",
        executions: 2,
        totalEstimatedTokens: 500,
        totalCharCount: 2000,
        truncatedExecutions: 1,
      },
      {
        taskType: "mention.response",
        promptKind: "mention.context",
        sectionName: "conversation-history",
        executions: 1,
        totalEstimatedTokens: 180,
        totalCharCount: 720,
        truncatedExecutions: 0,
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
        evidenceType: "retrieval.query-embedding",
        executions: 1,
        hitExecutions: 1,
        missExecutions: 0,
        degradedExecutions: 0,
        bypassExecutions: 0,
        reusedUnits: 2,
        primaryWorkUnits: 1,
        avgReuseRate: 0.6667,
        statuses: ["hit"],
      },
    ],
    ...overrides,
  };
}

describe("buildUsageReport", () => {
  test("marks access as missing and fails open when no connection string is available", () => {
    const report = buildUsageReport({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "missing",
      accessDetail: "DATABASE_URL is unset.",
      result: null,
    });

    expect(report.preflight.databaseAccess).toBe("missing");
    expect(report.summary.totalExecutions).toBe(0);
    expect(report.taskTypes).toEqual([]);
    expect(report.promptSections).toEqual([]);
  });

  test("builds truthful attribution surfaces from live-schema aggregates", () => {
    const report = buildUsageReport({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "xbmc/xbmc", since: "7d" },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      result: buildFixtureResult(),
    });

    expect(report.summary.totalExecutions).toBe(4);
    expect(report.summary.cacheEffectiveness).toBe(0.25);
    expect(report.taskTypes[0]?.taskType).toBe("review.full");
    expect(report.deliveryBreakdown[0]?.promptKinds).toContain("review.user-prompt");
    expect(report.promptSections[0]?.sectionName).toBe("review-change-context");
    expect(report.rateLimits[0]?.avgCacheHitRate).toBe(0.5);
    expect(report.reuseEvidence[0]?.evidenceType).toBe("mention.derived-context");
    expect(report.reuseEvidence[1]?.reusedUnits).toBe(2);
  });
});

describe("renderUsageReportText", () => {
  test("renders preflight access state and operator-visible attribution sections", () => {
    const text = renderUsageReportText(
      buildUsageReport({
        generatedAt: "2026-04-24T00:00:00.000Z",
        filters: { repo: "xbmc/xbmc", since: "7d" },
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        result: buildFixtureResult(),
      }),
    );

    expect(text).toContain("Database access: available");
    expect(text).toContain("Task-path attribution");
    expect(text).toContain("review.full");
    expect(text).toContain("Prompt-section summaries");
    expect(text).toContain("conversation-history");
    expect(text).toContain("Reuse evidence");
    expect(text).toContain("retrieval.query-embedding");
    expect(text).toContain("Cache effectiveness");
  });

  test("renders fail-open guidance when telemetry access is unavailable", () => {
    const text = renderUsageReportText(
      buildUsageReport({
        generatedAt: "2026-04-24T00:00:00.000Z",
        filters: { repo: null, since: null },
        accessState: "unavailable",
        accessDetail: "connect ECONNREFUSED",
        result: null,
      }),
    );

    expect(text).toContain("Database access: unavailable");
    expect(text).toContain("connect ECONNREFUSED");
    expect(text).toContain("No live telemetry data available");
  });
});
