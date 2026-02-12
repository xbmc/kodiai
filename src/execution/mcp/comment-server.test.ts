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

  test("strips What changed and enforces severity-heading format for review summaries", async () => {
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
      "Critical",
      "src/my component/foo.ts (12, 34): An issue",
      "This is an issue.",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBeDefined();
    expect(calledBody!).not.toContain("What changed");
    expect(calledBody!).toContain("Critical");
    expect(calledBody!).toContain("src/my component/foo.ts (12");
  });

  test("rejects legacy bullet format", async () => {
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
      "- (1) [major] src/bar.ts (9): legacy style should not be mixed",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error:");
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

  test("rejects missing explanation line", async () => {
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
      "src/foo.ts (12): Missing explanation",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing explanation");
  });
});
