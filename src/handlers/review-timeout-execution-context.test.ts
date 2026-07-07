import { describe, expect, test } from "bun:test";
import { resolveReviewTimeoutExecutionContext } from "./review-timeout-execution-context.ts";

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
