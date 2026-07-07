import { describe, expect, test } from "bun:test";
import {
  buildReviewTimeoutExecutionAdapters,
  resolveReviewTimeoutExecutionContext,
} from "./review-timeout-execution-context.ts";

describe("resolveReviewTimeoutExecutionContext", () => {
  test("classifies chronic timeout and timeout partial conclusion", async () => {
    const result = await resolveReviewTimeoutExecutionContext({
      repo: "owner/repo",
      prAuthor: "alice",
      outcome: {
        isTimeout: true,
        published: true,
        conclusion: "error",
      },
      turnBudgetExhausted: false,
      countRecentTimeouts: async (repo, author) => {
        expect(repo).toBe("owner/repo");
        expect(author).toBe("alice");
        return 3;
      },
    });

    expect(result).toEqual({
      recentTimeouts: 3,
      isChronicTimeout: true,
      executionConclusion: "timeout_partial",
    });
  });

  test("classifies max turns when timeout did not occur", async () => {
    const result = await resolveReviewTimeoutExecutionContext({
      repo: "owner/repo",
      prAuthor: "alice",
      outcome: {
        isTimeout: false,
        published: false,
        conclusion: "error",
      },
      turnBudgetExhausted: true,
      countRecentTimeouts: async () => undefined,
    });

    expect(result).toEqual({
      recentTimeouts: 0,
      isChronicTimeout: false,
      executionConclusion: "max_turns",
    });
  });
});

describe("buildReviewTimeoutExecutionAdapters", () => {
  test("binds the optional telemetry recent-timeout counter", async () => {
    const calls: Array<{ repo: string; author: string }> = [];
    const adapters = buildReviewTimeoutExecutionAdapters({
      telemetryStore: {
        countRecentTimeouts: async (repo, author) => {
          calls.push({ repo, author });
          return 4;
        },
      },
    });

    await expect(adapters.countRecentTimeouts("acme/repo", "octocat")).resolves.toBe(4);
    expect(calls).toEqual([{ repo: "acme/repo", author: "octocat" }]);
  });

  test("returns undefined when recent-timeout telemetry is unavailable", async () => {
    const adapters = buildReviewTimeoutExecutionAdapters({
      telemetryStore: {},
    });

    await expect(adapters.countRecentTimeouts("acme/repo", "octocat")).resolves.toBeUndefined();
  });
});
