import { describe, expect, test } from "bun:test";
import {
  M061_S01_CHECK_IDS,
  evaluateM061S01BaselineProof,
  parseM061S01Args,
  renderM061S01BaselineProof,
} from "./verify-m061-s01.ts";

describe("verify m061 s01 baseline proof", () => {
  test("parses supported cli args", () => {
    expect(M061_S01_CHECK_IDS).toEqual([
      "M061-S01-PREFLIGHT",
      "M061-S01-TASK-PATH-ATTRIBUTION",
      "M061-S01-PROMPT-SECTIONS",
      "M061-S01-DELIVERY-BREAKDOWN",
      "M061-S01-CACHE-EVIDENCE",
    ]);
    expect(parseM061S01Args([])).toEqual({
      since: null,
      repo: null,
      json: false,
      help: false,
    });
    expect(parseM061S01Args(["--repo", "acme/kodiai", "--since", "7d", "--json"])).toEqual({
      since: expect.stringMatching(/T/),
      repo: "acme/kodiai",
      json: true,
      help: false,
    });
  });

  test("passes when usage-report surfaces review, mention, slack, prompt sections, delivery attribution, and cache evidence", () => {
    const report = evaluateM061S01BaselineProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "acme/kodiai", since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: {
        summary: {
          totalExecutions: 3,
          totalInputTokens: 900,
          totalOutputTokens: 300,
          totalCacheReadTokens: 120,
          totalCacheWriteTokens: 80,
          totalTokens: 1200,
          totalCostUsd: 0.42,
          distinctDeliveries: 3,
        },
        taskTypes: [
          {
            taskType: "review.full",
            executions: 1,
            totalTokens: 700,
            totalCostUsd: 0.2,
            cacheReadTokens: 120,
            cacheWriteTokens: 80,
            cacheEffectiveness: 0.17,
          },
          {
            taskType: "mention.response",
            executions: 1,
            totalTokens: 300,
            totalCostUsd: 0.1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheEffectiveness: 0,
          },
          {
            taskType: "slack.response",
            executions: 1,
            totalTokens: 200,
            totalCostUsd: 0.12,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheEffectiveness: 0,
          },
        ],
        deliveryBreakdown: [
          {
            deliveryId: "review-1",
            repo: "acme/kodiai",
            taskType: "review.full",
            promptKinds: ["review.full"],
            sectionCount: 4,
            promptEstimatedTokens: 500,
            llmInputTokens: 600,
            llmOutputTokens: 100,
            cacheReadTokens: 120,
            cacheWriteTokens: 80,
            estimatedCostUsd: 0.2,
          },
          {
            deliveryId: "mention-1",
            repo: "acme/kodiai",
            taskType: "mention.response",
            promptKinds: ["mention.context", "mention.response"],
            sectionCount: 3,
            promptEstimatedTokens: 220,
            llmInputTokens: 250,
            llmOutputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsd: 0.1,
          },
          {
            deliveryId: "slack-1",
            repo: "acme/kodiai",
            taskType: "slack.response",
            promptKinds: ["slack.response"],
            sectionCount: 0,
            promptEstimatedTokens: 0,
            llmInputTokens: 50,
            llmOutputTokens: 150,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsd: 0.12,
          },
        ],
        promptSections: [
          {
            taskType: "review.full",
            promptKind: "review.full",
            sectionName: "repository-context",
            executions: 1,
            totalEstimatedTokens: 200,
            totalCharCount: 800,
            truncatedExecutions: 0,
          },
          {
            taskType: "mention.response",
            promptKind: "mention.context",
            sectionName: "conversation-context",
            executions: 1,
            totalEstimatedTokens: 120,
            totalCharCount: 400,
            truncatedExecutions: 0,
          },
        ],
        rateLimits: [
          {
            taskType: "review.full",
            executions: 1,
            avgCacheHitRate: 1,
            totalSkippedQueries: 0,
            degradationCount: 0,
          },
        ],
      },
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.observed.taskTypes).toEqual(["mention.response", "review.full", "slack.response"]);
    expect(renderM061S01BaselineProof(report)).toContain("Final verdict: PASS");
    expect(renderM061S01BaselineProof(report)).toContain("Usage report snapshot");
  });

  test("fails specific checks when baseline attribution surfaces are incomplete", () => {
    const report = evaluateM061S01BaselineProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: {
        summary: {
          totalExecutions: 1,
          totalInputTokens: 10,
          totalOutputTokens: 5,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalTokens: 15,
          totalCostUsd: 0.01,
          distinctDeliveries: 1,
        },
        taskTypes: [
          {
            taskType: "review.full",
            executions: 1,
            totalTokens: 15,
            totalCostUsd: 0.01,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheEffectiveness: 0,
          },
        ],
        deliveryBreakdown: [],
        promptSections: [],
        rateLimits: [],
      },
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S01-TASK-PATH-ATTRIBUTION")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S01-PROMPT-SECTIONS")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S01-DELIVERY-BREAKDOWN")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S01-CACHE-EVIDENCE")?.passed).toBe(false);
    expect(renderM061S01BaselineProof(report)).toContain("Final verdict: FAIL");
  });

  test("renders fail-open preflight output when db access is unavailable", () => {
    const report = evaluateM061S01BaselineProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "unavailable",
      accessDetail: "connect ECONNREFUSED",
      usageResult: null,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M061-S01-PREFLIGHT", passed: false }),
    ]);
    const output = renderM061S01BaselineProof(report);
    expect(output).toContain("Database access: unavailable");
    expect(output).toContain("No live telemetry evidence available");
  });
});
