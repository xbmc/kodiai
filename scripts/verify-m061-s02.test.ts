import { describe, expect, test } from "bun:test";
import {
  M061_S02_CHECK_IDS,
  evaluateM061S02MentionContextProof,
  parseM061S02Args,
  renderM061S02MentionContextProof,
} from "./verify-m061-s02.ts";

describe("verify m061 s02 mention context diet proof", () => {
  test("parses supported cli args", () => {
    expect(M061_S02_CHECK_IDS).toEqual([
      "M061-S02-PREFLIGHT",
      "M061-S02-MENTION-CONTEXT-SECTIONS",
      "M061-S02-MENTION-USER-PROMPT",
    ]);
    expect(parseM061S02Args([])).toEqual({
      since: null,
      repo: null,
      json: false,
      help: false,
    });
    expect(parseM061S02Args(["--repo", "acme/kodiai", "--since", "7d", "--json"])).toEqual({
      since: expect.stringMatching(/T/),
      repo: "acme/kodiai",
      json: true,
      help: false,
    });
  });

  test("passes when mention telemetry exposes fine-grained context sections and canonical user prompt accounting", () => {
    const report = evaluateM061S02MentionContextProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: "acme/kodiai", since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: {
        summary: {
          totalExecutions: 1,
          totalInputTokens: 300,
          totalOutputTokens: 90,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalTokens: 390,
          totalCostUsd: 0.11,
          distinctDeliveries: 1,
        },
        taskTypes: [
          {
            taskType: "mention.response",
            executions: 1,
            totalTokens: 390,
            totalCostUsd: 0.11,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheEffectiveness: 0,
          },
        ],
        deliveryBreakdown: [],
        promptSections: [
          {
            taskType: "mention.response",
            promptKind: "mention.context",
            sectionName: "mention-conversation-history",
            executions: 1,
            totalEstimatedTokens: 80,
            totalCharCount: 320,
            truncatedExecutions: 0,
          },
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
            promptKind: "mention.user-prompt",
            sectionName: "mention-user-prompt",
            executions: 1,
            totalEstimatedTokens: 120,
            totalCharCount: 480,
            truncatedExecutions: 0,
          },
        ],
        rateLimits: [],
        reuseEvidence: [],
      },
    });

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.observed.mentionContextSections).toEqual([
      "candidate-code-pointers",
      "mention-conversation-history",
    ]);
    expect(renderM061S02MentionContextProof(report)).toContain("Final verdict: PASS");
  });

  test("fails when mention context attribution stays coarse or mention.user-prompt goes missing", () => {
    const report = evaluateM061S02MentionContextProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "available",
      accessDetail: "Connected to telemetry Postgres.",
      usageResult: {
        summary: {
          totalExecutions: 1,
          totalInputTokens: 20,
          totalOutputTokens: 5,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalTokens: 25,
          totalCostUsd: 0.01,
          distinctDeliveries: 1,
        },
        taskTypes: [
          {
            taskType: "mention.response",
            executions: 1,
            totalTokens: 25,
            totalCostUsd: 0.01,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheEffectiveness: 0,
          },
        ],
        deliveryBreakdown: [],
        promptSections: [
          {
            taskType: "mention.response",
            promptKind: "mention.context",
            sectionName: "conversation-history",
            executions: 1,
            totalEstimatedTokens: 10,
            totalCharCount: 40,
            truncatedExecutions: 0,
          },
        ],
        rateLimits: [],
        reuseEvidence: [],
      },
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S02-MENTION-CONTEXT-SECTIONS")?.passed).toBe(false);
    expect(report.checks.find((check) => check.id === "M061-S02-MENTION-USER-PROMPT")?.passed).toBe(false);
    expect(renderM061S02MentionContextProof(report)).toContain("Final verdict: FAIL");
  });

  test("renders fail-open preflight output when db access is unavailable", () => {
    const report = evaluateM061S02MentionContextProof({
      generatedAt: "2026-04-24T00:00:00.000Z",
      filters: { repo: null, since: null },
      accessState: "unavailable",
      accessDetail: "connect ECONNREFUSED",
      usageResult: null,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M061-S02-PREFLIGHT", passed: false }),
    ]);
    const output = renderM061S02MentionContextProof(report);
    expect(output).toContain("Database access: unavailable");
    expect(output).toContain("No live telemetry evidence available");
  });
});
