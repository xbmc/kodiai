import { describe, expect, test } from "bun:test";
import { createReviewCommentThreadServer } from "./review-comment-thread-server.ts";

function getToolHandler(server: ReturnType<typeof createReviewCommentThreadServer>) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      {
        handler: (
          input: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }
    >;
  };

  const tool = instance._registeredTools?.reply_to_pr_review_comment;
  if (!tool) {
    throw new Error("reply_to_pr_review_comment tool is not registered");
  }
  return tool.handler;
}

describe("createReviewCommentThreadServer", () => {
  test("posts a reply to a PR review comment thread", async () => {
    let calledWith: Record<string, unknown> | undefined;

    const octokit = {
      rest: {
        pulls: {
          createReplyForReviewComment: async (params: Record<string, unknown>) => {
            calledWith = params;
            return { data: { id: 123, html_url: "https://example.test/reply" } };
          },
        },
      },
    };

    const server = createReviewCommentThreadServer(async () => octokit as never, "acme", "repo");
    const handler = getToolHandler(server);

    const result = await handler({
      pullRequestNumber: 42,
      commentId: 9001,
      body: "Hello from thread reply",
    });

    expect(calledWith).toBeDefined();
    expect(calledWith?.owner).toBe("acme");
    expect(calledWith?.repo).toBe("repo");
    expect(calledWith?.pull_number).toBe(42);
    expect(calledWith?.comment_id).toBe(9001);
    expect(String(calledWith?.body)).toContain("Hello from thread reply");
    expect(String(calledWith?.body)).toContain("<details>");

    expect(result.content[0]?.text).toContain("\"success\":true");
    expect(result.content[0]?.text).toContain("\"comment_id\":123");
    expect(result.content[0]?.text).toContain("\"html_url\":\"https://example.test/reply\"");
  });
});
