import { describe, expect, test } from "bun:test";
import { createInlineReviewServer } from "./inline-review-server.ts";

function getToolHandler(server: ReturnType<typeof createInlineReviewServer>) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }> }
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
