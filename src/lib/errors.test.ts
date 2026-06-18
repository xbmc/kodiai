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
      internal_error: "Kodiai could not complete the request",
      usage_limit: "Kodiai hit its review provider usage limit",
    };

    for (const category of categories) {
      const result = formatErrorComment(category, "test detail");
      expect(result).toContain(`> **${expectedHeaders[category]}**`);
      expect(result).not.toContain("_test detail_");
      expect(result).toContain("_");
    }
  });

  test("includes suggestion for timeout", () => {
    const result = formatErrorComment("timeout", "detail");
    expect(result).toContain("narrower request");
    expect(result).toContain("@kodiai review path/to/file.cpp");
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
    expect(result).toContain("recorded in KodiAI logs");
    expect(result).toContain("narrow");
  });

  test("includes suggestion for usage_limit", () => {
    const result = formatErrorComment("usage_limit", "Claude Code returned an error result: You've hit your limit · resets 10:50pm (UTC)");
    expect(result).toContain("try again after the reset time");
    expect(result).toContain("kodiai:error:usage-limit");
    expect(result).toContain("reset 10:50pm (UTC)");
    expect(result).not.toContain("Claude Code returned an error result");
  });

  test("does not expose raw executor or workspace details in public errors", () => {
    const result = formatErrorComment(
      "internal_error",
      "Failed with exit code 143 while chmod '/mnt/kodiai-workspaces/run/repo/privacy-policy.txt'",
    );

    expect(result).toContain("failed before KodiAI could publish");
    expect(result).not.toContain("exit code");
    expect(result).not.toContain("/mnt/kodiai-workspaces");
    expect(result).not.toContain("privacy-policy.txt");
    expect(result).not.toContain("chmod");
  });

  test("does not expose remote diagnostics in timeout comments", () => {
    const result = formatErrorComment(
      "timeout",
      [
        "Job timed out after 717 seconds.",
        "Last remote diagnostics:",
        "2026-05-03T18:12:59.142Z turn=71 tool=Bash target=git show",
      ].join("\n"),
    );

    expect(result).toContain("exceeded its execution time");
    expect(result).not.toContain("Last remote diagnostics");
    expect(result).not.toContain("git show");
    expect(result).not.toContain("turn=71");
  });

  test("does not expose raw API or validation payloads", () => {
    const apiResult = formatErrorComment(
      "api_error",
      `launchAcaJob: REST API returned 400: {"error":{"code":"ContainerAppImageRequired","message":"Container with name 'caj-kodiai-agent' must have an 'Image' property specified."}}`,
    );
    const configResult = formatErrorComment(
      "config_error",
      "Branch name contains invalid characters (allowed: alphanumeric, _, /, ., -): plugin.video.youtube@matrix",
    );

    expect(apiResult).toContain("API request failed");
    expect(apiResult).not.toContain("ContainerAppImageRequired");
    expect(apiResult).not.toContain("caj-kodiai-agent");
    expect(configResult).toContain("repository configuration");
    expect(configResult).not.toContain("plugin.video.youtube@matrix");
    expect(configResult).not.toContain("allowed: alphanumeric");
  });

  test("redacts GitHub tokens in detail", () => {
    const token = "ghs_" + "a".repeat(36);
    const result = formatErrorComment("internal_error", `Error with token ${token}`);
    expect(result).not.toContain(token);
    expect(result).not.toContain("[REDACTED_GITHUB_TOKEN]");
    expect(result).toContain("failed before KodiAI could publish");
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
    expect(result).not.toContain("[REDACTED_GITHUB_TOKEN]");
    expect(result).toContain("API request failed");
  });
});

// --- postOrUpdateErrorComment duplicate handling ---

describe("postOrUpdateErrorComment", () => {
  test("retries a rate-limited create before reporting success", async () => {
    let createCalls = 0;
    const createComment = mock(async () => {
      createCalls++;
      if (createCalls === 1) {
        const err = new Error("Rate limited") as Error & {
          status?: number;
          response?: { headers?: Record<string, string> };
        };
        err.status = 429;
        err.response = { headers: { "retry-after": "0" } };
        throw err;
      }
      return { data: { id: 2 } };
    });
    const updateComment = mock(async () => ({ data: { id: 1 } }));
    const listComments = mock(async () => ({ data: [] }));
    const logger = { error: mock(() => undefined) };

    const result = await postOrUpdateErrorComment(
      {
        rest: {
          issues: { createComment, updateComment, listComments },
        },
      } as never,
      { owner: "acme", repo: "repo", issueNumber: 42 },
      formatErrorComment("internal_error", "executor failed"),
      logger as never,
    );

    expect(result).toEqual({ ok: true, resolution: "created", method: "create-comment" });
    expect(createComment).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("retries a rate-limited tracked update before reporting success", async () => {
    let updateCalls = 0;
    const createComment = mock(async () => ({ data: { id: 2 } }));
    const updateComment = mock(async () => {
      updateCalls++;
      if (updateCalls === 1) {
        const err = new Error("Rate limited") as Error & {
          status?: number;
          response?: { headers?: Record<string, string> };
        };
        err.status = 429;
        err.response = { headers: { "retry-after": "0" } };
        throw err;
      }
      return { data: { id: 1 } };
    });
    const listComments = mock(async () => ({ data: [] }));
    const logger = { error: mock(() => undefined) };

    const result = await postOrUpdateErrorComment(
      {
        rest: {
          issues: { createComment, updateComment, listComments },
        },
      } as never,
      { owner: "acme", repo: "repo", issueNumber: 42, trackingCommentId: 99 },
      formatErrorComment("internal_error", "executor failed"),
      logger as never,
    );

    expect(result).toEqual({ ok: true, resolution: "updated", method: "update-comment" });
    expect(updateComment).toHaveBeenCalledTimes(2);
    expect(createComment).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

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

  test("retries a rate-limited usage-limit duplicate scan before updating", async () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const existingBody = wrapUsageLimitBody("first failure");
    const replacementBody = wrapUsageLimitBody("second failure");
    const createComment = mock(async () => ({ data: { id: 2 } }));
    const updateComment = mock(async () => ({ data: { id: 1 } }));
    let listCalls = 0;
    const listComments = mock(async () => {
      listCalls++;
      if (listCalls === 1) {
        const err = new Error("Rate limited") as Error & {
          status?: number;
          response?: { headers?: Record<string, string> };
        };
        err.status = 429;
        err.response = { headers: { "retry-after": "0" } };
        throw err;
      }
      return {
        data: [
          {
            id: 1,
            body: existingBody,
            created_at: createdAt,
            user: { login: "kodiai[bot]" },
          },
        ],
      };
    });
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
    expect(listComments).toHaveBeenCalledTimes(2);
    expect(updateComment).toHaveBeenCalledTimes(1);
    expect(createComment).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

function wrapUsageLimitBody(detail: string): string {
  return `<details>\n<summary>Kodiai encountered an error</summary>\n\n${formatErrorComment("usage_limit", detail)}\n\n</details>`;
}
