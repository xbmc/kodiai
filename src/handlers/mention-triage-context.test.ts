import { describe, expect, test } from "bun:test";
import { buildMentionTriageContext } from "./mention-triage-context.ts";
import type { TriageValidationResult } from "../triage/types.ts";

const invalidResult: TriageValidationResult = {
  templateSlug: "bug-report",
  templateName: "Bug report",
  valid: false,
  sections: [
    {
      heading: "Steps to reproduce",
      status: "missing",
      hint: "List the exact steps.",
      required: true,
    },
  ],
};

function makeStore(initial?: { key: string; lastTriagedAt: number; bodyHash: string }) {
  const entries = new Map<string, { lastTriagedAt: number; bodyHash: string }>();
  const setCalls: Array<{ key: string; lastTriagedAt: number; bodyHash: string }> = [];
  if (initial) {
    entries.set(initial.key, {
      lastTriagedAt: initial.lastTriagedAt,
      bodyHash: initial.bodyHash,
    });
  }

  return {
    setCalls,
    store: {
      get: (key: string) => entries.get(key),
      set: (key: string, entry: { lastTriagedAt: number; bodyHash: string }) => {
        entries.set(key, entry);
        setCalls.push({ key, ...entry });
      },
    },
  };
}

function makeLogger() {
  const warnCalls: unknown[][] = [];
  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => warnCalls.push(args),
    },
  };
}

describe("buildMentionTriageContext", () => {
  test("returns guidance plus allowed label recommendation and records cooldown", async () => {
    const { store, setCalls } = makeStore();
    const { logger } = makeLogger();
    let validateCalls = 0;

    const result = await buildMentionTriageContext({
      enabled: true,
      isIssueThreadComment: true,
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      issueBody: "## Summary\nbroken",
      workspaceDir: "/tmp/workspace",
      cooldownMinutes: 30,
      labelAllowlist: ["needs-info:bug-report"],
      cooldownStore: store,
      now: () => 1_000_000,
      logger: logger as never,
      validateIssue: async () => {
        validateCalls += 1;
        return invalidResult;
      },
      generateGuidanceComment: () => "Please add reproduction steps.",
      generateLabelRecommendation: () => "needs-info:bug-report",
      generateGenericNudge: () => "Generic nudge",
    });

    expect(validateCalls).toBe(1);
    expect(result).toBe("Please add reproduction steps.\n\nRecommended label: `needs-info:bug-report`");
    expect(setCalls).toEqual([
      expect.objectContaining({
        key: "acme/repo#42",
        lastTriagedAt: 1_000_000,
      }),
    ]);
  });

  test("returns generic nudge when no template matches", async () => {
    const { store } = makeStore();
    const { logger } = makeLogger();

    const result = await buildMentionTriageContext({
      enabled: true,
      isIssueThreadComment: true,
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      issueBody: "plain issue body",
      workspaceDir: "/tmp/workspace",
      cooldownStore: store,
      logger: logger as never,
      validateIssue: async () => null,
      generateGuidanceComment: () => "unused",
      generateLabelRecommendation: () => null,
      generateGenericNudge: () => "Generic nudge",
    });

    expect(result).toBe("Generic nudge");
  });

  test("skips validation during cooldown for the same body", async () => {
    const body = "same body";
    const { store } = makeStore({
      key: "acme/repo#42",
      lastTriagedAt: 1_000_000,
      bodyHash: "8f6372a8b1509601",
    });
    const { logger } = makeLogger();
    let validateCalls = 0;

    const result = await buildMentionTriageContext({
      enabled: true,
      isIssueThreadComment: true,
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      issueBody: body,
      workspaceDir: "/tmp/workspace",
      cooldownMinutes: 30,
      cooldownStore: store,
      now: () => 1_000_001,
      logger: logger as never,
      validateIssue: async () => {
        validateCalls += 1;
        return invalidResult;
      },
      generateGuidanceComment: () => "unused",
      generateLabelRecommendation: () => null,
      generateGenericNudge: () => "unused",
    });

    expect(result).toBe("");
    expect(validateCalls).toBe(0);
  });

  test("fails open and logs when validation throws", async () => {
    const { store } = makeStore();
    const { logger, warnCalls } = makeLogger();

    const result = await buildMentionTriageContext({
      enabled: true,
      isIssueThreadComment: true,
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      issueBody: "body",
      workspaceDir: "/tmp/workspace",
      cooldownStore: store,
      logger: logger as never,
      validateIssue: async () => {
        throw new Error("triage unavailable");
      },
      generateGuidanceComment: () => "unused",
      generateLabelRecommendation: () => null,
      generateGenericNudge: () => "unused",
    });

    expect(result).toBe("");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({ issueNumber: 42 });
    expect(warnCalls[0]?.[1]).toBe("Triage validation failed (fail-open)");
  });
});
