import { describe, expect, test } from "bun:test";
import fixture from "../../scripts/fixtures/m073-s01-baseline-scorecard.json";
import {
  evaluateReviewCostBaselineScorecard,
  type ReviewCostBaselineInput,
} from "./scorecard.ts";

function cloneFixture(): ReviewCostBaselineInput {
  return structuredClone(fixture) as ReviewCostBaselineInput;
}

function checkStatuses(report: ReturnType<typeof evaluateReviewCostBaselineScorecard>, id: string): string[] {
  return report.checks.filter((check) => check.id === id).map((check) => check.status);
}

describe("review cost baseline scorecard", () => {
  test("summarizes prompt sections, retrieval/cache, runtime usage, and phase latency for normal and retry cases", () => {
    const report = evaluateReviewCostBaselineScorecard(cloneFixture());

    expect(report.status).toBe("pass");
    expect(report.totals).toMatchObject({
      caseCount: 2,
      deliveryCount: 3,
      promptEstimatedTokens: 2550,
      promptCharCount: 10200,
      runtimeInputTokens: 18400,
      runtimeOutputTokens: 2800,
      runtimeCacheReadTokens: 4600,
      runtimeCacheWriteTokens: 1600,
      runtimeTotalTokens: 21200,
      runtimeEstimatedCostUsd: 0.227,
      runtimeDurationMs: 198000,
      phaseLatencyMs: 213700,
    });
    expect(checkStatuses(report, "redaction.safe")).toEqual(["pass", "pass", "pass"]);

    const normal = report.cases.find((scorecardCase) => scorecardCase.caseId === "normal-full-review");
    expect(normal).toBeDefined();
    expect(normal?.promptSections).toContainEqual({
      promptKind: "user",
      sectionName: "changed-files-summary",
      executions: 1,
      totalCharCount: 2400,
      totalEstimatedTokens: 600,
      truncatedExecutions: 1,
    });
    expect(normal?.retrievalCache).toEqual([
      {
        evidenceType: "retrieval.query-embedding",
        statuses: ["hit"],
        executions: 1,
        reusedUnits: 3,
        primaryWorkUnits: 4,
        skippedQueries: 1,
        retryAttempts: 0,
        avgCacheHitRate: 0.75,
      },
    ]);
    expect(normal?.runtimeUsage.totalTokens).toBe(7300);

    const retry = report.cases.find((scorecardCase) => scorecardCase.caseId === "retry-timeout-review");
    expect(retry?.continuationRetry).toEqual({
      initialDeliveries: 1,
      continuationDeliveries: 0,
      retryDeliveries: 1,
      attributedChildDeliveries: 1,
      missingParentDeliveries: [],
    });
    expect(retry?.runtimeUsage).toMatchObject({
      executions: 2,
      inputTokens: 12200,
      outputTokens: 1700,
      totalTokens: 13900,
      estimatedCostUsd: 0.146,
    });
    expect(retry?.phaseLatencies.find((row) => row.phase === "remote runtime")).toMatchObject({
      executions: 2,
      totalDurationMs: 156000,
      statuses: ["completed", "degraded"],
    });
  });

  test("returns failed checks for missing runtime token rows instead of throwing", () => {
    const input = cloneFixture();
    input.runtimeUsage = input.runtimeUsage.filter((row) => row.caseId !== "normal-full-review");

    const report = evaluateReviewCostBaselineScorecard(input);

    expect(report.status).toBe("fail");
    expect(report.cases.find((scorecardCase) => scorecardCase.caseId === "normal-full-review")?.runtimeUsage.totalTokens).toBe(0);
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "runtime-usage.present",
      status: "fail",
      caseId: "normal-full-review",
    }));
  });

  test("malformed rows produce bounded issue strings", () => {
    const report = evaluateReviewCostBaselineScorecard({
      ...cloneFixture(),
      runtimeUsage: [
        {
          caseId: "normal-full-review",
          deliveryId: "delivery-normal-001",
          taskType: "review",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          sdk: "agent",
          inputTokens: -1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
          usedFallback: false,
        },
      ],
    });

    expect(report.status).toBe("fail");
    expect(report.cases).toEqual([]);
    expect(report.checks[0]).toMatchObject({ id: "cases.present", status: "fail" });
    expect(report.checks[0]?.issues.join("\n")).toContain("runtimeUsage[0] has invalid inputTokens.");
    expect(report.checks[0]?.issues.every((issue) => issue.length <= 220)).toBe(true);
  });

  test("unknown cache status fails validation with a named bounded check", () => {
    const input = cloneFixture() as unknown as Record<string, unknown>;
    input.retrievalCache = [
      {
        caseId: "normal-full-review",
        deliveryId: "delivery-normal-001",
        evidenceType: "retrieval.query-embedding",
        status: "warmish",
        cacheHitRate: 0.5,
        reusedUnits: 1,
        primaryWorkUnits: 2,
        skippedQueries: 0,
        retryAttempts: 0,
      },
    ];

    const report = evaluateReviewCostBaselineScorecard(input);

    expect(report.status).toBe("fail");
    expect(report.checks[0]?.issues.join("\n")).toContain("retrievalCache[0] has invalid status.");
  });

  test("raw text-looking fields and secret-like values fail redaction checks without echoing payloads", () => {
    const input = cloneFixture() as unknown as Record<string, unknown>;
    input.promptSections = [
      ...cloneFixture().promptSections,
      {
        caseId: "normal-full-review",
        deliveryId: "delivery-normal-001",
        repo: "octo/example",
        taskType: "review",
        promptKind: "user",
        promptText: "do not include raw prompt bodies",
        secretName: "sk-test-secret-value",
        sections: [{ sectionName: "bounded", sectionPosition: 0, charCount: 4, estimatedTokens: 1 }],
      },
    ];

    const report = evaluateReviewCostBaselineScorecard(input);

    expect(report.status).toBe("fail");
    const redactionIssues = report.checks.filter((check) => check.id === "redaction.safe").flatMap((check) => check.issues);
    expect(redactionIssues.some((issue) => issue.includes("promptText is a forbidden raw-text field"))).toBe(true);
    expect(redactionIssues.some((issue) => issue.includes("secret-like value"))).toBe(true);
    expect(redactionIssues.join("\n")).not.toContain("sk-test-secret-value");
    expect(redactionIssues.join("\n")).not.toContain("do not include raw prompt bodies");
  });

  test("retry cases fail when child delivery lacks valid parent attribution", () => {
    const input = cloneFixture();
    input.continuations = input.continuations.map((row) => row.deliveryId === "delivery-retry-child-001"
      ? { ...row, parentDeliveryId: "missing-parent-delivery" }
      : row);

    const report = evaluateReviewCostBaselineScorecard(input);

    expect(report.status).toBe("fail");
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "continuation.attributed",
      status: "fail",
      caseId: "retry-timeout-review",
      issues: ["Missing valid parentDeliveryId for delivery-retry-child-001."],
    }));
  });

  test("empty case lists fail cleanly", () => {
    const input = cloneFixture();
    input.cases = [];

    const report = evaluateReviewCostBaselineScorecard(input);

    expect(report.status).toBe("fail");
    expect(report.cases).toEqual([]);
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "cases.present",
      status: "fail",
      issues: ["Expected at least one replay case."],
    }));
  });
});
