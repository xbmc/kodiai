import { describe, expect, test } from "bun:test";
import {
  buildUsageReport,
  queryUsageReport,
  queryUsageReportWithTimeout,
  renderUsageReportText,
  renderUsageReportCsv,
  type UsageReportQueryResult,
} from "./usage-report.ts";
import type { Sql } from "../src/db/client.ts";

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
    sectionBudget: {
      note: null,
      rows: [
        {
          taskType: "review.small-diff",
          sectionName: "review-instructions",
          executions: 12,
          budgetChars: 16000,
          budgetTokens: 4000,
          avgIncludedChars: 11800,
          p50IncludedChars: 11600,
          p90IncludedChars: 12900,
          maxIncludedChars: 13400,
          avgIncludedTokens: 2950,
          p90IncludedTokens: 3225,
          trimmedExecutions: 0,
          trimmedRate: 0,
          budgetUtilizationP90: 0.8063,
        },
      ],
    },
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
    reviewCacheTelemetry: {
      note: null,
      rows: [
        {
          cacheSurface: "review-derived-prompt",
          status: "hit",
          reason: "safe-reuse",
          executions: 3,
          distinctDeliveries: 3,
          affectedPrs: 2,
          fingerprintVersions: ["review-cache-fp-v1"],
          safetySignalNames: ["base-ref", "head-ref", "prompt-schema"],
          missingSignalNames: [],
          invalidationSignalNames: [],
          bookkeepingErrorCount: 0,
        },
        {
          cacheSurface: "retrieval-query-embedding",
          status: "degraded",
          reason: "incomplete-fingerprint",
          executions: 1,
          distinctDeliveries: 1,
          affectedPrs: 1,
          fingerprintVersions: [],
          safetySignalNames: [],
          missingSignalNames: ["tree-sha"],
          invalidationSignalNames: [],
          bookkeepingErrorCount: 0,
        },
      ],
    },
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
    expect(report.sectionBudget).toEqual({ rows: [], note: null });
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
    expect(report.sectionBudget?.rows[0]?.sectionName).toBe("review-instructions");
    expect(report.sectionBudget?.rows[0]?.budgetUtilizationP90).toBe(0.8063);
    expect(report.rateLimits[0]?.avgCacheHitRate).toBe(0.5);
    expect(report.reuseEvidence[0]?.evidenceType).toBe("mention.derived-context");
    expect(report.reuseEvidence[1]?.reusedUnits).toBe(2);
    expect(report.reviewCacheTelemetry?.rows[0]?.cacheSurface).toBe("review-derived-prompt");
    expect(report.reviewCacheTelemetry?.rows[1]?.reason).toBe("incomplete-fingerprint");
  });
});

describe("queryUsageReport", () => {
  test("bounds review cache telemetry signal arrays in SQL", async () => {
    const calls: string[] = [];
    const sql = {
      unsafe: async (query: string) => {
        calls.push(query);
        return [];
      },
    } as unknown as Sql;

    await queryUsageReport(sql, { repo: null, since: null, deliveryId: null });

    const query = calls.find((call) => call.includes("FROM review_cache_events"));
    expect(query).toBeString();
    expect(query).toContain("cache_surface = ANY");
    expect(query).toContain("LIMIT $4::int");
    expect(query).toContain("unnest(f2.safety_signal_names)");
    expect(query).not.toContain("FROM filtered f, unnest");
    expect(query).not.toContain("array_agg(DISTINCT signal");
    expect(calls.join("\n")).not.toContain(" IS NULL OR ");
  });

  test("times out instead of waiting indefinitely on live telemetry queries", async () => {
    const sql = {
      unsafe: async () => new Promise<never>(() => {}),
    } as unknown as Sql;

    await expect(
      queryUsageReportWithTimeout(sql, { repo: null, since: null, deliveryId: null }, 1),
    ).rejects.toThrow("Timed out querying telemetry Postgres after 1ms.");
  });

  test("sets a transaction-local Postgres statement timeout for report queries", async () => {
    const calls: Array<{ query: string; params?: unknown[] }> = [];
    const tx = {
      unsafe: async (query: string, params?: unknown[]) => {
        calls.push({ query, params });
        return [];
      },
    } as unknown as Sql;
    const sql = {
      begin: async (_mode: string, fn: (tx: Sql) => Promise<unknown>) => fn(tx),
    } as unknown as Sql;

    await queryUsageReportWithTimeout(sql, { repo: null, since: null, deliveryId: null }, 1234);

    expect(calls[0]).toEqual({
      query: "SELECT set_config('statement_timeout', $1, true)",
      params: ["1234ms"],
    });
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
    expect(text).toContain("Section budget distribution");
    expect(text).toContain("review.small-diff / review-instructions");
    expect(text).toContain("p90_utilization=80.6%");
    expect(text).toContain("Reuse evidence");
    expect(text).toContain("retrieval.query-embedding");
    expect(text).toContain("Review cache telemetry");
    expect(text).toContain("review-derived-prompt status=hit reason=safe-reuse");
    expect(text).toContain("retrieval-query-embedding status=degraded reason=incomplete-fingerprint");
    expect(text).toContain("missing_signals=tree-sha");
    expect(text).toContain("Cache effectiveness");
  });

  test("renders review cache telemetry empty-state and fail-open notes without raw payloads", () => {
    const text = renderUsageReportText(
      buildUsageReport({
        generatedAt: "2026-04-24T00:00:00.000Z",
        filters: { repo: "xbmc/xbmc", since: "7d", deliveryId: "delivery-1" },
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        result: buildFixtureResult({
          reviewCacheTelemetry: {
            note: "review_cache_events table is not available; cache telemetry section failed open without blocking the usage report.",
            rows: [],
          },
        }),
      }),
    );

    expect(text).toContain("delivery=delivery-1");
    expect(text).toContain("review_cache_events table is not available");
    expect(text).toContain("No review_cache_events rows matched the requested filters");
    expect(text).not.toContain("raw prompt");
    expect(text).not.toContain("diff --git");
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

describe("renderUsageReportCsv", () => {
  function csvLines(result: Partial<UsageReportQueryResult> = {}): string[] {
    return renderUsageReportCsv(
      buildUsageReport({
        generatedAt: "2026-04-24T00:00:00.000Z",
        filters: { repo: "xbmc/xbmc", since: "7d" },
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        result: buildFixtureResult(result),
      }),
    ).split("\n");
  }

  test("emits header, summary, and every section row in declaration order", () => {
    const lines = csvLines();
    expect(lines[0]).toBe("section,key,value");
    expect(lines.some((line) => line.startsWith("summary,total_executions,"))).toBeTrue();

    const labelOrder = ["task_type", "delivery", "prompt_section", "section_budget", "reuse_evidence", "review_cache_telemetry", "rate_limit"];
    const firstIndexOf = (label: string) => lines.findIndex((line) => line.startsWith(`${label},`));
    const indices = labelOrder.map(firstIndexOf);
    expect(indices.every((index) => index >= 0)).toBeTrue();
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  test("appends fail-open notes after their section rows, not before", () => {
    const lines = csvLines({
      sectionBudget: { note: "prompt_section_events budget columns are not available; failed open.", rows: [] },
      reviewCacheTelemetry: { note: "review_cache_events table is not available; failed open.", rows: [] },
    });

    const sectionBudgetRow = lines.findIndex((line) => line.startsWith("section_budget,"));
    const sectionBudgetNote = lines.findIndex((line) => line.startsWith("section_budget_note,"));
    expect(sectionBudgetNote).toBeGreaterThanOrEqual(0);
    // Note row carries the message; with empty rows there is no preceding data row.
    expect(sectionBudgetRow).toBe(-1);
    const cacheNote = lines.findIndex((line) => line.startsWith("review_cache_telemetry_note,"));
    expect(cacheNote).toBeGreaterThan(sectionBudgetNote);
  });
});
