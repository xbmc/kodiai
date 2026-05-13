import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createInlineReviewServer } from "./inline-review-server.ts";
import { createCommentServer } from "./comment-server.ts";
import { createReviewOutputPublicationGate } from "./review-output-publication-gate.ts";
import type { CandidatePublicationPolicyAttempt } from "../../specialists/candidate-publication-policy.ts";

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

function getCommentToolHandler(server: ReturnType<typeof createCommentServer>) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }
    >;
  };
  const tool = instance._registeredTools?.create_comment;
  if (!tool) {
    throw new Error("create_comment tool is not registered");
  }
  return tool.handler;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateKey(candidate: CandidatePublicationPolicyAttempt): string {
  const material = {
    path: String(candidate.path ?? "").trim().slice(0, 256),
    side: String(candidate.side ?? "").trim().slice(0, 32),
    line: Number(candidate.line),
    startLine: candidate.startLine === undefined ? null : Number(candidate.startLine),
    reviewOutputKey: String(candidate.reviewOutputKey ?? "").trim().slice(0, 256),
    deliveryId: String(candidate.deliveryId ?? "").trim().slice(0, 256),
    bodySignal: sha256(String(candidate.body ?? "").slice(0, 4096)),
  };
  return `m070-publication:${sha256(JSON.stringify(material))}`;
}

function m070Evidence(decision: string, candidate: CandidatePublicationPolicyAttempt) {
  return [{ candidateKey: candidateKey(candidate), decision, evidenceId: `${decision}-1` }];
}

function collectSerialized(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n");
}

describe("createInlineReviewServer M070 candidate publication gate", () => {
  const reviewOutputKey = "review-output-m070";
  const deliveryId = "delivery-m070";
  const baseCandidate = {
    path: "src/file.ts",
    body: "CANARY-ALLOWED-CANDIDATE-BODY",
    line: 10,
    side: "RIGHT" as const,
    reviewOutputKey,
    deliveryId,
  };

  function createOctokit() {
    let pullsGetCalls = 0;
    let createReviewCommentCalls = 0;
    const reviewBodies: string[] = [];
    const issueBodies: string[] = [];
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: reviewBodies.map((body, index) => ({ id: index + 1, body })),
          }),
          listReviews: async () => ({ data: [] }),
          get: async () => {
            pullsGetCalls++;
            return { data: { head: { sha: "abcdef1234" } } };
          },
          createReviewComment: async ({ body }: { body: string }) => {
            createReviewCommentCalls++;
            reviewBodies.push(body);
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
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueBodies.push(body);
            return { data: { id: issueBodies.length, html_url: "https://example.test/comment" } };
          },
        },
      },
    };
    return {
      octokit,
      reviewBodies,
      issueBodies,
      get pullsGetCalls() { return pullsGetCalls; },
      get createReviewCommentCalls() { return createReviewCommentCalls; },
    };
  }

  async function publishWithDecision(decision: string, candidateOverrides: Partial<typeof baseCandidate> = {}) {
    const candidate = { ...baseCandidate, ...candidateOverrides };
    const state = createOctokit();
    const { logger, infoCalls, warnCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => state.octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      deliveryId,
      logger as never,
      undefined,
      undefined,
      undefined,
      undefined,
      { docsConfigTruth: { evidence: m070Evidence(decision, candidate) }, deliveryId, reviewOutputKey, correlationKey: "correlation-m070" },
    );
    const result = await getToolHandler(server)(candidate);
    return { ...state, result, infoCalls, warnCalls };
  }

  test("verified allowed candidate reaches the existing inline adapter", async () => {
    const { result, createReviewCommentCalls, reviewBodies } = await publishWithDecision("verified");

    expect(result.isError).toBeUndefined();
    expect(createReviewCommentCalls).toBe(1);
    expect(reviewBodies[0]).toContain("CANARY-ALLOWED-CANDIDATE-BODY");
    expect(result.content[0]?.text).toContain("\"success\":true");
  });

  test("undisputed partial allowed candidate reaches the existing inline adapter", async () => {
    const { result, createReviewCommentCalls } = await publishWithDecision("partially_verified", {
      body: "CANARY-PARTIAL-CANDIDATE-BODY",
    });

    expect(result.isError).toBeUndefined();
    expect(createReviewCommentCalls).toBe(1);
  });

  test("disputed, unverified, disproven, unclassifiable, and malformed candidates do not call GitHub publication", async () => {
    const cases = [
      {
        name: "disputed",
        evidence: (candidate: CandidatePublicationPolicyAttempt) => [
          { candidateKey: candidateKey(candidate), decision: "verified", evidenceId: "support" },
          { candidateKey: candidateKey(candidate), decision: "disproven", evidenceId: "deny" },
        ],
      },
      { name: "unverified", evidence: () => [] },
      { name: "disproven", evidence: (candidate: CandidatePublicationPolicyAttempt) => m070Evidence("disproven", candidate) },
      { name: "unclassifiable", evidence: (candidate: CandidatePublicationPolicyAttempt) => m070Evidence("invented-status", candidate) },
      { name: "malformed", evidence: () => "not-an-array" },
    ];

    for (const entry of cases) {
      const candidate = { ...baseCandidate, body: `CANARY-${entry.name.toUpperCase()}-BODY` };
      const state = createOctokit();
      const { logger, infoCalls } = createMockLogger();
      const server = createInlineReviewServer(
        async () => state.octokit as never,
        "acme",
        "repo",
        101,
        [],
        reviewOutputKey,
        deliveryId,
        logger as never,
        undefined,
        undefined,
        undefined,
        undefined,
        { docsConfigTruth: { evidence: entry.evidence(candidate) }, deliveryId, reviewOutputKey, correlationKey: "correlation-m070" },
      );

      const result = await getToolHandler(server)(candidate);
      const responseText = result.content[0]?.text ?? "";
      const logs = collectSerialized(infoCalls);

      expect(result.isError).toBe(true);
      expect(responseText).toContain("\"reason\":\"m070-candidate-verification-denied\"");
      expect(state.createReviewCommentCalls).toBe(0);
      expect(state.pullsGetCalls).toBe(0);
      expect(responseText).not.toContain(candidate.body);
      expect(logs).not.toContain(candidate.body);
      expect(logs).toContain("m070-candidate-publication-policy");
    }
  });

  test("denied candidate then create_comment returns fallback blocked JSON", async () => {
    const candidate = { ...baseCandidate, body: "CANARY-DENIED-FALLBACK-BODY" };
    const state = createOctokit();
    const gate = createReviewOutputPublicationGate({
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      reviewOutputKey,
      candidateVerificationContext: { docsConfigTruth: { evidence: [] }, deliveryId, reviewOutputKey, correlationKey: "correlation-m070" },
    });
    const inlineServer = createInlineReviewServer(
      async () => state.octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      deliveryId,
      undefined,
      undefined,
      gate,
    );
    const denied = await getToolHandler(inlineServer)(candidate);
    expect(denied.isError).toBe(true);
    expect(state.createReviewCommentCalls).toBe(0);

    const commentServer = createCommentServer(
      async () => state.octokit as never,
      "acme",
      "repo",
      [],
      reviewOutputKey,
      undefined,
      101,
      undefined,
      undefined,
      gate,
    );
    const fallback = await getCommentToolHandler(commentServer)({ issueNumber: 101, body: "fallback body" });

    expect(fallback.isError).toBe(true);
    expect(fallback.content[0]?.text).toContain("\"fallback_blocked\":true");
    expect(fallback.content[0]?.text).toContain("\"candidate_publication_state\":\"skipped\"");
    expect(fallback.content[0]?.text).toContain("\"candidate_publication_reason\":\"m070-candidate-verification-denied\"");
    expect(state.issueBodies).toHaveLength(0);
  });

  test("allowed secret-bearing body is still blocked by outgoing secret scan", async () => {
    const secretBody = "Token ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ should not publish";
    const { result, createReviewCommentCalls } = await publishWithDecision("verified", { body: secretBody });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("[SECURITY: response blocked");
    expect(createReviewCommentCalls).toBe(0);
  });

  test("non-commentable line remains commentability-blocked before policy evaluation", async () => {
    let policyCalls = 0;
    const state = createOctokit();
    const server = createInlineReviewServer(
      async () => state.octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      deliveryId,
      undefined,
      undefined,
      undefined,
      [
        "diff --git a/src/file.ts b/src/file.ts",
        "--- a/src/file.ts",
        "+++ b/src/file.ts",
        "@@ -1,1 +10,1 @@ void f()",
        "+added",
      ].join("\n"),
      () => {
        policyCalls++;
        throw new Error("policy should not be called");
      },
      { docsConfigTruth: { evidence: [] }, deliveryId, reviewOutputKey },
    );

    const result = await getToolHandler(server)({ ...baseCandidate, line: 99 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("RIGHT line 99 is not commentable");
    expect(policyCalls).toBe(0);
    expect(state.createReviewCommentCalls).toBe(0);
  });

  test("already-published marker remains idempotency skipped before M070 denial", async () => {
    const marker = `<!-- kodiai:review-output-key:${reviewOutputKey} -->`;
    const state = createOctokit();
    state.reviewBodies.push(marker);
    const server = createInlineReviewServer(
      async () => state.octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      deliveryId,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        throw new Error("policy should not run after idempotency skip");
      },
      { docsConfigTruth: { evidence: [] }, deliveryId, reviewOutputKey },
    );

    const result = await getToolHandler(server)(baseCandidate);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("\"reason\":\"already-published\"");
    expect(state.createReviewCommentCalls).toBe(0);
  });

  test("M070 response and logs omit raw canaries and unsafe payload fields", async () => {
    const candidate = {
      ...baseCandidate,
      body: "RAW-CANDIDATE-BODY-CANARY",
      prompt: "RAW-PROMPT-CANARY",
      modelOutput: "RAW-MODEL-OUTPUT-CANARY",
      rawFingerprint: "RAW-FINGERPRINT-CANARY",
    };
    const state = createOctokit();
    const { logger, infoCalls } = createMockLogger();
    const server = createInlineReviewServer(
      async () => state.octokit as never,
      "acme",
      "repo",
      101,
      [],
      reviewOutputKey,
      deliveryId,
      logger as never,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        docsConfigTruth: {
          evidence: [{
            candidateKey: candidateKey(candidate),
            decision: "disproven",
            specialistProse: "RAW-SPECIALIST-PROSE-CANARY",
            diff: "RAW-DIFF-CANARY",
            payload: "RAW-EVIDENCE-PAYLOAD-CANARY",
          }],
        },
        deliveryId,
        reviewOutputKey,
        correlationKey: "correlation-m070",
      },
    );

    const result = await getToolHandler(server)(candidate);
    const serialized = `${result.content[0]?.text ?? ""}\n${collectSerialized(infoCalls)}`;

    for (const forbidden of [
      "RAW-CANDIDATE-BODY-CANARY",
      "RAW-SPECIALIST-PROSE-CANARY",
      "RAW-PROMPT-CANARY",
      "RAW-MODEL-OUTPUT-CANARY",
      "RAW-DIFF-CANARY",
      "RAW-EVIDENCE-PAYLOAD-CANARY",
      "RAW-FINGERPRINT-CANARY",
      candidateKey(candidate),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain("candidate-");
    expect(state.createReviewCommentCalls).toBe(0);
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
      reason: "inline-publication-failed",
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
      reason: "inline-publication-failed",
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
