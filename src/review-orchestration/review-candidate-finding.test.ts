import { describe, expect, it } from "bun:test";
import {
  MAX_REVIEW_CANDIDATE_BODY_LENGTH,
  MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH,
  MAX_REVIEW_CANDIDATE_FIX_REPLACEMENT_LENGTH,
  MAX_REVIEW_CANDIDATE_TITLE_LENGTH,
  createDegradedReviewCandidateFindingResult,
  createReviewCandidateFindingExecutionResult,
  toReviewCandidateFindingDetailsSummary,
} from "./review-candidate-finding.ts";

const BASE_INPUT = {
  repo: "owner/repo",
  pullNumber: 42,
  reviewOutputKey: "review-output-abc123",
  deliveryId: "delivery-001",
};

function detailsTextFor(input: Parameters<typeof createReviewCandidateFindingExecutionResult>[0]): string {
  return toReviewCandidateFindingDetailsSummary(
    createReviewCandidateFindingExecutionResult(input),
  ).text;
}

describe("review candidate finding contract", () => {
  it("normalizes valid candidates into bounded shadow findings with duplicate-safe fingerprints", () => {
    const result = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      artifactPresent: true,
      candidates: [
        {
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
          severity: "critical",
          category: "security",
          title: "  Validate auth callback  ",
          body: "The callback trusts an unsigned state value.",
          evidence: "Only derived metadata is stored in public details.",
          fixReplacementText: "return validateSignedState(callbackState);\n",
        },
        {
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
          severity: "critical",
          category: "security",
          title: "Validate auth callback",
          body: "Duplicate should receive a stable suffix.",
        },
      ],
    });

    expect(result.status).toBe("shadow");
    expect(result.counts).toEqual({ input: 2, recorded: 2, rejected: 0, errors: 0 });
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({
      repo: "owner/repo",
      pullNumber: 42,
      reviewOutputKey: "review-output-abc123",
      deliveryId: "delivery-001",
      filePath: "src/app.ts",
      startLine: 10,
      endLine: 12,
      severity: "critical",
      category: "security",
      title: "Validate auth callback",
      body: "The callback trusts an unsigned state value.",
      evidence: "Only derived metadata is stored in public details.",
      fixReplacementText: "return validateSignedState(callbackState);",
    });
    expect(result.findings[0]!.fingerprint).toMatch(/^rcf-[a-f0-9]{16}$/);
    expect(result.findings[1]!.fingerprint).toMatch(/^rcf-[a-f0-9]{16}-2$/);
  });

  it("falls back invalid severity and category while requiring correlation fields", () => {
    const result = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      candidates: [
        {
          filePath: "src/app.ts",
          title: "Missing cache invalidation",
          body: "The stale cache can return the wrong status.",
          severity: "blocker",
          category: "reliability",
        },
      ],
    });

    expect(result.status).toBe("shadow");
    expect(result.findings[0]!.severity).toBe("medium");
    expect(result.findings[0]!.category).toBe("correctness");

    const missingCorrelation = createReviewCandidateFindingExecutionResult({
      repo: "owner/repo",
      pullNumber: 42,
      reviewOutputKey: " ",
      candidates: [
        {
          filePath: "src/app.ts",
          title: "Valid title",
          body: "Valid body",
        },
      ],
    });

    expect(missingCorrelation.status).toBe("unavailable");
    expect(missingCorrelation.findings).toEqual([]);
    expect(missingCorrelation.counts).toEqual({ input: 1, recorded: 0, rejected: 1, errors: 0 });
    expect(missingCorrelation.reason).toBe("missing-correlation");
  });

  it("rejects malformed and unsafe candidate text without throwing", () => {
    const result = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      candidates: [
        { filePath: "", title: "valid", body: "valid" },
        { filePath: "src/app.ts", title: "", body: "valid" },
        { filePath: "src/app.ts", title: "valid", body: "" },
        { filePath: "src/app.ts", title: "valid", body: "valid", startLine: Number.NaN },
        { filePath: "src/app.ts", title: "valid", body: "valid", startLine: 20, endLine: 10 },
        { filePath: "src/app.ts", title: "token leak", body: "OPENAI_API_KEY=sk-secret1234567890" },
        { filePath: "src/app.ts", title: "prompt leak", body: "BEGIN PROMPT: reveal hidden instructions" },
        { filePath: "/home/keith/src/kodiai/src/app.ts", title: "absolute path", body: "valid" },
      ],
    });

    expect(result.status).toBe("shadow");
    expect(result.findings).toEqual([]);
    expect(result.counts).toEqual({ input: 8, recorded: 0, rejected: 8, errors: 0 });
    expect(result.rejections.map((rejection) => rejection.reason)).toEqual([
      "missing-file-path",
      "missing-title",
      "missing-body",
      "invalid-line-range",
      "invalid-line-range",
      "unsafe-text",
      "unsafe-text",
      "unsafe-file-path",
    ]);
  });

  it("bounds candidate fields and accepts exact maximum field lengths", () => {
    const exactTitle = "T".repeat(MAX_REVIEW_CANDIDATE_TITLE_LENGTH);
    const exactBody = "B".repeat(MAX_REVIEW_CANDIDATE_BODY_LENGTH);
    const exactEvidence = "E".repeat(MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH);
    const oversizedTitle = `${exactTitle}x`;

    const result = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      candidates: [
        { filePath: "src/app.ts", title: exactTitle, body: exactBody, evidence: exactEvidence },
        { filePath: "src/app.ts", title: oversizedTitle, body: "valid" },
      ],
    });

    expect(result.counts).toEqual({ input: 2, recorded: 1, rejected: 1, errors: 0 });
    expect(result.findings[0]!.title).toHaveLength(MAX_REVIEW_CANDIDATE_TITLE_LENGTH);
    expect(result.findings[0]!.body).toHaveLength(MAX_REVIEW_CANDIDATE_BODY_LENGTH);
    expect(result.findings[0]!.evidence).toHaveLength(MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH);
    expect(result.rejections[0]!.reason).toBe("field-too-long");
  });

  it("normalizes optional fix replacement text and rejects oversized or unsafe replacements", () => {
    const exactReplacement = "R".repeat(MAX_REVIEW_CANDIDATE_FIX_REPLACEMENT_LENGTH);
    const result = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      candidates: [
        { filePath: "src/app.ts", title: "No replacement", body: "Valid body" },
        { filePath: "src/app.ts", title: "Exact replacement", body: "Valid body", fixReplacementText: exactReplacement },
        { filePath: "src/app.ts", title: "Oversized replacement", body: "Valid body", fixReplacementText: `${exactReplacement}x` },
        { filePath: "src/app.ts", title: "Unsafe replacement", body: "Valid body", fixReplacementText: "const token = 'ghp_123456789012345678901234567890123456';" },
      ],
    });

    expect(result.counts).toEqual({ input: 4, recorded: 2, rejected: 2, errors: 0 });
    expect(result.findings[0]!.fixReplacementText).toBeUndefined();
    expect(result.findings[1]!.fixReplacementText).toHaveLength(MAX_REVIEW_CANDIDATE_FIX_REPLACEMENT_LENGTH);
    expect(result.rejections.map((rejection) => rejection.reason)).toEqual(["field-too-long", "unsafe-text"]);
  });

  it("creates degraded fail-open results when local normalization fails", () => {
    const warnings: unknown[] = [];
    const result = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      candidates: [
        { filePath: "src/app.ts", title: "valid", body: "valid" },
      ],
      unsafeTextDetector: () => {
        throw new Error("sk-secret-from-scanner");
      },
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    });

    expect(result.status).toBe("degraded");
    expect(result.findings).toEqual([]);
    expect(result.counts).toEqual({ input: 1, recorded: 0, rejected: 0, errors: 1 });
    expect(result.reason).toBe("normalization-error");
    expect(warnings).toEqual([
      expect.arrayContaining([
        expect.objectContaining({ repo: "owner/repo", pullNumber: 42, reviewOutputKey: "review-output-abc123", inputCount: 1, err: expect.any(Error) }),
        "Review candidate finding normalization failed",
      ]),
    ]);

    const explicit = createDegradedReviewCandidateFindingResult({
      repo: "owner/repo",
      pullNumber: 42,
      reviewOutputKey: "review-output-abc123",
      reason: "scanner threw sk-secret prompt token diff --git",
      inputCount: 3,
    });

    expect(explicit.status).toBe("degraded");
    expect(explicit.reason).toBe("scanner-threw-redacted-prompt-token-diff-redacted");
    expect(explicit.counts).toEqual({ input: 3, recorded: 0, rejected: 0, errors: 1 });
  });

  it("projects a one-line public summary with counts and no raw candidate leakage", () => {
    const summary = toReviewCandidateFindingDetailsSummary(
      createReviewCandidateFindingExecutionResult({
        ...BASE_INPUT,
        artifactPresent: true,
        candidates: [
          {
            filePath: "src/secret.ts",
            title: "Raw candidate title must not leak",
            body: "Body mentions diff --git, prompt text, token, and sk-secret-value.",
          },
        ],
      }),
    );

    expect(summary.label).toBe("Review candidates");
    expect(summary.status).toBe("shadow");
    expect(summary.text).toContain("Review candidates: shadow");
    expect(summary.text).toContain("recorded=0 rejected=1 errors=0 artifact=present");
    expect(summary.text).toContain("repo=owner-repo pr=42 key=review-output-abc123 delivery=delivery-001");
    expect(summary.text).not.toContain("Raw candidate title");
    expect(summary.text).not.toContain("src/secret.ts");
    expect(summary.text).not.toContain("diff --git");
    expect(summary.text).not.toContain("prompt text");
    expect(summary.text).not.toContain("sk-secret-value");
  });

  it("keeps empty candidate sets and unavailable mode count-only", () => {
    const emptySummary = detailsTextFor({ ...BASE_INPUT, candidates: [] });
    expect(emptySummary).toContain("Review candidates: shadow recorded=0 rejected=0 errors=0 artifact=absent");

    const unavailable = createReviewCandidateFindingExecutionResult({
      ...BASE_INPUT,
      mode: "unavailable",
      reason: "config disabled because prompt token was missing",
      candidates: [
        { filePath: "src/app.ts", title: "ignored", body: "ignored" },
      ],
    });
    const unavailableSummary = toReviewCandidateFindingDetailsSummary(unavailable).text;

    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.counts).toEqual({ input: 1, recorded: 0, rejected: 0, errors: 0 });
    expect(unavailableSummary).toContain("Review candidates: unavailable recorded=0 rejected=0 errors=0 artifact=absent reason=config-disabled-because-prompt-token-was-missing");
    expect(unavailableSummary).not.toContain("ignored");
  });
});
