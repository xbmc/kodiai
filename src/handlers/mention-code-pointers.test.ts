import { describe, expect, test } from "bun:test";
import { appendMentionIssueCodePointers } from "./mention-code-pointers.ts";
import type { PromptSectionMetric } from "../telemetry/types.ts";

function makeLogger() {
  const warnCalls: unknown[][] = [];
  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => warnCalls.push(args),
    },
  };
}

describe("appendMentionIssueCodePointers", () => {
  test("does not build code pointers when disabled", async () => {
    const { logger } = makeLogger();
    let buildCalls = 0;
    const sections: PromptSectionMetric[] = [];

    const result = await appendMentionIssueCodePointers({
      enabled: false,
      mentionContext: "existing context",
      mentionContextSectionMetrics: sections,
      workspaceDir: "/tmp/workspace",
      question: "update the docs",
      logger: logger as never,
      logContext: { surface: "issue", issueNumber: 7 },
      buildIssueCodeContext: async () => {
        buildCalls += 1;
        return { paths: [], contextBlock: "README.md: docs" };
      },
    });

    expect(buildCalls).toBe(0);
    expect(result).toEqual({
      mentionContext: "existing context",
      mentionContextSectionMetrics: sections,
    });
  });

  test("appends candidate code pointers and section metrics", async () => {
    const { logger } = makeLogger();
    const sections: PromptSectionMetric[] = [
      {
        sectionName: "existing",
        sectionPosition: 0,
        charCount: 16,
        estimatedTokens: 4,
      },
    ];

    const result = await appendMentionIssueCodePointers({
      enabled: true,
      mentionContext: "existing context",
      mentionContextSectionMetrics: sections,
      workspaceDir: "/tmp/workspace",
      question: "update the docs",
      logger: logger as never,
      logContext: { surface: "issue", issueNumber: 7 },
      buildIssueCodeContext: async (params) => {
        expect(params).toEqual({
          workspaceDir: "/tmp/workspace",
          question: "update the docs",
        });
        return { paths: [], contextBlock: "README.md: docs\nsrc/app.ts: handler" };
      },
    });

    const expectedSection = "## Candidate Code Pointers\n\nREADME.md: docs\nsrc/app.ts: handler";
    expect(result.mentionContext).toBe(`existing context\n${expectedSection}`);
    expect(result.mentionContextSectionMetrics).toEqual([
      sections[0]!,
      {
        sectionName: "candidate-code-pointers",
        sectionPosition: 1,
        charCount: expectedSection.length,
        estimatedTokens: Math.ceil(expectedSection.length / 4),
      },
    ]);
    expect(sections).toHaveLength(1);
  });

  test("omits blank candidate code pointer blocks", async () => {
    const { logger } = makeLogger();
    const sections: PromptSectionMetric[] = [];

    const result = await appendMentionIssueCodePointers({
      enabled: true,
      mentionContext: "existing context",
      mentionContextSectionMetrics: sections,
      workspaceDir: "/tmp/workspace",
      question: "update the docs",
      logger: logger as never,
      logContext: { surface: "issue", issueNumber: 7 },
      buildIssueCodeContext: async () => ({ paths: [], contextBlock: "   \n" }),
    });

    expect(result.mentionContext).toBe("existing context");
    expect(result.mentionContextSectionMetrics).toEqual([]);
  });

  test("fails open and logs when code pointer generation throws", async () => {
    const { logger, warnCalls } = makeLogger();
    const sections: PromptSectionMetric[] = [];

    const result = await appendMentionIssueCodePointers({
      enabled: true,
      mentionContext: "existing context",
      mentionContextSectionMetrics: sections,
      workspaceDir: "/tmp/workspace",
      question: "update the docs",
      logger: logger as never,
      logContext: { surface: "issue", issueNumber: 7 },
      buildIssueCodeContext: async () => {
        throw new Error("scan failed");
      },
    });

    expect(result).toEqual({
      mentionContext: "existing context",
      mentionContextSectionMetrics: [],
    });
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({ surface: "issue", issueNumber: 7 });
    expect(warnCalls[0]?.[1]).toBe("Failed to build issue code context; proceeding without code pointers");
  });
});
