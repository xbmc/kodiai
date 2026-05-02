import { describe, test, expect, mock } from "bun:test";
import {
  classifyError,
  formatErrorComment,
  postOrUpdateErrorComment,
  type ErrorCategory,
} from "./errors";

// --- classifyError ---

describe("classifyError", () => {
  test("returns 'timeout' when isTimeout is true regardless of error message", () => {
    expect(classifyError(new Error("some random error"), true)).toBe("timeout");
    expect(classifyError(new Error("clone failed"), true)).toBe("timeout");
    expect(classifyError(new Error(".kodiai.yml invalid"), true)).toBe("timeout");
    expect(classifyError("string error", true)).toBe("timeout");
  });

  test("returns 'timeout_partial' when isTimeout is true and published is true", () => {
    expect(classifyError(new Error("some error"), true, true)).toBe("timeout_partial");
    expect(classifyError(new Error("clone failed"), true, true)).toBe("timeout_partial");
  });

  test("returns 'config_error' when message contains .kodiai.yml", () => {
    expect(
      classifyError(new Error("Invalid .kodiai.yml: parse error"), false),
    ).toBe("config_error");
  });

  test("returns 'clone_error' when message contains 'clone' (case insensitive)", () => {
    expect(
      classifyError(new Error("Failed to clone repository"), false),
    ).toBe("clone_error");
    expect(
      classifyError(new Error("Clone operation timed out"), false),
    ).toBe("clone_error");
  });

  test("returns 'clone_error' when message contains 'git' (case insensitive)", () => {
    expect(
      classifyError(new Error("git fetch failed"), false),
    ).toBe("clone_error");
    expect(
      classifyError(new Error("Git authentication error"), false),
    ).toBe("clone_error");
  });

  test("returns 'api_error' when message contains 'rate limit'", () => {
    expect(
      classifyError(new Error("GitHub rate limit exceeded"), false),
    ).toBe("api_error");
  });

  test("returns 'api_error' when message contains 'API'", () => {
    expect(
      classifyError(new Error("API request failed"), false),
    ).toBe("api_error");
  });

  test("returns 'api_error' when message contains status code patterns", () => {
    expect(
      classifyError(new Error("Request failed with status 403"), false),
    ).toBe("api_error");
    expect(
      classifyError(new Error("Server returned 500"), false),
    ).toBe("api_error");
  });

  test("returns 'usage_limit' for Claude Code usage limit errors", () => {
    expect(
      classifyError(new Error("Claude Code returned an error result: You've hit your limit · resets 10:50pm (UTC)"), false),
    ).toBe("usage_limit");
    expect(
      classifyError(new Error("usage limit exceeded"), false),
    ).toBe("usage_limit");
  });

  test("returns 'internal_error' as default", () => {
    expect(
      classifyError(new Error("something unexpected happened"), false),
    ).toBe("internal_error");
  });

  test("handles non-Error values", () => {
    expect(classifyError("string error", false)).toBe("internal_error");
    expect(classifyError(42, false)).toBe("internal_error");
    expect(classifyError(null, false)).toBe("internal_error");
    expect(classifyError(undefined, false)).toBe("internal_error");
  });
});

// --- formatErrorComment ---

describe("formatErrorComment", () => {
  const categories: ErrorCategory[] = [
    "timeout",
    "timeout_partial",
    "api_error",
    "config_error",
    "clone_error",
    "internal_error",
    "usage_limit",
  ];

  test("produces correct markdown structure for each category", () => {
    const expectedHeaders: Record<ErrorCategory, string> = {
      timeout: "Kodiai timed out",
      timeout_partial: "Kodiai completed a partial review",
      api_error: "Kodiai encountered an API error",
      config_error: "Kodiai found a configuration problem",
      clone_error: "Kodiai couldn't access the repository",
      internal_error: "Kodiai encountered an error",
      usage_limit: "Kodiai hit its Claude usage limit",
    };

    for (const category of categories) {
      const result = formatErrorComment(category, "test detail");
      expect(result).toContain(`> **${expectedHeaders[category]}**`);
      expect(result).toContain("_test detail_");
    }
  });

  test("includes suggestion for timeout", () => {
    const result = formatErrorComment("timeout", "detail");
    expect(result).toContain("smaller pieces");
    expect(result).toContain("`.kodiai.yml`");
  });

  test("includes suggestion for timeout_partial", () => {
    const result = formatErrorComment("timeout_partial", "detail");
    expect(result).toContain("partial review");
    expect(result).toContain("inline comments");
  });

  test("includes suggestion for api_error", () => {
    const result = formatErrorComment("api_error", "detail");
    expect(result).toContain("temporary");
    expect(result).toContain("few minutes");
  });

  test("includes suggestion for config_error", () => {
    const result = formatErrorComment("config_error", "detail");
    expect(result).toContain("`.kodiai.yml`");
    expect(result).toContain("syntax or schema");
  });

  test("includes suggestion for clone_error", () => {
    const result = formatErrorComment("clone_error", "detail");
    expect(result).toContain("accessible");
    expect(result).toContain("branch exists");
  });

  test("includes suggestion for internal_error", () => {
    const result = formatErrorComment("internal_error", "detail");
    expect(result).toContain("persists");
    expect(result).toContain("report");
  });

  test("includes suggestion for usage_limit", () => {
    const result = formatErrorComment("usage_limit", "Claude Code returned an error result: You've hit your limit · resets 10:50pm (UTC)");
    expect(result).toContain("try again after the reset time");
    expect(result).toContain("kodiai:error:usage-limit");
  });

  test("redacts GitHub tokens in detail", () => {
    const token = "ghs_" + "a".repeat(36);
    const result = formatErrorComment("internal_error", `Error with token ${token}`);
    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  test("redacts multiple token types in detail", () => {
    const ghpToken = "ghp_" + "b".repeat(36);
    const ghsToken = "ghs_" + "c".repeat(36);
    const result = formatErrorComment(
      "api_error",
      `Auth failed: ${ghpToken} and ${ghsToken}`,
    );
    expect(result).not.toContain(ghpToken);
    expect(result).not.toContain(ghsToken);
    expect(result).toContain("[REDACTED_GITHUB_TOKEN]");
  });
});

// --- postOrUpdateErrorComment duplicate handling ---

describe("postOrUpdateErrorComment", () => {
  test("updates a recent usage-limit error comment instead of creating a duplicate", async () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const existingBody = wrapUsageLimitBody("first failure");
    const replacementBody = wrapUsageLimitBody("second failure");
    const createComment = mock(async () => ({ data: { id: 2 } }));
    const updateComment = mock(async () => ({ data: { id: 1 } }));
    const listComments = mock(async () => ({
      data: [
        {
          id: 1,
          body: existingBody,
          created_at: createdAt,
          user: { login: "kodiai[bot]" },
        },
      ],
    }));
    const logger = { error: mock(() => undefined) };

    const result = await postOrUpdateErrorComment(
      {
        rest: {
          issues: { createComment, updateComment, listComments },
        },
      } as never,
      { owner: "acme", repo: "repo", issueNumber: 42 },
      replacementBody,
      logger as never,
    );

    expect(result).toEqual({ ok: true, resolution: "updated", method: "update-comment" });
    expect(listComments).toHaveBeenCalledTimes(1);
    expect(updateComment).toHaveBeenCalledTimes(1);
    const updateCall = updateComment.mock.calls[0] as unknown[] | undefined;
    expect(updateCall?.[0]).toMatchObject({ comment_id: 1, body: replacementBody });
    expect(createComment).not.toHaveBeenCalled();
  });
});

function wrapUsageLimitBody(detail: string): string {
  return `<details>\n<summary>Kodiai encountered an error</summary>\n\n${formatErrorComment("usage_limit", detail)}\n\n</details>`;
}
