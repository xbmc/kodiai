import { describe, expect, test } from "bun:test";
import { createInlineReviewServer } from "./inline-review-server.ts";

function createMockLogger() {
  const warnCalls: unknown[][] = [];
  const infoCalls: unknown[][] = [];
  const logger = {
    warn: (...args: unknown[]) => warnCalls.push(args),
    info: (...args: unknown[]) => infoCalls.push(args),
    child: () => logger,
  };
  return { logger, warnCalls, infoCalls };
}

function getToolHandler(server: ReturnType<typeof createInlineReviewServer>) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }
    >;
  };
  const tool = instance._registeredTools?.create_inline_comment;
  if (!tool) {
    throw new Error("create_inline_comment tool is not registered");
  }
  return tool.handler;
}

describe("createInlineReviewServer output idempotency", () => {
  test("second publication attempt with same reviewOutputKey skips create", async () => {
    const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-123:head-abcdef1234";
    const marker = `<!-- kodiai:review-output-key:${reviewOutputKey} -->`;
    const persistedBodies: string[] = [];
    let createReviewCommentCalls = 0;

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: persistedBodies.map((body, index) => ({ id: index + 1, body })),
          }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async ({ body }: { body: string }) => {
            createReviewCommentCalls++;
            persistedBodies.push(body);
            return {
              data: {
                id: createReviewCommentCalls,
                html_url: "https://example.test/comment",
                path: "src/file.ts",
                line: 10,
                original_line: 10,
              },
            };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
      },
    };

    const firstServer = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      "delivery-123",
    );
    const firstHandler = getToolHandler(firstServer);

    const firstResult = await firstHandler({
      path: "src/file.ts",
      body: "First publish",
      line: 10,
      side: "RIGHT",
    });

    expect(createReviewCommentCalls).toBe(1);
    expect(persistedBodies[0]?.includes(marker)).toBe(true);
    expect(firstResult.content[0]?.text).toContain("\"success\":true");

    const secondServer = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      "delivery-123",
    );
    const secondHandler = getToolHandler(secondServer);

    const secondResult = await secondHandler({
      path: "src/file.ts",
      body: "Replay publish",
      line: 10,
      side: "RIGHT",
    });

    expect(createReviewCommentCalls).toBe(1);
    expect(secondResult.content[0]?.text).toContain("\"skipped\":true");
    expect(secondResult.content[0]?.text).toContain("\"reason\":\"already-published\"");
  });
});

// --- Phase 50: Mention sanitization regression tests ---

describe("mention sanitization", () => {
  test("create_inline_comment strips @kodiai from body", async () => {
    let calledBody: string | undefined;

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async ({ body }: { body: string }) => {
            calledBody = body;
            return {
              data: {
                id: 1,
                html_url: "https://example.test/comment",
                path: "src/file.ts",
                line: 10,
                original_line: 10,
              },
            };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
        },
      },
    };

    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      ["kodiai", "claude"],
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      body: "@kodiai should fix this",
      line: 10,
      side: "RIGHT",
    });

    expect(result.content[0]?.text).toContain("\"success\":true");
    expect(calledBody).toBeDefined();
    expect(calledBody!).not.toContain("@kodiai");
    expect(calledBody!).toContain("kodiai should fix this");
  });
});

describe("createInlineReviewServer validation diagnostics", () => {
  test("rejects startLine without line before calling GitHub", async () => {
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            createReviewCommentCalls++;
            return { data: { id: 1, html_url: "https://example.test/comment", path: "src/file.ts", line: 10 } };
          },
        },
        issues: { listComments: async () => ({ data: [] }) },
      },
    };

    const { logger, warnCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      undefined,
      "delivery-123",
      logger as never,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      body: "range comment",
      startLine: 10,
      side: "RIGHT",
    });

    expect(createReviewCommentCalls).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Multi-line comments require both 'startLine' and 'line'");
    expect(result.content[0]?.text).toContain("src/file.ts");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({
      tool: "create_inline_comment",
      path: "src/file.ts",
      startLine: 10,
      side: "RIGHT",
    });
  });

  test("rejects RIGHT-side lines that are not commentable in the PR diff before calling GitHub", async () => {
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            createReviewCommentCalls++;
            return { data: { id: 1, html_url: "https://example.test/comment", path: "src/file.ts", line: 10 } };
          },
        },
        issues: { listComments: async () => ({ data: [] }) },
      },
    };
    const prDiffForCommentValidation = [
      "diff --git a/src/file.ts b/src/file.ts",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -700,18 +789,12 @@ void f()",
      " context",
      "+added",
      " context",
    ].join("\n");

    const { logger, warnCalls, infoCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      "review-key",
      "delivery-123",
      logger as never,
      undefined,
      undefined,
      prDiffForCommentValidation,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      body: "line comment",
      line: 810,
      side: "RIGHT",
    });

    expect(createReviewCommentCalls).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("src/file.ts");
    expect(result.content[0]?.text).toContain("RIGHT line 810 is not commentable");
    expect(warnCalls).toHaveLength(0);
    expect(infoCalls).toHaveLength(1);
    expect(infoCalls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-123",
      reviewOutputKey: "review-key",
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      path: "src/file.ts",
      line: 810,
      side: "RIGHT",
      reason: "line-not-commentable-in-pr-diff",
    });
  });

  test("classifies GitHub thread line resolution errors as non-commentable and logs them below warning level", async () => {
    const githubError = Object.assign(new Error("Validation Failed"), {
      status: 422,
      response: {
        data: {
          message: "Validation Failed",
          errors: [
            {
              resource: "PullRequestReviewComment",
              code: "custom",
              field: "pull_request_review_thread.line",
              message: "could not be resolved",
            },
          ],
        },
        headers: { "x-github-request-id": "REQ-LINE" },
      },
    });
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            throw githubError;
          },
        },
        issues: { listComments: async () => ({ data: [] }) },
      },
    };

    const { logger, warnCalls, infoCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      "review-key",
      "delivery-123",
      logger as never,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      line: 470,
      side: "RIGHT",
      body: "line comment",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path \"src/file.ts\" at RIGHT line 470");
    expect(warnCalls).toHaveLength(0);
    expect(infoCalls).toHaveLength(1);
    expect(infoCalls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-123",
      reviewOutputKey: "review-key",
      path: "src/file.ts",
      line: 470,
      githubStatus: 422,
      githubRequestId: "REQ-LINE",
      reason: "review-thread-line-not-resolved",
    });
  });

  test("ignores null GitHub validation error entries when classifying line resolution failures", async () => {
    const githubError = Object.assign(new Error("Validation Failed"), {
      status: 422,
      response: {
        data: {
          message: "Validation Failed",
          errors: [null],
        },
        headers: { "x-github-request-id": "REQ-NULL" },
      },
    });
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            throw githubError;
          },
        },
        issues: { listComments: async () => ({ data: [] }) },
      },
    };

    const { logger, warnCalls, infoCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      "review-key",
      "delivery-123",
      logger as never,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      line: 470,
      side: "RIGHT",
      body: "line comment",
    });

    expect(result.isError).toBe(true);
    expect(infoCalls).toHaveLength(0);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({
      githubStatus: 422,
      githubRequestId: "REQ-NULL",
      reason: undefined,
    });
  });

  test("ignores null GitHub validation errors object when classifying line resolution failures", async () => {
    const githubError = Object.assign(new Error("Validation Failed"), {
      status: 422,
      response: {
        data: {
          message: "Validation Failed",
          errors: null,
        },
        headers: { "x-github-request-id": "REQ-NULL-OBJECT" },
      },
    });
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            throw githubError;
          },
        },
        issues: { listComments: async () => ({ data: [] }) },
      },
    };

    const { logger, warnCalls, infoCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      "review-key",
      "delivery-123",
      logger as never,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      line: 470,
      side: "RIGHT",
      body: "line comment",
    });

    expect(result.isError).toBe(true);
    expect(infoCalls).toHaveLength(0);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({
      githubStatus: 422,
      githubRequestId: "REQ-NULL-OBJECT",
      reason: undefined,
    });
  });

  test("returns and logs structured GitHub validation details", async () => {
    const githubError = Object.assign(new Error("Validation Failed"), {
      status: 422,
      response: {
        data: {
          message: "Validation Failed",
          errors: [
            { resource: "PullRequestReviewComment", field: "line", code: "invalid" },
          ],
        },
        headers: { "x-github-request-id": "REQ123" },
      },
    });
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            throw githubError;
          },
        },
        issues: { listComments: async () => ({ data: [] }) },
      },
    };

    const { logger, warnCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => octokit as never,
      "acme",
      "repo",
      101,
      [],
      "review-key",
      "delivery-123",
      logger as never,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      path: "src/file.ts",
      body: "line comment",
      line: 10,
      side: "RIGHT",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path \"src/file.ts\" at RIGHT line 10");
    expect(result.content[0]?.text).toContain("status 422");
    expect(result.content[0]?.text).toContain("PullRequestReviewComment");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-123",
      reviewOutputKey: "review-key",
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      path: "src/file.ts",
      line: 10,
      githubStatus: 422,
      githubRequestId: "REQ123",
      githubResponseMessage: "Validation Failed",
    });
  });
});
