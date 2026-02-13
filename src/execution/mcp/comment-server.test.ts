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
      ":red_circle: **Address before merging** -- 1 blocking issue found",
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
      ":red_circle: **Address before merging** -- 1 blocking issue found",
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
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
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
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts summary with Strengths but no Suggestions", async () => {
    const body = buildTestSummary({
      "## What Changed": "Added input validation to API endpoints.",
      "## Strengths": "- :white_check_mark: Comprehensive validation for all user inputs",
      "## Observations": "### Impact\n[MEDIUM] src/api/users.ts (78): Missing length limit on username\nThe username field accepts arbitrarily long strings which could cause DB issues.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts summary with Impact and Preference subsections", async () => {
    const body = buildTestSummary({
      "## What Changed": "Refactored database layer.",
      "## Observations": "### Impact\n[CRITICAL] src/db.ts (10): SQL injection vulnerability\nUser input is concatenated directly into the query string.\n\n[MEDIUM] src/db.ts (50): Missing connection pool limit\nThe pool allows unlimited connections which could exhaust server resources.\n\n### Preference\n[MINOR] src/db.ts (80): Inconsistent variable naming\nOptional: Use camelCase consistently for local variables.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  // --- Rejection cases ---

  test("rejects summary missing ## What Changed", async () => {
    const body = buildTestSummary({
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation here.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("## What Changed");
  });

  test("rejects summary missing ## Observations", async () => {
    const body = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Verdict": ":green_circle: **Ready to merge** -- No blocking issues found",
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
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
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
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
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
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
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

  // --- Impact/Preference validation tests ---

  test("accepts Impact-only summary (no Preference)", async () => {
    const body = buildTestSummary({
      "## What Changed": "Fixed authentication bypass.",
      "## Observations": "### Impact\n[MAJOR] src/auth.ts (42): Missing token validation\nThe endpoint accepts expired tokens without checking the expiration claim.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts Impact + Preference together", async () => {
    const body = buildTestSummary({
      "## What Changed": "Refactored user service.",
      "## Observations": "### Impact\n[CRITICAL] src/user.ts (10): SQL injection in user lookup\nUser-supplied ID is interpolated directly into the query string.\n\n### Preference\n[MINOR] src/user.ts (55): Inconsistent naming convention\nOptional: Rename `getUserData` to `findUserById` for consistency.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts multiple findings under Impact", async () => {
    const body = buildTestSummary({
      "## What Changed": "Updated database queries.",
      "## Observations": "### Impact\n[MAJOR] src/db.ts (12): Unbounded query without pagination\nThe query fetches all rows without a LIMIT clause, causing OOM on large tables.\n\n[MAJOR] src/db.ts (45): Missing transaction for multi-step write\nTwo INSERT statements execute independently; a failure in the second leaves orphaned rows.\n\n[MEDIUM] src/db.ts (78): No index on frequently queried column\nThe `status` column is used in WHERE clauses but has no index, causing full table scans.",
      "## Verdict": ":red_circle: **Address before merging** -- 2 blocking issues found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("rejects missing Impact subsection (Preference-only)", async () => {
    const body = buildTestSummary({
      "## What Changed": "Code style cleanup.",
      "## Observations": "### Preference\n[MINOR] src/utils.ts (5): Import order inconsistency\nOptional: Group third-party imports before local imports.",
      "## Verdict": ":green_circle: **Ready to merge** -- No blocking issues found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("### Impact");
  });

  test("rejects finding without severity tag", async () => {
    const body = buildTestSummary({
      "## What Changed": "Bug fix.",
      "## Observations": "### Impact\nsrc/foo.ts (123): Missing error handling\nThe function does not handle null returns from the API.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("### Impact");
  });

  test("rejects invalid severity tag [HIGH]", async () => {
    const body = buildTestSummary({
      "## What Changed": "Performance fix.",
      "## Observations": "### Impact\n[HIGH] src/api.ts (99): Slow response time\nThe endpoint takes 5s due to N+1 query pattern.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    // [HIGH] is not a valid severity, so no finding lines match -- treated as missing Impact content
    expect(result.content[0]?.text).toContain("### Impact");
  });

  test("rejects old severity sub-headings (### Critical) as valid subsection", async () => {
    const body = buildTestSummary({
      "## What Changed": "Refactored auth module.",
      "## Observations": "### Critical\nsrc/auth.ts (12): Old-format issue\nThis uses the old severity sub-heading format.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    // ### Critical is not a valid subsection; should fail with missing Impact
    expect(result.content[0]?.text).toContain("### Impact");
  });

  test("allows intro text before first finding under Impact", async () => {
    const body = buildTestSummary({
      "## What Changed": "Added rate limiting middleware.",
      "## Observations": "### Impact\nFindings related to correctness and security:\n\n[MAJOR] src/middleware.ts (30): Rate limit bypass via header spoofing\nThe X-Forwarded-For header is trusted without validation, allowing rate limit bypass.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("rejects finding with missing explanation (end of section)", async () => {
    const body = buildTestSummary({
      "## What Changed": "Updated API routes.",
      "## Observations": "### Impact\n[CRITICAL] src/routes.ts (55): Unauthenticated admin endpoint",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing explanation");
  });

  test("allows MAJOR severity in Preference without throwing (soft warning)", async () => {
    const body = buildTestSummary({
      "## What Changed": "Code cleanup.",
      "## Observations": "### Impact\n[MEDIUM] src/core.ts (20): Missing null check on optional return\nThe function assumes non-null but the API can return undefined.\n\n### Preference\n[MAJOR] src/utils.ts (40): Deeply nested callback structure\nOptional: Refactor to async/await for readability.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const { result } = await callCreate(body);
    // Soft check -- should NOT throw, just warn
    expect(result.isError).toBeUndefined();
  });

  test("accepts bold-stripped severity tag **[CRITICAL]**", async () => {
    const body = buildTestSummary({
      "## What Changed": "Security patch.",
      "## Observations": "### Impact\n**[CRITICAL]** src/auth.ts (5): Hardcoded secret key\nThe JWT signing key is hardcoded in source code instead of using environment variables.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("section ordering and verdict format validations still work", async () => {
    // Verify section ordering rejection still works with new format
    const outOfOrder = buildTestSummary({
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation.",
      "## What Changed": "Some changes.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result: r1 } = await callCreate(outOfOrder);
    expect(r1.isError).toBe(true);
    expect(r1.content[0]?.text).toContain("order");

    // Verify verdict format rejection still works with new format
    const badVerdict = buildTestSummary({
      "## What Changed": "Some changes.",
      "## Observations": "### Impact\n[MAJOR] src/foo.ts (1): Issue\nExplanation.",
      "## Verdict": "Needs changes, please fix.",
    });

    const { result: r2 } = await callCreate(badVerdict);
    expect(r2.isError).toBe(true);
    expect(r2.content[0]?.text).toContain("Verdict must use format");
  });

  test("rejects finding followed by another finding without explanation", async () => {
    const body = buildTestSummary({
      "## What Changed": "Multiple fixes.",
      "## Observations": "### Impact\n[MAJOR] src/a.ts (10): First issue\n[MAJOR] src/b.ts (20): Second issue without explanation for first\nThis explains the second issue.",
      "## Verdict": ":red_circle: **Address before merging** -- 2 blocking issues found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing explanation");
  });
});

describe("Phase 36: Verdict-Observations cross-check", () => {
  test("rejects red verdict when only MEDIUM findings exist", async () => {
    const body = buildTestSummary({
      "## What Changed": "Minor null-check improvements.",
      "## Observations": "### Impact\n[MEDIUM] src/utils.ts (15): Missing null check on optional return\nThe function assumes non-null but the API can return undefined.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("no CRITICAL or MAJOR findings exist");
  });

  test("rejects red verdict when only MINOR findings exist", async () => {
    const body = buildTestSummary({
      "## What Changed": "Style cleanup.",
      "## Observations": "### Impact\n[MINOR] src/format.ts (3): Inconsistent indentation\nTabs mixed with spaces in the function body.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("no CRITICAL or MAJOR findings exist");
  });

  test("accepts red verdict when CRITICAL finding exists", async () => {
    const body = buildTestSummary({
      "## What Changed": "Auth endpoint changes.",
      "## Observations": "### Impact\n[CRITICAL] src/auth.ts (42): SQL injection in login handler\nUser input is concatenated directly into the query string.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts red verdict when MAJOR finding exists", async () => {
    const body = buildTestSummary({
      "## What Changed": "Queue processing update.",
      "## Observations": "### Impact\n[MAJOR] src/queue.ts (88): Race condition in dequeue\nTwo concurrent consumers can dequeue the same item.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("accepts yellow verdict with only MEDIUM findings", async () => {
    const body = buildTestSummary({
      "## What Changed": "API validation updates.",
      "## Observations": "### Impact\n[MEDIUM] src/api.ts (22): Missing length limit on input\nThe input field accepts arbitrarily long strings.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("warns when green verdict used despite CRITICAL findings", async () => {
    const originalWarn = console.warn;
    const warnCalls: string[] = [];
    console.warn = (...args: unknown[]) => { warnCalls.push(args.map(String).join(" ")); };

    try {
      const body = buildTestSummary({
        "## What Changed": "Security patch.",
        "## Observations": "### Impact\n[CRITICAL] src/auth.ts (5): Hardcoded secret key\nThe JWT signing key is hardcoded in source code.",
        "## Verdict": ":green_circle: **Ready to merge** -- No blocking issues found",
      });

      const { result } = await callCreate(body);
      // Should NOT throw -- soft warning only.
      expect(result.isError).toBeUndefined();
      // console.warn should have been called with blocker message.
      expect(warnCalls.some((msg) => msg.includes("blocker(s)"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("accepts green verdict when only Preference findings exist with MEDIUM under Impact", async () => {
    const body = buildTestSummary({
      "## What Changed": "Code style improvements.",
      "## Observations": "### Impact\n[MEDIUM] src/core.ts (10): Missing error boundary\nThe component does not catch rendering errors.\n\n### Preference\n[MINOR] src/core.ts (55): Prefer const over let\nOptional: Use const for variables that are never reassigned.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("tolerates appended Review Details block after closing details tag", async () => {
    const summaryBody = buildTestSummary({
      "## What Changed": "Minor refactor of utility helpers.",
      "## Observations": "### Impact\n[MEDIUM] src/utils.ts (5): Missing null check\nThe helper does not guard against null input.",
      "## Verdict": ":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    });

    const reviewDetailsBlock = [
      "<details>",
      "<summary>Review Details</summary>",
      "",
      "- Files reviewed: 5",
      "- Lines changed: +120 -30",
      "- Findings: 0 critical, 1 major, 0 medium, 1 minor",
      "- Review completed: 2026-02-13T14:30:00Z",
      "",
      "</details>",
      "",
      "<!-- kodiai:review-details:test-key -->",
    ].join("\n");

    const combinedBody = `${summaryBody}\n\n${reviewDetailsBlock}`;

    // Should NOT throw -- the sanitizer should tolerate content after the summary's </details>
    const { result, calledBody } = await callCreate(combinedBody);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toContain("<summary>Kodiai Review Summary</summary>");
    expect(calledBody).toContain("<summary>Review Details</summary>");
  });
});

// --- Phase 38: Delta Re-Review Sanitizer Tests ---

interface ReReviewSections {
  reReviewHeader?: string;
  whatChanged?: string;
  newFindings?: string;
  resolvedFindings?: string;
  stillOpen?: string;
  verdictUpdate?: string;
  extraSections?: string[];
}

function buildTestReReviewSummary(overrides: ReReviewSections = {}): string {
  const parts: string[] = [
    "<details>",
    "<summary>Kodiai Re-Review Summary</summary>",
    "",
  ];

  if (overrides.reReviewHeader !== undefined) {
    if (overrides.reReviewHeader !== "") {
      parts.push(overrides.reReviewHeader);
      parts.push("");
    }
  } else {
    parts.push("## Re-review -- Changes since abc1234");
    parts.push("");
  }

  if (overrides.whatChanged !== undefined) {
    if (overrides.whatChanged !== "") {
      parts.push("## What Changed");
      parts.push(overrides.whatChanged);
      parts.push("");
    }
  } else {
    parts.push("## What Changed");
    parts.push("Fixed the authentication bug and updated error handling.");
    parts.push("");
  }

  if (overrides.newFindings !== undefined) {
    if (overrides.newFindings !== "") {
      parts.push("## New Findings");
      parts.push(overrides.newFindings);
      parts.push("");
    }
  } else {
    parts.push("## New Findings");
    parts.push(":new: [MAJOR] src/auth.ts (42): SQL injection in login query");
    parts.push("Parameterized queries should be used instead of string concatenation.");
    parts.push("");
  }

  if (overrides.resolvedFindings !== undefined) {
    if (overrides.resolvedFindings !== "") {
      parts.push("## Resolved Findings");
      parts.push(overrides.resolvedFindings);
      parts.push("");
    }
  } else {
    parts.push("## Resolved Findings");
    parts.push(":white_check_mark: [CRITICAL] src/auth.ts: Hardcoded secret key -- resolved");
    parts.push("");
  }

  if (overrides.stillOpen !== undefined) {
    if (overrides.stillOpen !== "") {
      parts.push("## Still Open");
      parts.push(overrides.stillOpen);
      parts.push("");
    }
  } else {
    parts.push("## Still Open");
    parts.push("1 finding(s) from the previous review remain open.");
    parts.push("");
    parts.push("<details>");
    parts.push("<summary>View still-open findings</summary>");
    parts.push("");
    parts.push("- [MEDIUM] src/utils.ts: Missing null check");
    parts.push("");
    parts.push("</details>");
    parts.push("");
  }

  if (overrides.extraSections) {
    for (const section of overrides.extraSections) {
      parts.push(section);
      parts.push("");
    }
  }

  if (overrides.verdictUpdate !== undefined) {
    if (overrides.verdictUpdate !== "") {
      parts.push("## Verdict Update");
      parts.push(overrides.verdictUpdate);
      parts.push("");
    }
  } else {
    parts.push("## Verdict Update");
    parts.push(":yellow_circle: **New blockers found** -- Address 1 new issue(s)");
    parts.push("");
  }

  parts.push("</details>");
  return parts.join("\n");
}

describe("Phase 38: Delta Re-Review Sanitizer", () => {
  // --- Happy paths ---

  test("valid delta re-review summary passes through unchanged", async () => {
    const body = buildTestReReviewSummary();
    const { result, calledBody } = await callCreate(body);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBe(body);
  });

  test("valid delta with only New Findings (no Resolved/Still Open) passes", async () => {
    const body = buildTestReReviewSummary({
      resolvedFindings: "",
      stillOpen: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("valid delta with only Resolved Findings passes", async () => {
    const body = buildTestReReviewSummary({
      newFindings: "",
      stillOpen: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("valid delta with only Still Open passes", async () => {
    const body = buildTestReReviewSummary({
      newFindings: "",
      resolvedFindings: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("delta with green verdict (Blockers resolved) passes", async () => {
    const body = buildTestReReviewSummary({
      verdictUpdate: ":green_circle: **Blockers resolved** -- Ready to merge",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("delta with blue verdict (Still ready) passes", async () => {
    const body = buildTestReReviewSummary({
      verdictUpdate: ":large_blue_circle: **Still ready** -- No new issues",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBeUndefined();
  });

  test("non-re-review body passes through unchanged", async () => {
    const body = "Just a regular comment about a PR.";
    const { result, calledBody } = await callCreate(body);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBe(body);
  });

  // --- Error paths ---

  test("rejects delta missing ## Re-review header", async () => {
    const body = buildTestReReviewSummary({
      reReviewHeader: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing required section '## Re-review'");
  });

  test("rejects delta missing ## What Changed", async () => {
    const body = buildTestReReviewSummary({
      whatChanged: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing required section '## What Changed'");
  });

  test("rejects delta missing ## Verdict Update", async () => {
    const body = buildTestReReviewSummary({
      verdictUpdate: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing required section '## Verdict Update'");
  });

  test("rejects delta with no delta sections", async () => {
    const body = buildTestReReviewSummary({
      newFindings: "",
      resolvedFindings: "",
      stillOpen: "",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("must contain at least one of: New Findings, Resolved Findings, Still Open");
  });

  test("rejects delta with initial review ## Observations section", async () => {
    const body = buildTestReReviewSummary({
      extraSections: ["## Observations\n### Impact\n[MAJOR] src/foo.ts (1): Bug\nThis is a bug."],
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unexpected section '## Observations'");
  });

  test("rejects delta with initial review ## Strengths section", async () => {
    const body = buildTestReReviewSummary({
      extraSections: ["## Strengths\n- :white_check_mark: Good tests"],
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unexpected section '## Strengths'");
  });

  test("rejects delta with initial review ## Verdict (without Update)", async () => {
    // Build manually to have both ## Verdict and ## Verdict Update (the "## Verdict" without "Update" triggers error)
    const parts = [
      "<details>",
      "<summary>Kodiai Re-Review Summary</summary>",
      "",
      "## Re-review -- Changes since abc1234",
      "",
      "## What Changed",
      "Fixed auth bug.",
      "",
      "## New Findings",
      ":new: [MAJOR] src/auth.ts (42): SQL injection",
      "Use parameterized queries.",
      "",
      "## Verdict",
      ":red_circle: **Address before merging** -- 1 blocking issue found",
      "",
      "</details>",
    ].join("\n");
    const { result } = await callCreate(parts);
    expect(result.isError).toBe(true);
    // Should fail on missing ## Verdict Update (since bare ## Verdict exists but not ## Verdict Update)
    expect(result.content[0]?.text).toContain("missing required section '## Verdict Update'");
  });

  test("rejects delta with invalid verdict emoji", async () => {
    const body = buildTestReReviewSummary({
      verdictUpdate: ":red_circle: **Address before merging** -- 1 blocking issue found",
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Verdict Update must use format");
  });

  test("rejects delta with unexpected ## heading", async () => {
    const body = buildTestReReviewSummary({
      extraSections: ["## Summary\nSome summary text."],
    });
    const { result } = await callCreate(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unexpected section '## Summary'");
  });

  // --- Discrimination ---

  test("initial review summary still validated by five-section sanitizer (not delta)", async () => {
    // A valid initial review should pass both sanitizers in the chain
    const body = buildTestSummary({
      "## What Changed": "Refactored authentication logic.",
      "## Observations": "### Impact\n[CRITICAL] src/auth.ts (12): Missing token check\nThe JWT token is created without an expiration claim.",
      "## Verdict": ":red_circle: **Address before merging** -- 1 blocking issue found",
    });

    const { result, calledBody } = await callCreate(body);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toContain("<summary>Kodiai Review Summary</summary>");
    expect(calledBody).toContain("## Observations");
  });

  test("delta body does not trigger initial review sanitizer", async () => {
    // A valid delta body should pass through the initial sanitizer unchanged
    // (because it checks for "Kodiai Review Summary" not "Kodiai Re-Review Summary")
    // and then be validated by the delta sanitizer
    const body = buildTestReReviewSummary();
    const { result, calledBody } = await callCreate(body);
    expect(result.isError).toBeUndefined();
    expect(calledBody).toContain("<summary>Kodiai Re-Review Summary</summary>");
    // Should NOT have been rejected by initial sanitizer for missing ## Observations
    expect(calledBody).not.toContain("## Observations");
  });
});
