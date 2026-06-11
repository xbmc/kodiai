import { describe, expect, test } from "bun:test";
import {
  createInlineReviewPublisher,
  type InlineReviewPublicationResult,
} from "../execution/mcp/inline-review-publisher.ts";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
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
  convertPublishedCandidateResultsToValidationTruthFixes,
  toReviewCandidatePublicationAdapterSummary,
} from "./review-candidate-publication-adapter.ts";

const BASE_INPUT = {
  repo: "owner/repo",
  pullNumber: 42,
  reviewOutputKey: "review-output-abc123",
  deliveryId: "delivery-001",
};

const PR_DIFF = [
  "diff --git a/src/approved.ts b/src/approved.ts",
  "--- a/src/approved.ts",
  "+++ b/src/approved.ts",
  "@@ -20,1 +20,1 @@",
  "+approved line",
  "diff --git a/src/rewrite.ts b/src/rewrite.ts",
  "--- a/src/rewrite.ts",
  "+++ b/src/rewrite.ts",
  "@@ -30,4 +30,4 @@",
  "+rewrite 30",
  "+rewrite 31",
  "+rewrite 32",
  "+rewrite 33",
  "diff --git a/src/secret.ts b/src/secret.ts",
  "--- a/src/secret.ts",
  "+++ b/src/secret.ts",
  "@@ -10,1 +10,1 @@",
  "+secret line",
  "diff --git a/src/published.ts b/src/published.ts",
  "--- a/src/published.ts",
  "+++ b/src/published.ts",
  "@@ -10,1 +10,1 @@",
  "+published line",
  "diff --git a/src/non-commentable.ts b/src/non-commentable.ts",
  "--- a/src/non-commentable.ts",
  "+++ b/src/non-commentable.ts",
  "@@ -11,1 +11,1 @@",
  "+adapter-commentable-publisher-fixture",
  "diff --git a/src/skipped.ts b/src/skipped.ts",
  "--- a/src/skipped.ts",
  "+++ b/src/skipped.ts",
  "@@ -10,1 +10,1 @@",
  "+skipped line",
  "diff --git a/src/malformed.ts b/src/malformed.ts",
  "--- a/src/malformed.ts",
  "+++ b/src/malformed.ts",
  "@@ -30,1 +30,1 @@",
  "+malformed line",
  "diff --git a/src/first.ts b/src/first.ts",
  "--- a/src/first.ts",
  "+++ b/src/first.ts",
  "@@ -10,1 +10,1 @@",
  "+first line",
  "diff --git a/src/second.ts b/src/second.ts",
  "--- a/src/second.ts",
  "+++ b/src/second.ts",
  "@@ -20,1 +20,1 @@",
  "+second line",
].join("\n");

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
      body: "Rewritten reducer body should stay private outside approved suggestion blocks.",
      fixReplacementText: "Rewritten reducer replacement",
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

    const adapted = adaptApprovedCandidatesForInlinePublication({
      approval,
      reducer: reducerResult({ visibleFindings: [rewrittenVisible] }),
      prDiffText: PR_DIFF,
    });

    expect(adapted.payloads).toHaveLength(2);
    expect(adapted.summary.counts).toMatchObject({ input: 2, publishable: 2, skipped: 0, approved: 1, rewritten: 1, detailsOnlyFindings: 0, movedToDetails: 0 });
    expect(adapted.summary.fixEligibility.counts).toMatchObject({ input: 2, eligible: 2, blocked: 0, omitted: 0, capped: 0 });
    expect(adapted.payloads.map((payload) => payload.candidatePublicationLifecycle)).toEqual(["approved", "rewritten"]);
    expect(adapted.payloads.map((payload) => payload.candidateFingerprint)).toEqual([
      approvedCandidate.fingerprint,
      rewrittenCandidate.fingerprint,
    ]);
    expect(adapted.payloads[0]!.publication.location).toEqual({ path: "src/approved.ts", line: 20, side: "RIGHT" });
    expect(adapted.payloads[1]!.publication.location).toEqual({ path: "src/rewrite.ts", startLine: 30, line: 33, side: "RIGHT" });

    expect(adapted.payloads[0]!.publication.body).toContain("```suggestion\nApproved candidate replacement\n```");
    expect(adapted.payloads[1]!.publication.body).toContain("```suggestion\nRewritten reducer replacement\n```");
    expect(adapted.payloads[1]!.publication.body).toContain("**Fix suggestion:** Rewritten reducer title");
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
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF, logger: logger as never });

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

    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF });
    const summary = toReviewCandidatePublicationAdapterSummary(adapted.summary);

    expect(summary.label).toBe("Review candidate publication adapter");
    expect(summary.text.length).toBeLessThanOrEqual(280);
    expect(summary.text).toContain("publishable=1");
    expect(summary.text).toContain(candidate.fingerprint);
    for (const unsafe of ["sk-secret1234567890", "BEGIN PROMPT", "diff --git", "Body includes", "Full evidence", "Secret title"]) {
      expect(summary.text).not.toContain(unsafe);
    }
  });

  test("summarizes fix eligibility blocks without exposing raw replacements or candidate bodies", () => {
    const candidates = candidateResult([
      candidateInput("src/approved.ts", "Missing replacement", { startLine: 20, endLine: 20, fixReplacementText: undefined }),
      candidateInput("src/approved.ts", "Duplicate one", { startLine: 20, endLine: 20, fixReplacementText: "same replacement" }),
      candidateInput("src/approved.ts", "Duplicate two", { startLine: 20, endLine: 20, fixReplacementText: "same replacement" }),
      candidateInput("src/rewrite.ts", "Formatter owned", { startLine: 31, endLine: 31, fixReplacementText: "formatter owned replacement" }),
      candidateInput("src/secret.ts", "Secret replacement", { startLine: 10, endLine: 10, fixReplacementText: "safe candidate replacement" }),
      candidateInput("src/first.ts", "Over cap", { startLine: 10, endLine: 10, fixReplacementText: "over cap replacement" }),
    ]);
    const reducerVisibleFindings = candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, {
      candidateFingerprint: candidate.fingerprint,
      ...(index === 4 ? { fixReplacementText: "const key = 'AKIA1234567890ABCDEF';" } : {}),
    }));
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: reducerVisibleFindings,
        visibleFindings: reducerVisibleFindings,
      }),
    });
    approval.approvedCandidates.splice(2, 0, approval.approvedCandidates[1]!);

    const adapted = adaptApprovedCandidatesForInlinePublication({
      approval,
      reducer: reducerResult({ visibleFindings: reducerVisibleFindings }),
      prDiffText: PR_DIFF,
      formatterOwnedRanges: [{ path: "src/rewrite.ts", startLine: 31, endLine: 31 }],
      maxFixSuggestions: 1,
    });
    const summary = toReviewCandidatePublicationAdapterSummary(adapted.summary);

    expect(adapted.payloads).toHaveLength(1);
    expect(adapted.summary.fixEligibility.reasonCounts).toMatchObject({
      "missing-replacement": 1,
      eligible: 1,
      "duplicate-fix": 1,
      "formatter-owned": 1,
      "secret-detected": 1,
      "max-fixes-exceeded": 2,
    });
    expect(adapted.summary.fixEligibility.counts).toMatchObject({ input: 7, eligible: 1, blocked: 4, omitted: 2, capped: 2 });
    expect(summary.text).toContain("fixEligible=1");
    expect(summary.text).toContain("fixBlocked=4");
    expect(summary.text).toContain("fixCapped=2");
    for (const privateText of ["same replacement", "formatter owned replacement", "over cap replacement", "AKIA1234567890ABCDEF", "body is safe and grounded"]) {
      expect(summary.text).not.toContain(privateText);
    }
  });


  test("projects approved non-commentable fix candidates into bounded details-only findings", () => {
    const candidates = candidateResult([
      candidateInput("src/outside-diff.ts", "Preserved non-commentable title", {
        startLine: 77,
        endLine: 79,
        severity: "major",
        category: "performance",
        body: "Safe public context for the details projection.",
        fixReplacementText: "safe replacement that must not appear in details",
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

    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF });

    expect(adapted.payloads).toEqual([]);
    expect(adapted.summary.counts).toMatchObject({ publishable: 0, detailsOnlyFindings: 1, movedToDetails: 1, detailsOnlyOmitted: 0 });
    expect(adapted.summary.movedToDetails).toMatchObject({
      counts: { total: 1, fromFixEligibility: 1, fromPublisherResult: 0, omitted: 0 },
      reasonCounts: { "line-not-commentable": 1 },
      redaction: {
        rawCandidatePayloadsIncluded: false,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        diffsIncluded: false,
        replacementTextIncluded: false,
        githubResponsePayloadsIncluded: false,
        secretLikeValuesIncluded: false,
        bounded: true,
      },
    });
    expect(adapted.summary.detailsOnlyFindings).toEqual([
      {
        fingerprint: candidate.fingerprint,
        lifecycle: "approved",
        severity: "major",
        category: "performance",
        title: "Preserved non-commentable title",
        location: { path: "src/outside-diff.ts", startLine: 77, line: 79 },
        reason: "line-not-commentable",
        excerpt: "Safe public context for the details projection.",
      },
    ]);
    expect(JSON.stringify(adapted.summary.detailsOnlyFindings)).not.toContain("safe replacement that must not appear");
  });

  test("does not promote malformed, missing-line, or unsafe-path candidates to details-only findings", () => {
    const candidates = candidateResult([
      candidateInput("src/missing-line.ts", "Missing line", { startLine: undefined, endLine: undefined }),
      candidateInput("src/safe.ts", "Unsafe path shell", { startLine: 10, endLine: 10 }),
    ]);
    const missingLine = candidates.findings[0]!;
    const unsafePath = { ...candidates.findings[1]!, filePath: "../secrets.ts" };
    const approval: ReviewCandidateApprovalResult = {
      outcomes: [],
      approvedCandidates: [
        { lifecycle: "approved", fingerprint: missingLine.fingerprint, candidate: missingLine },
        { lifecycle: "approved", fingerprint: unsafePath.fingerprint, candidate: unsafePath },
        { lifecycle: "approved", fingerprint: "rcf-ffffffffffffffff", candidate: undefined as unknown as ReviewCandidateFinding },
      ],
      rewrittenCandidates: [],
      counts: { input: 3, approved: 3, rewritten: 0, suppressed: 0, deduped: 0, rejected: 0, fallbackDisallowed: 0, auditEvents: 0 },
      audit: [],
      detailsSummary: { label: "Review candidate approval", text: "Review candidate approval: test" },
    };

    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF });

    expect(adapted.payloads).toEqual([]);
    expect(adapted.summary.detailsOnlyFindings).toEqual([]);
    expect(adapted.summary.counts).toMatchObject({ skipped: 3, detailsOnlyFindings: 0, movedToDetails: 0 });
    expect(adapted.summary.skipped.map((item) => item.reason)).toEqual(["missing-line", "unsafe-path", "missing-candidate"]);
  });

  test("caps details-only projection and redacts secrets, prompt canaries, diffs, and replacements", () => {
    const rawSecret = "AKIA1234567890ABCDEF";
    const inputs = Array.from({ length: 25 }, (_, index) => candidateInput(`src/non-commentable-${index}.ts`, `Non commentable ${index} TOKEN=super-secret`, {
      startLine: 50 + index,
      endLine: 50 + index,
      body: `BEGIN PROMPT hidden ${index}\ndiff --git a/private b/private\n${rawSecret}\nVisible tail`,
      fixReplacementText: `replacement-canary-${index}`,
    }));
    const candidates = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      artifactPresent: true,
      unsafeTextDetector: () => false,
      candidates: inputs,
    });
    const reducerVisibleFindings = candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, {
      candidateFingerprint: candidate.fingerprint,
      title: `${candidate.title} ghp_123456789012345678901234567890123456`,
    }));
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({ findings: reducerVisibleFindings, visibleFindings: reducerVisibleFindings }),
    });

    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult({ visibleFindings: reducerVisibleFindings }), prDiffText: PR_DIFF });
    const publicJson = JSON.stringify({ findings: adapted.summary.detailsOnlyFindings, movedToDetails: adapted.summary.movedToDetails });

    expect(adapted.payloads).toEqual([]);
    expect(adapted.summary.detailsOnlyFindings).toHaveLength(20);
    expect(adapted.summary.counts).toMatchObject({ movedToDetails: 25, detailsOnlyFindings: 20, detailsOnlyOmitted: 5 });
    expect(adapted.summary.movedToDetails.counts).toMatchObject({ total: 25, fromFixEligibility: 25, omitted: 5 });
    for (const forbidden of ["super-secret", "BEGIN PROMPT", "hidden", "diff --git", rawSecret, "replacement-canary", "ghp_123456789012345678901234567890123456"]) {
      expect(publicJson).not.toContain(forbidden);
    }
  });

  test("creates processed findings only for successful publisher results with numeric comment IDs", () => {
    const candidates = candidateResult([
      candidateInput("src/published.ts", "Published candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/skipped.ts", "Skipped candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/malformed.ts", "Malformed publisher result", { startLine: 30, endLine: 30 }),
    ]);
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
        visibleFindings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
      }),
    });
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF });

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
        body: "Candidate body stays private even when fix eligibility blocks replacement text.",
        fixReplacementText: "safe candidate replacement",
      }),
    ]);
    const reducerVisibleFindings = candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, {
      candidateFingerprint: candidate.fingerprint,
      ...(index === 3 ? { fixReplacementText: "const key = 'AKIA1234567890ABCDEF';" } : {}),
    }));
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: reducerVisibleFindings,
        visibleFindings: reducerVisibleFindings,
      }),
    });
    const adapted = adaptApprovedCandidatesForInlinePublication({
      approval,
      reducer: reducerResult({ visibleFindings: reducerVisibleFindings }),
      prDiffText: PR_DIFF,
    });
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
      options: { shouldPublish?: boolean; prDiffCommentabilityIndex?: PrDiffCommentabilityIndex } = {},
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
        prDiffCommentabilityIndex: options.prDiffCommentabilityIndex,
      });
      return publisher.publish(payload.publication);
    }

    const published = await publishPath("src/published.ts");
    const skipped = await publishPath("src/skipped.ts", { shouldPublish: false });
    const nonCommentable = await publishPath("src/non-commentable.ts", {
      prDiffCommentabilityIndex: buildPrDiffCommentabilityIndex([
        "diff --git a/src/non-commentable.ts b/src/non-commentable.ts",
        "--- a/src/non-commentable.ts",
        "+++ b/src/non-commentable.ts",
        "@@ -1,1 +10,1 @@",
        "+commentable",
      ].join("\n")),
    });

    expect(payloadByPath.has("src/secret.ts")).toBe(false);
    expect(adapted.summary.fixEligibility.reasonCounts["secret-detected"]).toBe(1);
    expect(published.status).toBe("published");
    expect(published.commentId).toBe(9001);
    expect(skipped).toMatchObject({ status: "skipped", reason: "already-published" });
    expect(nonCommentable).toMatchObject({ status: "failed", reason: "line-not-commentable-in-pr-diff" });
    expect(createReviewCommentCalls).toBe(1);
    expect(publishedBodies[0]).not.toContain("@kodiai");
    expect(publishedBodies[0]).toContain("kodiai publishable candidate");

    const converted = convertPublishedCandidateResultsToProcessedFindings({
      payloads: adapted.payloads,
      results: new Map<string, InlineReviewPublicationResult>([
        [payloadByPath.get("src/published.ts")!.candidateFingerprint, published],
        [payloadByPath.get("src/skipped.ts")!.candidateFingerprint, skipped],
        [payloadByPath.get("src/non-commentable.ts")!.candidateFingerprint, nonCommentable],
      ]),
    });

    expect(converted.findings).toHaveLength(1);
    expect(converted.findings[0]).toMatchObject({
      commentId: 9001,
      filePath: "src/published.ts",
      publicationStatus: "published",
    });
    expect(converted.detailsOnlyFindings).toEqual([expect.objectContaining({
      fingerprint: payloadByPath.get("src/non-commentable.ts")!.candidateFingerprint,
      lifecycle: "approved",
      title: "Non commentable candidate",
      location: { path: "src/non-commentable.ts", line: 11 },
      reason: "line-not-commentable-in-pr-diff",
    })]);
    expect(converted.summary.counts).toMatchObject({ input: 3, processed: 1, skipped: 1, blocked: 0, failed: 1, malformed: 0, detailsOnlyFindings: 1, movedToDetails: 1, detailsOnlyOmitted: 0 });
    expect(converted.summary.movedToDetails?.counts).toMatchObject({ total: 1, fromFixEligibility: 0, fromPublisherResult: 1, omitted: 0 });
    expect(converted.summary.results.map((result) => result.reason)).toEqual([
      "published",
      "already-published",
      "line-not-commentable-in-pr-diff",
    ]);
  });

  test("converts publisher results into bounded validation-truth fix evidence", () => {
    const candidates = candidateResult([
      candidateInput("src/published.ts", "Published candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/skipped.ts", "Idempotent candidate", { startLine: 10, endLine: 10 }),
      candidateInput("src/malformed.ts", "Malformed publisher result", { startLine: 30, endLine: 30 }),
      candidateInput("src/non-commentable.ts", "Blocked candidate", { startLine: 11, endLine: 11 }),
    ]);
    const approval = coordinateReviewCandidateApproval({
      candidates,
      reducer: reducerResult({
        findings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
        visibleFindings: candidates.findings.map((candidate, index) => reducerFinding(index + 1, candidate, { candidateFingerprint: candidate.fingerprint })),
      }),
    });
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF });

    const evidence = convertPublishedCandidateResultsToValidationTruthFixes({
      payloads: adapted.payloads,
      results: new Map<string, InlineReviewPublicationResult>([
        [candidates.findings[0]!.fingerprint, { status: "published", commentId: 1234, content: [{ type: "text", text: "{\"private\":true}" }] }],
        [candidates.findings[1]!.fingerprint, { status: "skipped", reason: "already-published", content: [{ type: "text", text: "{}" }] }],
        [candidates.findings[2]!.fingerprint, { status: "published", content: [{ type: "text", text: "{}" }] }],
        [candidates.findings[3]!.fingerprint, { status: "blocked", reason: "m070-candidate-verification-denied", content: [{ type: "text", text: "{}" }] }],
      ]),
      reviewOutputKey: BASE_INPUT.reviewOutputKey,
      deliveryId: BASE_INPUT.deliveryId,
    });

    expect(evidence.map((item) => [item.publicationStatus, item.publicationReason, item.status, item.suggested])).toEqual([
      ["published", "published", "suggested", true],
      ["skipped", "already-published", "suggested", true],
      ["malformed", "missing-comment-id", "degraded", false],
      ["blocked", "m070-candidate-verification-denied", "blocked", false],
    ]);
    expect(evidence[0]?.commentArtifactRef).toBe("comment:1234");
    const publicJson = JSON.stringify(evidence);
    for (const forbidden of ["{\"private\":true}", "Published candidate replacement", "body is safe and grounded", "diff --git"]) {
      expect(publicJson).not.toContain(forbidden);
    }
    expect(evidence.every((item) => item.redaction.privateOnly)).toBe(true);
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
    const adapted = adaptApprovedCandidatesForInlinePublication({ approval, reducer: reducerResult(), prDiffText: PR_DIFF });
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
    fixReplacementText: `${title} replacement`,
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
