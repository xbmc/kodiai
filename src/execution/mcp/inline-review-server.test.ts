import { describe, expect, test } from "bun:test";
import { buildPrDiffCommentabilityIndex } from "../formatter-suggestions.ts";
import { publishInlineReviewComment } from "./inline-review-publisher.ts";
import { createInlineReviewServer } from "./inline-review-server.ts";
import { createReviewOutputPublicationGate } from "./review-output-publication-gate.ts";

function createMockLogger() {
  const infoCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const logger = {
    info: (...args: unknown[]) => infoCalls.push(args),
    warn: (...args: unknown[]) => warnCalls.push(args),
    child: () => logger,
  };
  return { logger, infoCalls, warnCalls };
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

describe("publishInlineReviewComment", () => {
  test("publishes through the shared primitive with the existing success shape", async () => {
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async (params: { body: string; path: string; line: number }) => {
            createReviewCommentCalls++;
            return {
              data: {
                id: 123,
                html_url: "https://example.test/comment/123",
                path: params.path,
                line: params.line,
                original_line: params.line,
              },
            };
          },
        },
      },
    };

    const result = await publishInlineReviewComment({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: ["kodiai"],
      location: { path: "src/file.ts", line: 10, side: "RIGHT" },
      body: "@kodiai please review this",
    });

    expect(createReviewCommentCalls).toBe(1);
    expect(result.status).toBe("published");
    expect(result.content[0]?.text).toBe(JSON.stringify({
      success: true,
      comment_id: 123,
      html_url: "https://example.test/comment/123",
      path: "src/file.ts",
      line: 10,
    }));
  });

  test("accepts a prebuilt PR diff commentability index", async () => {
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            createReviewCommentCalls++;
            return {
              data: {
                id: 456,
                html_url: "https://example.test/comment/456",
                path: "src/file.ts",
                line: 11,
                original_line: 11,
              },
            };
          },
        },
      },
    };
    const prDiffCommentabilityIndex = buildPrDiffCommentabilityIndex([
      "diff --git a/src/file.ts b/src/file.ts",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -10,2 +10,2 @@ void f()",
      " context",
      "+changed",
    ].join("\n"));

    const result = await publishInlineReviewComment({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: ["kodiai"],
      location: { path: "src/file.ts", line: 11, side: "RIGHT" },
      body: "line comment",
      prDiffCommentabilityIndex,
    });

    expect(createReviewCommentCalls).toBe(1);
    expect(result.status).toBe("published");
  });

  test("uses a prebuilt PR diff commentability index without reparsing raw diff text", async () => {
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            createReviewCommentCalls++;
            return { data: { id: 456, html_url: "https://example.test/comment/456" } };
          },
        },
      },
    };
    const prDiffCommentabilityIndex = buildPrDiffCommentabilityIndex([
      "diff --git a/src/file.ts b/src/file.ts",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -10,2 +10,2 @@ void f()",
      " context",
      "+changed",
    ].join("\n"));

    const result = await publishInlineReviewComment({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: ["kodiai"],
      location: { path: "src/file.ts", line: 200, side: "RIGHT" },
      body: "line comment",
      prDiffCommentabilityIndex,
    });

    expect(createReviewCommentCalls).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("line-not-commentable-in-pr-diff");
  });
});

describe("createInlineReviewServer canonical marker", () => {
  test("stamps the trigger-agnostic canonical key, not the per-delivery reviewOutputKey, when both are provided", async () => {
    // Regression test: the model's own direct inline-comment publish must embed
    // the canonical (action/delivery-agnostic) marker so a later mention-triggered
    // re-review of the same PR/commit can find and reconcile with it.
    const perDeliveryKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-opened:delivery-d1:head-abcdef1234";
    const canonicalKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:head-abcdef1234";
    let persistedBody: string | undefined;

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async ({ body }: { body: string }) => {
            persistedBody = body;
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
        issues: { listComments: async () => ({ data: [] }) },
      },
    };

    const server = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey: perDeliveryKey,
      canonicalReviewOutputKey: canonicalKey,
      deliveryId: "delivery-123",
    });
    const handler = getToolHandler(server);

    const result = await handler({ path: "src/file.ts", body: "Finding body", line: 10, side: "RIGHT" });

    expect(result.content[0]?.text).toContain("\"success\":true");
    expect(persistedBody).toBeDefined();
    expect(persistedBody).toContain(`<!-- kodiai:review-output-key:${canonicalKey} -->`);
    expect(persistedBody).not.toContain(perDeliveryKey);
  });
});

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
    createReviewOutputPublicationGate({
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    const firstServer = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-123",
    });
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

    const secondServer = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-123",
    });
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

  test("replayed inline tool call skips when the first call created the comment but returned an error", async () => {
    const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-456:head-abcdef1234";
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
            if (createReviewCommentCalls === 1) {
              throw new Error("network timeout after GitHub accepted inline comment");
            }
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
    const publicationGate = createReviewOutputPublicationGate({
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    const firstServer = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-456",
      publicationGate,
    });
    const firstResult = await getToolHandler(firstServer)({
      path: "src/file.ts",
      body: "This exact inline note should be idempotent.",
      line: 10,
      side: "RIGHT",
    });

    expect(firstResult.isError).toBe(true);
    expect(createReviewCommentCalls).toBe(1);

    const retryServer = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-456",
      publicationGate,
    });
    const retryResult = await getToolHandler(retryServer)({
      path: "src/file.ts",
      body: "This exact inline note should be idempotent.",
      line: 10,
      side: "RIGHT",
    });

    expect(createReviewCommentCalls).toBe(1);
    expect(retryResult.isError).toBeUndefined();
    expect(retryResult.content[0]?.text).toContain("\"skipped\":true");
    expect(retryResult.content[0]?.text).toContain("\"reason\":\"inline-already-published\"");
  });

  test("replayed inline tool call finds an existing inline marker after the first page", async () => {
    const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-789:head-abcdef1234";
    const body = "This exact inline note should be idempotent on busy PRs.";
    let createReviewCommentCalls = 0;
    const reviewCommentBodies: string[] = [];
    const listReviewCommentCalls: Array<{ page?: number; per_page?: number }> = [];

    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async (params: { page?: number; per_page?: number }) => {
            listReviewCommentCalls.push(params);
            if (params.page === 1) {
              return {
                data: Array.from({ length: 100 }, (_, index) => ({
                  id: index + 1,
                  body: "ordinary inline comment",
                })),
              };
            }
            return {
              data: reviewCommentBodies.map((commentBody, index) => ({
                id: 101 + index,
                body: commentBody,
              })),
            };
          },
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async ({ body: persistedBody }: { body: string }) => {
            createReviewCommentCalls++;
            reviewCommentBodies.push(persistedBody);
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
    const publicationGate = createReviewOutputPublicationGate({
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
    });

    const firstServer = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-789",
      publicationGate,
    });
    await getToolHandler(firstServer)({
      path: "src/file.ts",
      body,
      line: 10,
      side: "RIGHT",
    });

    const retryServer = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-789",
      publicationGate,
    });
    const retryResult = await getToolHandler(retryServer)({
      path: "src/file.ts",
      body,
      line: 10,
      side: "RIGHT",
    });

    expect(createReviewCommentCalls).toBe(1);
    expect(listReviewCommentCalls.map((call) => call.page)).toContain(2);
    expect(listReviewCommentCalls.filter((call) => call.page === 2)).toHaveLength(3);
    expect(listReviewCommentCalls.every((call) => call.per_page === 100)).toBe(true);
    expect(retryResult.isError).toBeUndefined();
    expect(retryResult.content[0]?.text).toContain("\"skipped\":true");
    expect(retryResult.content[0]?.text).toContain("\"reason\":\"inline-already-published\"");
  });
});

// --- Outgoing publication pipeline regression tests ---

describe("outgoing publication pipeline", () => {
  test("create_inline_comment redacts zero-width-obfuscated github tokens after content normalization", async () => {
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

    const server = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
    });
    const handler = getToolHandler(server);

    const token = "ghs_" + "a".repeat(18) + "\u200B" + "a".repeat(18);
    const result = await handler({
      path: "src/file.ts",
      body: token,
      line: 10,
      side: "RIGHT",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("\"success\":true");
    expect(calledBody).toBeDefined();
    expect(calledBody!).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(calledBody!).not.toContain("ghs_");
    expect(calledBody!).not.toContain("\u200B");
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

    const server = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: ["kodiai", "claude"],
    });
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
    const server = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      deliveryId: "delivery-123",
      logger: logger as never,
    });
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
    const prDiffCommentabilityIndex = buildPrDiffCommentabilityIndex([
      "diff --git a/src/file.ts b/src/file.ts",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -700,18 +789,12 @@ void f()",
      " context",
      "+added",
      " context",
    ].join("\n"));

    const { logger, infoCalls, warnCalls } = createMockLogger();
    const server = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey: "review-key",
      deliveryId: "delivery-123",
      logger: logger as never,
      prDiffCommentabilityIndex,
    });
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
    expect(infoCalls).toHaveLength(1);
    expect(warnCalls).toHaveLength(0);
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
    const server = createInlineReviewServer({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey: "review-key",
      deliveryId: "delivery-123",
      logger: logger as never,
    });
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
