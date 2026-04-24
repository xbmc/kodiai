import { describe, expect, test } from "bun:test";
import {
  evaluateM061S04Proof,
  renderM061S04Proof,
  runM061S04ProofCli,
  type M061S04ProofReport,
} from "./verify-m061-s04.ts";
import type { UsageReportQueryResult } from "./usage-report.ts";

function buildUsageResult(overrides: Partial<UsageReportQueryResult> = {}): UsageReportQueryResult {
  return {
    summary: {
      totalExecutions: 3,
      totalInputTokens: 120,
      totalOutputTokens: 45,
      totalCacheReadTokens: 15,
      totalCacheWriteTokens: 0,
      totalTokens: 165,
      totalCostUsd: 0.12,
      distinctDeliveries: 3,
    },
    taskTypes: [],
    deliveryBreakdown: [],
    promptSections: [],
    rateLimits: [],
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
        executions: 3,
        hitExecutions: 1,
        missExecutions: 1,
        degradedExecutions: 1,
        bypassExecutions: 0,
        reusedUnits: 1,
        primaryWorkUnits: 2,
        avgReuseRate: 0.3333,
        statuses: ["degraded", "hit", "miss"],
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

describe("evaluateM061S04Proof", () => {
  test("passes when canonical reuse evidence exposes retrieval hits and explicit derived-cache fallback states", () => {
    const report = evaluateM061S04Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "acme/repo", since: "2026-04-17T00:00:00.000Z" },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: buildUsageResult(),
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.map((check) => check.statusCode)).toEqual([
      "telemetry_available",
      "reuse_surface_available",
      "retrieval_reuse_proven",
      "derived_cache_truthful",
    ]);
  });

  test("fails with explicit status codes when reuse evidence rows are missing or ambiguous", () => {
    const report = evaluateM061S04Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: buildUsageResult({
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
    expect(report.checks.find((check) => check.id === "M061-S04-REUSE-SURFACE")?.statusCode).toBe("reuse_surface_missing");
    expect(report.checks.find((check) => check.id === "M061-S04-RETRIEVAL-REUSE")?.statusCode).toBe("retrieval_reuse_missing_or_degraded");
    expect(report.checks.find((check) => check.id === "M061-S04-DERIVED-CACHE-TRUTHFULNESS")?.statusCode).toBe("derived_cache_evidence_missing_or_ambiguous");
  });

  test("fails open when database access is unavailable", () => {
    const report = evaluateM061S04Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "unavailable",
      accessDetail: "connect ECONNREFUSED",
      usageResult: null,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.preflight.databaseAccess).toBe("unavailable");
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.statusCode).toBe("telemetry_unavailable");
  });
});

describe("renderM061S04Proof", () => {
  test("renders named check status codes and observed reuse evidence", () => {
    const report = evaluateM061S04Proof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "acme/repo", since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: buildUsageResult(),
    });

    const text = renderM061S04Proof(report as M061S04ProofReport);
    expect(text).toContain("M061-S04-RETRIEVAL-REUSE PASS (retrieval_reuse_proven)");
    expect(text).toContain("Observed reuse evidence");
    expect(text).toContain("retrieval.query-embedding");
    expect(text).toContain("statuses=degraded, hit, miss");
  });
});

describe("runM061S04ProofCli", () => {
  test("returns a fail-open missing-access report when no database URL is configured", async () => {
    const { report, exitCode, json } = await runM061S04ProofCli([], {});

    expect(exitCode).toBe(0);
    expect(json).toBe(false);
    expect(report.preflight.databaseAccess).toBe("missing");
    expect(report.checks[0]?.statusCode).toBe("telemetry_missing");
  });
});
