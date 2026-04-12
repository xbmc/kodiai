import { describe, it, expect } from "bun:test";
import { buildMcpServers, buildMcpServerFactories, buildAllowedMcpTools } from "./index.ts";

function getToolHandler(server: unknown, toolName: string) {
  const instance = server as {
    instance?: {
      _registeredTools?: Record<
        string,
        {
          handler: (
            input: Record<string, unknown>,
          ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
        }
      >;
    };
  };

  const tool = instance.instance?._registeredTools?.[toolName];
  if (!tool) {
    throw new Error(`tool '${toolName}' is not registered`);
  }
  return tool.handler;
}

function buildDraftSummaryBody(): string {
  return [
    "<details>",
    "<summary>📝 Kodiai Draft Review Summary</summary>",
    "",
    "> **Draft** — This PR is still in draft. Feedback is exploratory; findings use softer language.",
    "",
    "## What Changed",
    "Touches addon installer behavior.",
    "",
    "Reviewed: core logic, docs",
    "",
    "## Observations",
    "",
    "### Impact",
    "[CRITICAL] src/file.ts (10): Example issue title",
    "Consider: This breaks when the loop overruns the array.",
    "",
    "## Verdict",
    ":red_circle: **Address before merging** -- 1 blocking issue(s) found",
    "",
    "</details>",
  ].join("\n");
}

// Minimal mock dependencies
function createMinimalDeps(overrides: Record<string, any> = {}) {
  return {
    getOctokit: async () => ({} as any),
    owner: "testowner",
    repo: "testrepo",
    ...overrides,
  };
}

describe("buildMcpServers", () => {
  describe("issue tools registration", () => {
    it("should register both issue tools when enableIssueTools is true and triageConfig provided", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: true,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      );

      expect("github_issue_label" in servers).toBe(true);
      expect("github_issue_comment" in servers).toBe(true);
    });

    it("should NOT register issue tools by default", () => {
      const servers = buildMcpServers(createMinimalDeps());

      expect("github_issue_label" in servers).toBe(false);
      expect("github_issue_comment" in servers).toBe(false);
    });

    it("should NOT register issue tools when enableIssueTools is true but no triageConfig", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: true,
        }),
      );

      expect("github_issue_label" in servers).toBe(false);
      expect("github_issue_comment" in servers).toBe(false);
    });

    it("should NOT register issue tools when enableIssueTools is false", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: false,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      );

      expect("github_issue_label" in servers).toBe(false);
      expect("github_issue_comment" in servers).toBe(false);
    });
  });

  describe("existing tools unaffected", () => {
    it("should still register github_comment by default", () => {
      const servers = buildMcpServers(createMinimalDeps());

      expect("github_comment" in servers).toBe(true);
    });

    it("should keep existing tools when issue tools are added", () => {
      const servers = buildMcpServers(
        createMinimalDeps({
          enableIssueTools: true,
          triageConfig: {
            enabled: true,
            label: { enabled: true },
            comment: { enabled: true },
          },
        }),
      );

      // Existing tool still present
      expect("github_comment" in servers).toBe(true);
      // New tools also present
      expect("github_issue_label" in servers).toBe(true);
      expect("github_issue_comment" in servers).toBe(true);
    });
  });

  describe("review output idempotency coordination", () => {
    it("allows summary and inline publications within the same execution for a fresh reviewOutputKey", async () => {
      const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-mention-review:delivery-delivery-123:head-abcdef1234";
      const marker = `<!-- kodiai:review-output-key:${reviewOutputKey} -->`;
      const persistedIssueBodies: string[] = [];
      const persistedReviewBodies: string[] = [];
      let createCommentCalls = 0;
      let createReviewCommentCalls = 0;

      const octokit = {
        rest: {
          issues: {
            listComments: async () => ({
              data: persistedIssueBodies.map((body, index) => ({ id: index + 1, body })),
            }),
            createComment: async ({ body }: { body: string }) => {
              createCommentCalls++;
              persistedIssueBodies.push(body);
              return { data: { id: createCommentCalls, html_url: "https://example.test/comment" } };
            },
            updateComment: async () => ({ data: {} }),
          },
          pulls: {
            listReviewComments: async () => ({
              data: persistedReviewBodies.map((body, index) => ({ id: index + 1, body })),
            }),
            listReviews: async () => ({ data: [] }),
            get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
            createReviewComment: async ({ body }: { body: string }) => {
              createReviewCommentCalls++;
              persistedReviewBodies.push(body);
              return {
                data: {
                  id: createReviewCommentCalls,
                  html_url: "https://example.test/review-comment",
                  path: "src/file.ts",
                  line: 10,
                  original_line: 10,
                },
              };
            },
          },
        },
      };

      const servers = buildMcpServers({
        getOctokit: async () => octokit as never,
        owner: "acme",
        repo: "repo",
        prNumber: 101,
        botHandles: [],
        reviewOutputKey,
        deliveryId: "delivery-123",
        enableInlineTools: true,
        enableCommentTools: true,
      });

      const createSummaryComment = getToolHandler(servers.github_comment, "create_comment");
      const createInlineComment = getToolHandler(servers.github_inline_comment, "create_inline_comment");

      const summaryResult = await createSummaryComment({
        issueNumber: 101,
        body: buildDraftSummaryBody(),
      });
      expect(summaryResult.isError).toBeUndefined();
      expect(createCommentCalls).toBe(1);
      expect(persistedIssueBodies[0]).toContain(marker);

      const inlineResult = await createInlineComment({
        path: "src/file.ts",
        body: "Consider: This still needs an inline comment.",
        line: 10,
        side: "RIGHT",
      });

      expect(inlineResult.isError).toBeUndefined();
      expect(createReviewCommentCalls).toBe(1);
      expect(inlineResult.content[0]?.text).toContain("\"success\":true");
      expect(persistedReviewBodies[0]).toContain(marker);
    });

    it("still skips inline publication on a later execution when the summary comment already published the reviewOutputKey", async () => {
      const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-mention-review:delivery-delivery-456:head-abcdef1234";
      const persistedIssueBodies: string[] = [];
      let createReviewCommentCalls = 0;

      const octokit = {
        rest: {
          issues: {
            listComments: async () => ({
              data: persistedIssueBodies.map((body, index) => ({ id: index + 1, body })),
            }),
            createComment: async ({ body }: { body: string }) => {
              persistedIssueBodies.push(body);
              return { data: { id: persistedIssueBodies.length, html_url: "https://example.test/comment" } };
            },
            updateComment: async () => ({ data: {} }),
          },
          pulls: {
            listReviewComments: async () => ({ data: [] }),
            listReviews: async () => ({ data: [] }),
            get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
            createReviewComment: async () => {
              createReviewCommentCalls++;
              return {
                data: {
                  id: createReviewCommentCalls,
                  html_url: "https://example.test/review-comment",
                  path: "src/file.ts",
                  line: 10,
                  original_line: 10,
                },
              };
            },
          },
        },
      };

      const firstExecutionServers = buildMcpServers({
        getOctokit: async () => octokit as never,
        owner: "acme",
        repo: "repo",
        prNumber: 101,
        botHandles: [],
        reviewOutputKey,
        deliveryId: "delivery-456",
        enableInlineTools: true,
        enableCommentTools: true,
      });

      const createSummaryComment = getToolHandler(firstExecutionServers.github_comment, "create_comment");
      const firstResult = await createSummaryComment({
        issueNumber: 101,
        body: buildDraftSummaryBody(),
      });
      expect(firstResult.isError).toBeUndefined();

      const secondExecutionServers = buildMcpServers({
        getOctokit: async () => octokit as never,
        owner: "acme",
        repo: "repo",
        prNumber: 101,
        botHandles: [],
        reviewOutputKey,
        deliveryId: "delivery-456",
        enableInlineTools: true,
        enableCommentTools: true,
      });

      const createInlineComment = getToolHandler(secondExecutionServers.github_inline_comment, "create_inline_comment");
      const secondResult = await createInlineComment({
        path: "src/file.ts",
        body: "Consider: This replay should skip.",
        line: 10,
        side: "RIGHT",
      });

      expect(createReviewCommentCalls).toBe(0);
      expect(secondResult.content[0]?.text).toContain("\"skipped\":true");
      expect(secondResult.content[0]?.text).toContain("\"reason\":\"already-published\"");
    });
  });
});

describe("buildAllowedMcpTools", () => {
  it("should map server names to exact MCP tool names", () => {
    const result = buildAllowedMcpTools([
      "github_issue_label",
      "github_issue_comment",
      "github_comment",
      "github_inline_comment",
      "github_ci",
    ]);

    expect(result).toEqual([
      "mcp__github_issue_label__add_labels",
      "mcp__github_issue_comment__create_comment",
      "mcp__github_issue_comment__update_comment",
      "mcp__github_comment__create_comment",
      "mcp__github_comment__update_comment",
      "mcp__github_inline_comment__create_inline_comment",
      "mcp__github_ci__get_ci_status",
      "mcp__github_ci__get_workflow_run_details",
    ]);
  });
});

describe("buildMcpServerFactories", () => {
  it("shares the same review output idempotency preflight across comment and inline server factories", async () => {
    const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-mention-review:delivery-delivery-789:head-abcdef1234";
    const persistedIssueBodies: string[] = [];
    let createReviewCommentCalls = 0;

    const octokit = {
      rest: {
        issues: {
          listComments: async () => ({
            data: persistedIssueBodies.map((body, index) => ({ id: index + 1, body })),
          }),
          createComment: async ({ body }: { body: string }) => {
            persistedIssueBodies.push(body);
            return { data: { id: persistedIssueBodies.length, html_url: "https://example.test/comment" } };
          },
          updateComment: async () => ({ data: {} }),
        },
        pulls: {
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async () => {
            createReviewCommentCalls++;
            return {
              data: {
                id: createReviewCommentCalls,
                html_url: "https://example.test/review-comment",
                path: "src/file.ts",
                line: 10,
                original_line: 10,
              },
            };
          },
        },
      },
    };

    const factories = buildMcpServerFactories({
      getOctokit: async () => octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      botHandles: [],
      reviewOutputKey,
      deliveryId: "delivery-789",
      enableInlineTools: true,
      enableCommentTools: true,
    });

    const createSummaryComment = getToolHandler(factories.github_comment!(), "create_comment");
    const createInlineComment = getToolHandler(factories.github_inline_comment!(), "create_inline_comment");

    const summaryResult = await createSummaryComment({
      issueNumber: 101,
      body: buildDraftSummaryBody(),
    });
    expect(summaryResult.isError).toBeUndefined();

    const inlineResult = await createInlineComment({
      path: "src/file.ts",
      body: "Consider: This should still publish inline from a fresh factory instance.",
      line: 10,
      side: "RIGHT",
    });

    expect(inlineResult.isError).toBeUndefined();
    expect(createReviewCommentCalls).toBe(1);
  });
});
