import { describe, it, expect } from "bun:test";
import { buildMcpServers, buildMcpServerFactories, buildAllowedMcpTools } from "./index.ts";
import type { CandidatePublicationPolicyResult } from "../../specialists/candidate-publication-policy.ts";

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

function buildDeniedPolicyResult(): CandidatePublicationPolicyResult {
  return {
    allowed: false,
    status: "deny" as const,
    candidateRef: "candidate-test-denied",
    verificationState: "unverified" as const,
    reasonCategories: ["no-evidence", "classifier-fail-closed", "publication-ineligible"],
    counts: {
      candidateCount: 1,
      evidenceCount: 0,
      verifiedCount: 0,
      partiallyVerifiedCount: 0,
      unverifiedCount: 1,
      disprovenCount: 0,
      publicationEligibleCount: 0,
      duplicateCount: 0,
      disagreementCount: 0,
      unclassifiableCount: 0,
      malformedRecordCount: 0,
      truncatedCandidateCount: 0,
      truncatedEvidenceCount: 0,
      policyCandidateCount: 1,
    },
    hasDeliveryId: true,
    hasReviewOutputKey: true,
    hasCorrelationKey: true,
    redactionFlags: {
      privateOnly: true as const,
      candidateBodiesIncluded: false as const,
      specialistProseIncluded: false as const,
      rawPromptsIncluded: false as const,
      rawModelOutputIncluded: false as const,
      diffsIncluded: false as const,
      evidencePayloadsIncluded: false as const,
      rawFingerprintsIncluded: false as const,
      unsafeInputFieldCount: 0,
      discardedRawPayload: false,
      discardedPublicationFields: false,
      discardedEvidencePayloads: false,
      candidateAttemptIncluded: false as const,
      candidateKeyIncluded: false as const,
    },
  };
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

    it("blocks direct fallback after candidate inline publication succeeds", async () => {
      const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-mention-review:delivery-delivery-candidate-success:head-abcdef1234";
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
        deliveryId: "delivery-candidate-success",
        enableInlineTools: true,
        enableCommentTools: true,
      });

      const createInlineComment = getToolHandler(servers.github_inline_comment, "create_inline_comment");
      const inlineResult = await createInlineComment({
        path: "src/file.ts",
        body: "Consider: Candidate-approved inline publication.",
        line: 10,
        side: "RIGHT",
      });

      expect(inlineResult.isError).toBeUndefined();
      expect(createReviewCommentCalls).toBe(1);
      expect(persistedReviewBodies[0]).toContain(marker);

      const createSummaryComment = getToolHandler(servers.github_comment, "create_comment");
      const directFallbackResult = await createSummaryComment({
        issueNumber: 101,
        body: buildDraftSummaryBody(),
      });

      expect(directFallbackResult.isError).toBe(true);
      expect(directFallbackResult.content[0]?.text).toContain("\"fallback_blocked\":true");
      expect(directFallbackResult.content[0]?.text).toContain("\"candidate_publication_state\":\"published\"");
      expect(directFallbackResult.content[0]?.text).toContain("\"candidate_publication_reason\":\"candidate-already-published\"");
      expect(createCommentCalls).toBe(0);
      expect(persistedIssueBodies).toHaveLength(0);
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

    it("blocks direct fallback acceptance after candidate inline publication is skipped", async () => {
      const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-synchronize:delivery-delivery-direct-fallback:head-abcdef1234";
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
        deliveryId: "delivery-direct-fallback",
        enableInlineTools: true,
        enableCommentTools: true,
        prDiffForCommentValidation: [
          "diff --git a/src/file.ts b/src/file.ts",
          "--- a/src/file.ts",
          "+++ b/src/file.ts",
          "@@ -700,18 +789,12 @@ void f()",
          " context",
          "+added",
          " context",
        ].join("\n"),
      });

      const createInlineComment = getToolHandler(servers.github_inline_comment, "create_inline_comment");
      const skippedInlineResult = await createInlineComment({
        path: "src/file.ts",
        body: "Consider: This candidate targets a stale/non-commentable line.",
        line: 810,
        side: "RIGHT",
      });

      expect(skippedInlineResult.isError).toBe(true);
      expect(createReviewCommentCalls).toBe(0);
      expect(persistedReviewBodies).toHaveLength(0);

      const createSummaryComment = getToolHandler(servers.github_comment, "create_comment");
      const directFallbackResult = await createSummaryComment({
        issueNumber: 101,
        body: buildDraftSummaryBody(),
      });

      expect(directFallbackResult.isError).toBe(true);
      expect(directFallbackResult.content[0]?.text).toContain("\"fallback_blocked\":true");
      expect(directFallbackResult.content[0]?.text).toContain("\"candidate_publication_state\":\"failed\"");
      expect(directFallbackResult.content[0]?.text).toContain("\"candidate_publication_reason\":\"line-not-commentable-in-pr-diff\"");
      expect(createCommentCalls).toBe(0);
      expect(persistedIssueBodies).toHaveLength(0);
    });
    it("threads M070 candidate policy through shared buildMcpServers gate and blocks direct fallback after denial", async () => {
      const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-mention-review:delivery-delivery-m070-deny:head-abcdef1234";
      const emittedEvidence: unknown[] = [];
      let createReviewCommentCalls = 0;
      let createCommentCalls = 0;
      let pullsGetCalls = 0;
      let policyCalls = 0;
      const octokit = {
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              createCommentCalls++;
              return { data: { id: createCommentCalls, html_url: "https://example.test/comment" } };
            },
            updateComment: async () => ({ data: {} }),
          },
          pulls: {
            listReviewComments: async () => ({ data: [] }),
            listReviews: async () => ({ data: [] }),
            get: async () => {
              pullsGetCalls++;
              return { data: { head: { sha: "abcdef1234" } } };
            },
            createReviewComment: async () => {
              createReviewCommentCalls++;
              return { data: { id: createReviewCommentCalls, html_url: "https://example.test/review-comment", path: "src/file.ts", line: 10 } };
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
        deliveryId: "delivery-m070-deny",
        enableInlineTools: true,
        enableCommentTools: true,
        candidatePublicationPolicy: () => {
          policyCalls++;
          return buildDeniedPolicyResult();
        },
        candidateVerificationContext: { docsConfigTruth: { evidence: [] }, deliveryId: "delivery-m070-deny", reviewOutputKey, correlationKey: "correlation-m070" },
        candidateVerificationPublicationEvidenceSink: (summary) => emittedEvidence.push(summary),
      });

      const createInlineComment = getToolHandler(servers.github_inline_comment, "create_inline_comment");
      const denied = await createInlineComment({
        path: "src/file.ts",
        body: "RAW-BUILDER-DENIED-CANDIDATE-BODY",
        line: 10,
        side: "RIGHT",
      });

      expect(denied.isError).toBe(true);
      expect(denied.content[0]?.text).toContain("\"reason\":\"m070-candidate-verification-denied\"");
      expect(denied.content[0]?.text).not.toContain("RAW-BUILDER-DENIED-CANDIDATE-BODY");
      expect(policyCalls).toBe(1);
      expect(pullsGetCalls).toBe(0);
      expect(createReviewCommentCalls).toBe(0);

      const createSummaryComment = getToolHandler(servers.github_comment, "create_comment");
      const fallback = await createSummaryComment({ issueNumber: 101, body: buildDraftSummaryBody() });
      expect(fallback.isError).toBe(true);
      expect(fallback.content[0]?.text).toContain("\"fallback_blocked\":true");
      expect(fallback.content[0]?.text).toContain("\"candidate_publication_reason\":\"m070-candidate-verification-denied\"");
      expect(createCommentCalls).toBe(0);
      const evidenceJson = JSON.stringify(emittedEvidence);
      expect(emittedEvidence).toHaveLength(2);
      expect(evidenceJson).toContain("\"denied\":1");
      expect(evidenceJson).toContain("\"skipped\":1");
      expect(evidenceJson).toContain("correlation-m070");
      expect(evidenceJson).not.toContain("RAW-BUILDER-DENIED-CANDIDATE-BODY");
    });

    it("threads M070 candidate policy through buildMcpServerFactories", async () => {
      const reviewOutputKey = "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-mention-review:delivery-delivery-m070-factory-deny:head-abcdef1234";
      const emittedEvidence: unknown[] = [];
      let createReviewCommentCalls = 0;
      let pullsGetCalls = 0;
      let policyCalls = 0;
      const octokit = {
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => ({ data: { id: 1, html_url: "https://example.test/comment" } }),
            updateComment: async () => ({ data: {} }),
          },
          pulls: {
            listReviewComments: async () => ({ data: [] }),
            listReviews: async () => ({ data: [] }),
            get: async () => {
              pullsGetCalls++;
              return { data: { head: { sha: "abcdef1234" } } };
            },
            createReviewComment: async () => {
              createReviewCommentCalls++;
              return { data: { id: createReviewCommentCalls, html_url: "https://example.test/review-comment", path: "src/file.ts", line: 10 } };
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
        deliveryId: "delivery-m070-factory-deny",
        enableInlineTools: true,
        enableCommentTools: true,
        candidatePublicationPolicy: () => {
          policyCalls++;
          return buildDeniedPolicyResult();
        },
        candidateVerificationContext: { docsConfigTruth: { evidence: [] }, deliveryId: "delivery-m070-factory-deny", reviewOutputKey, correlationKey: "correlation-m070" },
        candidateVerificationPublicationEvidenceSink: (summary) => emittedEvidence.push(summary),
      });

      const createInlineComment = getToolHandler(factories.github_inline_comment!(), "create_inline_comment");
      const denied = await createInlineComment({
        path: "src/file.ts",
        body: "RAW-FACTORY-DENIED-CANDIDATE-BODY",
        line: 10,
        side: "RIGHT",
      });

      expect(denied.isError).toBe(true);
      expect(denied.content[0]?.text).toContain("\"reason\":\"m070-candidate-verification-denied\"");
      expect(denied.content[0]?.text).not.toContain("RAW-FACTORY-DENIED-CANDIDATE-BODY");
      expect(policyCalls).toBe(1);
      expect(pullsGetCalls).toBe(0);
      expect(createReviewCommentCalls).toBe(0);
      const evidenceJson = JSON.stringify(emittedEvidence);
      expect(emittedEvidence).toHaveLength(2);
      expect(evidenceJson).toContain("\"denied\":1");
      expect(evidenceJson).toContain("\"skipped\":1");
      expect(evidenceJson).toContain("correlation-m070");
      expect(evidenceJson).not.toContain("RAW-FACTORY-DENIED-CANDIDATE-BODY");
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
