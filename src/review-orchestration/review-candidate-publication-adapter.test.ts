import { describe, expect, test } from "bun:test";
import { parseInlineCommentMetadata } from "../lib/review-utils.ts";
import {
  createInlineReviewPublisher,
  type InlineReviewPublicationResult,
} from "../execution/mcp/inline-review-publisher.ts";
import { createReviewOutputPublicationGate } from "../execution/mcp/review-output-publication-gate.ts";
import {
  createReviewCandidateFindingExecutionResult,
  type ReviewCandidateFinding,
  type ReviewCandidateFindingExecutionResult,
} from "./review-candidate-finding.ts";
import {
  type ProcessedReviewFinding,
  type ReviewReducerResult,
} from "./review-reducer.ts";
import {
  coordinateReviewCandidateApproval,
  type ReviewCandidateApprovalResult,
} from "./review-candidate-approval.ts";
import {
  adaptApprovedCandidatesForInlinePublication,
  buildCandidateReviewOutputKey,
  convertPublishedCandidateResultsToProcessedFindings,
  toReviewCandidatePublicationAdapterSummary,
} from "./review-candidate-publication-adapter.ts";

const BASE_INPUT = {
  repo: "owner/repo",
  pullNumber: 42,
  reviewOutputKey: "review-output-abc123",
  deliveryId: "delivery-001",
};

describe("review candidate publication adapter", () => {
  test("adapts only approved and rewritten candidates into inline publisher payloads with parseable YAML metadata", () => {
    const candidates = candidateResult([
      candidateInput("src/approved.ts", "Approved candidate", { startLine: 20, endLine: 20, severity: "major", category: "correctness" }),
      candidateInput("src/rewrite.ts", "Stale rewrite title", { startLine: 30, endLine: 33, severity: "minor", category: "style" }),
      candidateInput("src/suppressed.ts", "Suppressed candidate", { startLine: 40, endLine: 40 }),
    ]);
    const approvedCandidate = candidates.findings[0]!;
    const rewrittenCandidate = candidates.findings[1]!;
    const suppressedCandidate = candidates.findings[2]!;
    const rewrittenVisible = reducerFinding(2, rewrittenCandidate, {
      candidateFingerprint: rewrittenCandidate.fingerprint,
      title: "Rewritten reducer title",
      severity: "critical",
      category: "security",
      filterAction: "rewritten",
      originalTitle: rewrittenCandidate.title,
      body: "Rewritten reducer body should be published.",
    });
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: [
          reducerFinding(1, approvedCandidate, { candidateFingerprint: approvedCandidate.fingerprint }),
          rewrittenVisible,
          reducerFinding(3, suppressedCandidate, { candidateFingerprint: suppressedCandidate.fingerprint, suppressed: true }),
        ],
        visibleFindings: [
          reducerFinding(1, approvedCandidate, { candidateFingerprint: approvedCandidate.fingerprint }),
          rewrittenVisible,
        ],
        filteredInlineFindings: [
          reducerFinding(3, suppressedCandidate, { candidateFingerprint: suppressedCandidate.fingerprint, suppressed: true }),
        ],
      }),
    });

    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult({ visibleFindings: [rewrittenVisible] }) });

    expect(adapted.payloads).toHaveLength(2);
    expect(adapted.summary.counts).toMatchObject({ input: 2, publishable: 2, skipped: 0, approved: 1, rewritten: 1 });
    expect(adapted.payloads.map((payload) => payload.candidatePublicationLifecycle)).toEqual(["approved", "rewritten"]);
    expect(adapted.payloads.map((payload) => payload.candidateFingerprint)).toEqual([
      approvedCandidate.fingerprint,
      rewrittenCandidate.fingerprint,
    ]);
    expect(adapted.payloads[0]!.publication.location).toEqual({ path: "src/approved.ts", line: 20, side: "RIGHT" });
    expect(adapted.payloads[1]!.publication.location).toEqual({ path: "src/rewrite.ts", startLine: 30, line: 33, side: "RIGHT" });

    const approvedMetadata = parseInlineCommentMetadata(adapted.payloads[0]!.publication.body);
    expect(approvedMetadata).toEqual({ severity: "major", category: "correctness", title: "Approved candidate" });
    const rewrittenMetadata = parseInlineCommentMetadata(adapted.payloads[1]!.publication.body);
    expect(rewrittenMetadata).toEqual({ severity: "critical", category: "security", title: "Rewritten reducer title" });
    expect(adapted.payloads[1]!.publication.body).toContain("Rewritten reducer body should be published.");
    expect(adapted.payloads[1]!.publication.body).not.toContain("Stale rewrite title body is safe and grounded.");
  });

  test("skips malformed approval references and missing rewritten reducer joins with bounded reasons", () => {
    const candidates = candidateResult([
      candidateInput("src/missing-line.ts", "Missing line", { startLine: undefined, endLine: undefined }),
      candidateInput("src/rewrite.ts", "Rewrite without visible reducer", { startLine: 10, endLine: 10 }),
    ]);
    const [missingLineCandidate, rewrittenCandidate] = candidates.findings;
    const approval: ReviewCandidateApprovalResult = {
      outcomes: [],
      approvedCandidates: [
        { lifecycle: "approved", fingerprint: missingLineCandidate!.fingerprint, candidate: missingLineCandidate! },
        { lifecycle: "approved", fingerprint: "rcf-ffffffffffffffff", candidate: undefined as unknown as ReviewCandidateFinding },
      ],
      rewrittenCandidates: [
        { lifecycle: "rewritten", fingerprint: rewrittenCandidate!.fingerprint, candidate: rewrittenCandidate!, reason: "reducer-rewritten" },
      ],
      counts: { input: 3, approved: 2, rewritten: 1, suppressed: 0, deduped: 0, rejected: 0, fallbackDisallowed: 0, auditEvents: 0 },
      audit: [],
      detailsSummary: { label: "Review candidate approval", text: "Review candidate approval: test" },
    };

    const warnings: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), logger: logger as never });

    expect(warnings).toEqual([
      expect.arrayContaining([
        expect.objectContaining({
          fingerprint: rewrittenCandidate!.fingerprint,
          lifecycle: "rewritten",
          reason: "missing-rewrite-visible-finding",
          sourceReason: "reducer-rewritten",
          filePath: "src/rewrite.ts",
          startLine: 10,
          endLine: 10,
        }),
        "Rewritten review candidate missing visible reducer finding",
      ]),
    ]);

    expect(adapted.payloads).toEqual([]);
    expect(adapted.summary.counts).toMatchObject({ input: 3, publishable: 0, skipped: 3 });
    expect(adapted.summary.skipped.map((item) => item.reason)).toEqual([
      "missing-line",
      "missing-candidate",
      "missing-rewrite-visible-finding",
    ]);
    expect(toReviewCandidatePublicationAdapterSummary(adapted.summary).text).toContain("reasons=missing-line,missing-candidate,missing-rewrite-visible-finding");
  });

  test("keeps bounded summaries free of raw candidate bodies, evidence, prompts, diffs, and secrets", () => {
    const candidates = candidateResult([
      candidateInput("src/secret.ts", "Secret title", {
        startLine: 10,
        endLine: 10,
        body: "Body includes implementation details that should not appear in summaries.",
        evidence: "Full evidence should not appear in summaries.",
      }),
    ]);
    const candidate = candidates.findings[0]!;
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: [reducerFinding(1, candidate, { candidateFingerprint: candidate.fingerprint })],
        visibleFindings: [reducerFinding(1, candidate, { candidateFingerprint: candidate.fingerprint })],
      }),
    });

    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult() });
    const summary = toReviewCandidatePublicationAdapterSummary(adapted.summary);

    expect(summary.label).toBe("Review candidate publication adapter");
    expect(summary.text.length).toBeLessThanOrEqual(280);
    expect(summary.text).toContain("publishable=1");
    expect(summary.text).toContain(candidate.fingerprint);
    for (const unsafe of ["sk-secret1234567890", "BEGIN PROMPT", "diff --git", "Body includes", "Full evidence", "Secret title"]) {
      expect(summary.text).not.toContain(unsafe);
    }
  });

  test("creates processed findings only for successful publisher results with numeric comment IDs", () => {
    const candidates = candidateResult([
      candidateInput("src/published.ts", "Published candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/skipped.ts", "Skipped candidate", { startLine: 20, endLine: 20 }),
      candidateInput("src/malformed.ts", "Malformed publisher result", { startLine: 30, endLine: 30 }),
    ]);
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
        visibleFindings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
      }),
    });
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult() });

    const converted = convertPublishedCandidateResultsToProcessedFindings({
      payloads: adapted.payloads,
      results: new Map<string, InlineReviewPublicationResult>([
        [candidates.findings[0]!.fingerprint, { status: "published", commentId: 1234, content: [{ type: "text", text: "{}" }] }],
        [candidates.findings[1]!.fingerprint, { status: "skipped", reason: "already-published", content: [{ type: "text", text: "{}" }] }],
        [candidates.findings[2]!.fingerprint, { status: "published", content: [{ type: "text", text: "{}" }] }],
      ]),
    });

    expect(converted.findings).toHaveLength(1);
    expect(converted.findings[0]).toMatchObject({
      commentId: 1234,
      filePath: "src/published.ts",
      title: "Published candidate",
      candidateFingerprint: candidates.findings[0]!.fingerprint,
      candidatePublicationLifecycle: "approved",
      publicationStatus: "published",
    });
    expect(converted.summary.counts).toMatchObject({ input: 3, processed: 1, skipped: 1, failed: 0, blocked: 0, malformed: 1 });
    expect(converted.summary.results.map((result) => result.reason)).toEqual([
      "published",
      "already-published",
      "missing-comment-id",
    ]);
  });

  test("feeds adapter payloads through the shared inline publisher boundary", async () => {
    const candidates = candidateResult([
      candidateInput("src/published.ts", "@kodiai publishable candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/skipped.ts", "Idempotent candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/non-commentable.ts", "Non commentable candidate", { startLine: 11, endLine: 11 }),
      candidateInput("src/secret.ts", "Secret candidate", {
        startLine: 10,
        endLine: 10,
        body: "Credential-like fixture AKIA1234567890123456 must be blocked before GitHub create.",
      }),
    ]);
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
        visibleFindings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
      }),
    });
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult() });
    const payloadByPath = new Map(adapted.payloads.map((payload) => [payload.publication.location.path, payload]));
    const publishedBodies: string[] = [];
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        pulls: {
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async (params: { body: string; path: string; line: number }) => {
            createReviewCommentCalls++;
            publishedBodies.push(params.body);
            return {
              data: {
                id: 9000 + createReviewCommentCalls,
                html_url: `https://example.test/comment/${9000 + createReviewCommentCalls}`,
                path: params.path,
                line: params.line,
                original_line: params.line,
              },
            };
          },
        },
      },
    };

    async function publishPath(
      path: string,
      options: { shouldPublish?: boolean; prDiffForCommentValidation?: string } = {},
    ): Promise<InlineReviewPublicationResult> {
      const payload = payloadByPath.get(path);
      if (!payload) throw new Error(`missing payload for ${path}`);
      const publisher = createInlineReviewPublisher({
        getOctokit: async () => octokit as never,
        owner: "acme",
        repo: "repo",
        prNumber: 101,
        botHandles: ["kodiai"],
        reviewOutputKey: `review-output-${path}`,
        publicationGate: {
          resolve: async () => ({ shouldPublish: options.shouldPublish ?? true }) as never,
        },
        prDiffForCommentValidation: options.prDiffForCommentValidation,
      });
      return publisher.publish(payload.publication);
    }

    const published = await publishPath("src/published.ts");
    const skipped = await publishPath("src/skipped.ts", { shouldPublish: false });
    const nonCommentable = await publishPath("src/non-commentable.ts", {
      prDiffForCommentValidation: [
        "diff --git a/src/non-commentable.ts b/src/non-commentable.ts",
        "--- a/src/non-commentable.ts",
        "+++ b/src/non-commentable.ts",
        "@@ -1,1 +10,1 @@",
        "+commentable",
      ].join("\n"),
    });
    const blocked = await publishPath("src/secret.ts");

    expect(published.status).toBe("published");
    expect(published.commentId).toBe(9001);
    expect(skipped).toMatchObject({ status: "skipped", reason: "already-published" });
    expect(nonCommentable).toMatchObject({ status: "failed", reason: "line-not-commentable-in-pr-diff" });
    expect(blocked).toMatchObject({ status: "blocked", reason: "secret-detected" });
    expect(createReviewCommentCalls).toBe(1);
    expect(publishedBodies[0]).not.toContain("@kodiai");
    expect(publishedBodies[0]).toContain("kodiai publishable candidate");

    const converted = convertPublishedCandidateResultsToProcessedFindings({
      payloads: adapted.payloads,
      results: new Map<string, InlineReviewPublicationResult>([
        [payloadByPath.get("src/published.ts")!.candidateFingerprint, published],
        [payloadByPath.get("src/skipped.ts")!.candidateFingerprint, skipped],
        [payloadByPath.get("src/non-commentable.ts")!.candidateFingerprint, nonCommentable],
        [payloadByPath.get("src/secret.ts")!.candidateFingerprint, blocked],
      ]),
    });

    expect(converted.findings).toHaveLength(1);
    expect(converted.findings[0]).toMatchObject({
      commentId: 9001,
      filePath: "src/published.ts",
      publicationStatus: "published",
    });
    expect(converted.summary.counts).toMatchObject({ input: 4, processed: 1, skipped: 1, blocked: 1, failed: 1, malformed: 0 });
    expect(converted.summary.results.map((result) => result.reason)).toEqual([
      "published",
      "already-published",
      "line-not-commentable-in-pr-diff",
      "secret-detected",
    ]);
  });

  test("uses candidate-specific review output keys so distinct candidates publish once and replays skip", async () => {
    const candidates = candidateResult([
      candidateInput("src/first.ts", "First candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/second.ts", "Second candidate", { startLine: 20, endLine: 20 }),
    ]);
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
        visibleFindings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
      }),
    });
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult() });
    const publishedBodies: string[] = [];
    let createReviewCommentCalls = 0;
    const octokit = {
      rest: {
        issues: {
          listComments: async () => ({ data: [] }),
        },
        pulls: {
          listReviewComments: async () => ({
            data: publishedBodies.map((body, index) => ({ id: index + 1, body })),
          }),
          listReviews: async () => ({ data: [] }),
          get: async () => ({ data: { head: { sha: "abcdef1234" } } }),
          createReviewComment: async (params: { body: string; path: string; line: number }) => {
            createReviewCommentCalls++;
            publishedBodies.push(params.body);
            return {
              data: {
                id: 7000 + createReviewCommentCalls,
                html_url: `https://example.test/comment/${7000 + createReviewCommentCalls}`,
                path: params.path,
                line: params.line,
                original_line: params.line,
              },
            };
          },
        },
      },
    };

    async function publishPayload(index: number): Promise<InlineReviewPublicationResult> {
      const payload = adapted.payloads[index];
      if (!payload) throw new Error(`missing payload ${index}`);
      const candidateReviewOutputKey = buildCandidateReviewOutputKey(BASE_INPUT.reviewOutputKey, payload.candidateFingerprint);
      const publisher = createInlineReviewPublisher({
        getOctokit: async () => octokit as never,
        owner: "owner",
        repo: "repo",
        prNumber: 42,
        botHandles: [],
        reviewOutputKey: candidateReviewOutputKey,
        publicationGate: createReviewOutputPublicationGate({
          owner: "owner",
          repo: "repo",
          prNumber: 42,
          reviewOutputKey: candidateReviewOutputKey,
        }),
      });
      return publisher.publish(payload.publication);
    }

    const first = await publishPayload(0);
    const second = await publishPayload(1);
    const replayFirst = await publishPayload(0);

    expect(first.status).toBe("published");
    expect(second.status).toBe("published");
    expect(replayFirst).toMatchObject({ status: "skipped", reason: "already-published" });
    expect(createReviewCommentCalls).toBe(2);
    expect(publishedBodies[0]).toContain(`<!-- kodiai:review-output-key:${buildCandidateReviewOutputKey(BASE_INPUT.reviewOutputKey, adapted.payloads[0]!.candidateFingerprint)} -->`);
    expect(publishedBodies[1]).toContain(`<!-- kodiai:review-output-key:${buildCandidateReviewOutputKey(BASE_INPUT.reviewOutputKey, adapted.payloads[1]!.candidateFingerprint)} -->`);
  });
});

function candidateInput(filePath: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    filePath,
    startLine: 10,
    endLine: 12,
    severity: "major",
    category: "correctness",
    title,
    body: `${title} body is safe and grounded.`,
    ...overrides,
  };
}

function candidateResult(candidates: Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"]): ReviewCandidateFindingExecutionResult {
  return createReviewCandidateFindingExecutionResult({ ...BASE_INPUT, artifactPresent: true, candidates });
}

function reducerFinding(
  commentId: number,
  candidate: ReviewCandidateFinding,
  overrides: Partial<ProcessedReviewFinding> & { candidateFingerprint?: string; body?: string } = {},
): ProcessedReviewFinding {
  return {
    commentId,
    filePath: candidate.filePath,
    title: candidate.title,
    severity: candidate.severity,
    category: candidate.category,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    suppressed: false,
    confidence: 90,
    body: candidate.body,
    ...overrides,
  };
}

function reducerResult(overrides: Partial<ReviewReducerResult> = {}): ReviewReducerResult {
  const findings = overrides.findings ?? [];
  const visibleFindings = overrides.visibleFindings ?? [];
  const filteredInlineFindings = overrides.filteredInlineFindings ?? [];
  const lowConfidenceFindings = overrides.lowConfidenceFindings ?? [];
  return {
    status: "ready",
    findings,
    visibleFindings,
    filteredInlineFindings,
    lowConfidenceFindings,
    suppressionMatchCounts: new Map(),
    filterRecords: [],
    counts: {
      input: findings.length,
      kept: visibleFindings.length,
      suppressed: filteredInlineFindings.filter((finding) => finding.suppressed).length,
      rewritten: visibleFindings.filter((finding) => finding.filterAction === "rewritten" || finding.filterAction === "guardrail-rewritten").length,
      deprioritized: filteredInlineFindings.filter((finding) => finding.deprioritized).length,
      lowConfidence: lowConfidenceFindings.length,
      auditEvents: 0,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    },
    audit: [],
    detailsSummary: { label: "Review reducer", status: "ready", text: "Review reducer: ready" },
    ...overrides,
  };
}
