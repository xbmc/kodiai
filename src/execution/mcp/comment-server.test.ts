import { describe, test, expect } from "bun:test";
import { createCommentServer } from "./comment-server.ts";

function getToolHandlers(server: ReturnType<typeof createCommentServer>) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      {
        handler: (
          input: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
      }
    >;
  };

  const create = instance._registeredTools?.create_comment;
  const update = instance._registeredTools?.update_comment;
  if (!create || !update) {
    throw new Error("comment tools are not registered");
  }
  return { create: create.handler, update: update.handler };
}

describe("createCommentServer", () => {
  test("passes through non-review comments", async () => {
    let calledBody: string | undefined;
    const octokit = {
      rest: {
        issues: {
          createComment: async (params: { body: string }) => {
            calledBody = params.body;
            return { data: { id: 1 } };
          },
          updateComment: async () => ({ data: {} }),
        },
      },
    };

    const server = createCommentServer(async () => octokit as never, "acme", "repo");
    const { create } = getToolHandlers(server);

    const result = await create({ issueNumber: 1, body: "Hello" });
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBe("Hello");
  });

  test("strips legacy What changed line and accepts five-section format", async () => {
    let calledBody: string | undefined;
    const octokit = {
      rest: {
        issues: {
          createComment: async (params: { body: string }) => {
            calledBody = params.body;
            return { data: { id: 1 } };
          },
          updateComment: async () => ({ data: {} }),
        },
      },
    };

    const server = createCommentServer(async () => octokit as never, "acme", "repo");
    const { create } = getToolHandlers(server);

    const body = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "**What changed:** do not include this",
      "",
      "## What Changed",
      "Refactored component logic.",
      "",
      "## Observations",
      "",
      "### Impact",
      "[CRITICAL] src/my component/foo.ts (12, 34): An issue",
      "This is an issue.",
      "",
      "## Verdict",
      ":red_circle: **Block** -- 1 critical issue found.",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBeDefined();
    expect(calledBody!).not.toContain("**What changed:**");
    expect(calledBody!).toContain("### Impact");
    expect(calledBody!).toContain("src/my component/foo.ts (12");
  });

  test("rejects old issues-only format without five-section structure", async () => {
    const octokit = {
      rest: {
        issues: {
          createComment: async () => ({ data: { id: 1 } }),
          updateComment: async () => ({ data: {} }),
        },
      },
    };

    const server = createCommentServer(async () => octokit as never, "acme", "repo");
    const { create } = getToolHandlers(server);

    const body = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "Critical",
      "src/bar.ts (9): legacy style without sections",
      "This should be rejected.",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing required section");
  });

  test("APPROVE with no issues on PR submits approval review instead of comment", async () => {
    let createReviewParams: Record<string, unknown> | undefined;
    let createCommentCalled = false;
    let publishCalled = false;

    const octokit = {
      rest: {
        issues: {
          createComment: async () => {
            createCommentCalled = true;
            return { data: { id: 1 } };
          },
          updateComment: async () => ({ data: {} }),
        },
        pulls: {
          createReview: async (params: Record<string, unknown>) => {
            createReviewParams = params;
            return { data: { id: 100 } };
          },
        },
      },
    };

    const server = createCommentServer(
      async () => octokit as never,
      "acme",
      "repo",
      undefined,
      () => { publishCalled = true; },
      42,
    );
    const { create } = getToolHandlers(server);

    const body = [
      "<details>",
      "<summary>kodiai response</summary>",
      "",
      "Decision: APPROVE",
      "Issues: none",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 10, body });
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.approved).toBe(true);
    expect(parsed.pull_number).toBe(42);

    expect(createReviewParams).toBeDefined();
    expect(createReviewParams!.event).toBe("APPROVE");
    expect(createReviewParams!.pull_number).toBe(42);

    expect(createCommentCalled).toBe(false);
    expect(publishCalled).toBe(true);
  });

  test("APPROVE with no issues but no prNumber posts as regular comment", async () => {
    let createCommentCalled = false;
    let createReviewCalled = false;

    const octokit = {
      rest: {
        issues: {
          createComment: async () => {
            createCommentCalled = true;
            return { data: { id: 1 } };
          },
          updateComment: async () => ({ data: {} }),
        },
        pulls: {
          createReview: async () => {
            createReviewCalled = true;
            return { data: { id: 100 } };
          },
        },
      },
    };

    const server = createCommentServer(
      async () => octokit as never,
      "acme",
      "repo",
      undefined,
      undefined,
      undefined,
    );
    const { create } = getToolHandlers(server);

    const body = [
      "<details>",
      "<summary>kodiai response</summary>",
      "",
      "Decision: APPROVE",
      "Issues: none",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 10, body });
    expect(result.isError).toBeUndefined();
    expect(createCommentCalled).toBe(true);
    expect(createReviewCalled).toBe(false);
  });

  test("NOT APPROVED still posts as regular comment even with prNumber", async () => {
    let createCommentCalled = false;
    let createReviewCalled = false;

    const octokit = {
      rest: {
        issues: {
          createComment: async () => {
            createCommentCalled = true;
            return { data: { id: 1 } };
          },
          updateComment: async () => ({ data: {} }),
        },
        pulls: {
          createReview: async () => {
            createReviewCalled = true;
            return { data: { id: 100 } };
          },
        },
      },
    };

    const server = createCommentServer(
      async () => octokit as never,
      "acme",
      "repo",
      undefined,
      undefined,
      42,
    );
    const { create } = getToolHandlers(server);

    const body = [
      "<details>",
      "<summary>kodiai response</summary>",
      "",
      "Decision: NOT APPROVED",
      "Issues:",
      "- (1) [critical] src/foo.ts (12): Security vulnerability",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 10, body });
    expect(result.isError).toBeUndefined();
    expect(createCommentCalled).toBe(true);
    expect(createReviewCalled).toBe(false);
  });

  test("rejects missing explanation line in observations", async () => {
    const octokit = {
      rest: {
        issues: {
          createComment: async () => ({ data: { id: 1 } }),
          updateComment: async () => ({ data: {} }),
        },
      },
    };

    const server = createCommentServer(async () => octokit as never, "acme", "repo");
    const { create } = getToolHandlers(server);

    const body = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      "Some changes.",
      "",
      "## Observations",
      "",
      "### Impact",
      "[CRITICAL] src/foo.ts (12): Missing explanation",
      "",
      "## Verdict",
      ":red_circle: **Block** -- 1 critical issue.",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing explanation");
  });
});

// --- Comprehensive sanitizer tests for five-section template ---

function buildTestSummary(sections: Record<string, string>): string {
  const parts = [
    "<details>",
    "<summary>Kodiai Review Summary</summary>",
    "",
  ];
  for (const [name, content] of Object.entries(sections)) {
    parts.push(name);
    parts.push(content);
    parts.push("");
  }
  parts.push("</details>");
  return parts.join("\n");
}

function makeOctokit() {
  let calledBody: string | undefined;
  const octokit = {
    rest: {
      issues: {
        createComment: async (params: { body: string }) => {
          calledBody = params.body;
          return { data: { id: 1 } };
        },
        updateComment: async () => ({ data: {} }),
      },
    },
  };
  return { octokit, getCalledBody: () => calledBody };
}

async function callCreate(body: string) {
  const { octokit, getCalledBody } = makeOctokit();
  const server = createCommentServer(async () => octokit as never, "acme", "repo");
  const { create } = getToolHandlers(server);
  const result = await create({ issueNumber: 1, body });
  return { result, calledBody: getCalledBody() };
}

describe("sanitizeKodiaiReviewSummary", () => {
  // --- Passing cases ---

  test("accepts valid five-section summary with all sections", async () => {
    const body = buildTestSummary({
      "## What Changed": "Refactored authentication logic to use JWT tokens.",
      "## Strengths": "- :white_check_mark: Null checks added for all nullable returns\n- :white_check_mark: Test coverage maintained at 87%",
      "## Observations": "### Impact\n[CRITICAL] src/auth.ts (12, 34): Missing token expiration check\nThe JWT token is created without an expiration claim, allowing indefinite session reuse.",
      "## Suggestions": "- Consider extracting the retry logic into a shared utility",
      "## Verdict": ":yellow_circle: **Needs changes** -- 1 critical issue requires attention before merge.",
    });

    const { result, calledBody } = await callCreate(body);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBeDefined();
    expect(calledBody!).toContain("## What Changed");
    expect(calledBody!).toContain("## Strengths");
    expect(calledBody!).toContain("## Observations");
    expect(calledBody!).toContain("## Suggestions");
    expect(calledBody!).toContain("## Verdict");
  });

  test("accepts summary with only required sections (no Strengths, no Suggestions)", async () => {
    const body = buildTestSummary({
      "## What Changed": "Bug fix for race condition in queue processing.",
      "## Observations": "### Impact\n[MAJOR] src/queue.ts (45): Race condition in dequeue\nTwo concurrent consumers can dequeue the same item when the lock is not held.",
      "## Verdict": ":yellow_circle: **Needs changes** -- 1 major issue found.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts summary with Strengths but no Suggestions", async () => {
    const body = buildTestSummary({
      "## What Changed": "Added input validation to API endpoints.",
      "## Strengths": "- :white_check_mark: Comprehensive validation for all user inputs",
      "## Observations": "### Impact\n[MEDIUM] src/api/users.ts (78): Missing length limit on username\nThe username field accepts arbitrarily long strings which could cause DB issues.",
      "## Verdict": ":yellow_circle: **Needs changes** -- 1 medium issue found.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts summary with Impact and Preference subsections", async () => {
    const body = buildTestSummary({
      "## What Changed": "Refactored database layer.",
      "## Observations": "### Impact\n[CRITICAL] src/db.ts (10): SQL injection vulnerability\nUser input is concatenated directly into the query string.\n\n[MEDIUM] src/db.ts (50): Missing connection pool limit\nThe pool allows unlimited connections which could exhaust server resources.\n\n### Preference\n[MINOR] src/db.ts (80): Inconsistent variable naming\nOptional: Use camelCase consistently for local variables.",
      "## Verdict": ":red_circle: **Block** -- 1 critical and 1 medium issue found.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  // --- Rejection cases ---

  test("rejects summary missing ## What Changed", async () => {
    const body = buildTestSummary({
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation here.",
      "## Verdict": ":yellow_circle: **Needs changes** -- 1 major issue.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("## What Changed");
  });

  test("rejects summary missing ## Observations", async () => {
    const body = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Verdict": ":green_circle: **Approve** -- No issues found.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("## Observations");
  });

  test("rejects summary missing ## Verdict", async () => {
    const body = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Observations": "### Impact\n[MINOR] src/foo.ts (1): Nitpick\nSmall formatting issue.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("## Verdict");
  });

  test("rejects summary with sections out of order", async () => {
    const body = buildTestSummary({
      "## Verdict": ":red_circle: **Block** -- issues found.",
      "## What Changed": "Some changes.",
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation here.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("order");
  });

  test("rejects verdict without correct format", async () => {
    const body = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation here.",
      "## Verdict": "This PR needs changes before merging.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Verdict must use format");
  });

  test("rejects observations without Impact subsection", async () => {
    const body = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Observations": "There is a bug in the auth module that needs fixing.",
      "## Verdict": ":yellow_circle: **Needs changes** -- issues found.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("### Impact");
  });

  test("rejects extra top-level heading", async () => {
    const body = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation here.",
      "## Notes": "Some additional notes.",
      "## Verdict": ":yellow_circle: **Needs changes** -- 1 major issue.",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unexpected section");
  });

  // --- Passthrough case ---

  test("passes through non-review comments unchanged", async () => {
    const body = "Just a regular comment, nothing to validate.";
    const { result, calledBody } = await callCreate(body);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBe(body);
  });
});
