import { describe, expect, test } from "bun:test";
import {
  M061_S03_CHECK_IDS,
  evaluateM061S03ReviewSectionProof,
  parseM061S03Args,
  renderM061S03ReviewSectionProof,
} from "./verify-m061-s03.ts";

describe("verify m061 s03 review section budget proof", () => {
  test("parses supported cli args", () => {
    expect(M061_S03_CHECK_IDS).toEqual([
      "M061-S03-PREFLIGHT",
      "M061-S03-REVIEW-USER-PROMPT-SECTIONS",
      "M061-S03-REVIEW-SECTION-TRUNCATION",
      "M061-S03-DELIVERY-ATTRIBUTION",
    ]);
    expect(parseM061S03Args([])).toEqual({
      since: null,
      repo: null,
      json: false,
      help: false,
    });
    expect(parseM061S03Args(["--repo", "acme/kodiai", "--since", "7d", "--json"])).toEqual({
      since: expect.stringMatching(/T/),
      repo: "acme/kodiai",
      json: true,
      help: false,
    });
  });

  test("passes when review telemetry exposes named review.user-prompt sections plus truncation evidence", () => {
    const report = evaluateM061S03ReviewSectionProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "acme/kodiai", since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: {
        summary: {
          totalExecutions: 1,
          totalInputTokens: 600,
          totalOutputTokens: 140,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalTokens: 740,
          totalCostUsd: 0.19,
          distinctDeliveries: 1,
        },
        taskTypes: [
          {
            taskType: "review.full",
            executions: 1,
            totalTokens: 740,
            totalCostUsd: 0.19,
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
            promptKinds: ["review.user-prompt"],
            sectionCount: 5,
            promptEstimatedTokens: 540,
            llmInputTokens: 600,
            llmOutputTokens: 140,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsd: 0.19,
          },
        ],
        promptSections: [
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-pr-context",
            executions: 1,
            totalEstimatedTokens: 40,
            totalCharCount: 160,
            truncatedExecutions: 0,
          },
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-change-context",
            executions: 1,
            totalEstimatedTokens: 180,
            totalCharCount: 720,
            truncatedExecutions: 1,
          },
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-size-context",
            executions: 1,
            totalEstimatedTokens: 60,
            totalCharCount: 240,
            truncatedExecutions: 0,
          },
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-graph-context",
            executions: 1,
            totalEstimatedTokens: 80,
            totalCharCount: 320,
            truncatedExecutions: 0,
          },
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-knowledge-context",
            executions: 1,
            totalEstimatedTokens: 70,
            totalCharCount: 280,
            truncatedExecutions: 0,
          },
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-instructions",
            executions: 1,
            totalEstimatedTokens: 110,
            totalCharCount: 440,
            truncatedExecutions: 1,
          },
        ],
        rateLimits: [],
      },
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.observed.reviewUserPromptSections).toEqual([
      "review-change-context",
      "review-graph-context",
      "review-instructions",
      "review-knowledge-context",
      "review-pr-context",
      "review-size-context",
    ]);
    expect(report.observed.truncatedReviewSections).toEqual([
      "review-change-context",
      "review-instructions",
    ]);
    expect(renderM061S03ReviewSectionProof(report)).toContain("Final verdict: PASS");
  });

  test("fails when review section attribution stays coarse or truncation evidence is absent", () => {
    const report = evaluateM061S03ReviewSectionProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: {
        summary: {
          totalExecutions: 1,
          totalInputTokens: 40,
          totalOutputTokens: 10,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalTokens: 50,
          totalCostUsd: 0.01,
          distinctDeliveries: 1,
        },
        taskTypes: [
          {
            taskType: "review.full",
            executions: 1,
            totalTokens: 50,
            totalCostUsd: 0.01,
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
            promptKinds: ["review.user-prompt"],
            sectionCount: 1,
            promptEstimatedTokens: 40,
            llmInputTokens: 40,
            llmOutputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsd: 0.01,
          },
        ],
        promptSections: [
          {
            taskType: "review.full",
            promptKind: "review.user-prompt",
            sectionName: "review-user-prompt",
            executions: 1,
            totalEstimatedTokens: 40,
            totalCharCount: 160,
            truncatedExecutions: 0,
          },
        ],
        rateLimits: [],
      },
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S03-REVIEW-USER-PROMPT-SECTIONS")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S03-REVIEW-SECTION-TRUNCATION")?.passed).toBe(false);
    expect(renderM061S03ReviewSectionProof(report)).toContain("Final verdict: FAIL");
  });

  test("renders fail-open preflight output when db access is unavailable", () => {
    const report = evaluateM061S03ReviewSectionProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "unavailable",
      accessDetail: "connect ECONNREFUSED",
      usageResult: null,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M061-S03-PREFLIGHT", passed: false }),
    ]);
    const output = renderM061S03ReviewSectionProof(report);
    expect(output).toContain("Database access: unavailable");
    expect(output).toContain("No live telemetry evidence available");
  });
});
