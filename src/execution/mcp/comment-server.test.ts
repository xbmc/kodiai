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

  test("strips What changed and enforces issue bullet format for review summaries", async () => {
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
      "**Status:** NOT APPROVED",
      "",
      "**Issues:**",
      "- (1) [major] src/foo.ts (12): This is an issue.",
      "",
      "</details>",
    ].join("\n");

    const result = await create({ issueNumber: 1, body });
    expect(result.isError).toBeUndefined();
    expect(calledBody).toBeDefined();
    expect(calledBody!).not.toContain("What changed");
    expect(calledBody!).toContain("**Status:**");
    expect(calledBody!).toContain("src/foo.ts (12):");
  });
});
