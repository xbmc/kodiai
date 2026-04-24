import { describe, expect, test } from "bun:test";
import { formatPartialReviewComment } from "./partial-review-formatter.ts";
import { formatReviewDetailsSummary } from "./review-utils.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { projectContributorExperienceContract } from "../contributor/experience-contract.ts";

const TIMEOUT_FIRST_PASS: ReviewFirstPassPayload = {
  state: "bounded-first-pass",
  boundedReason: "timeout",
  evidenceSource: "checkpoint",
  coveredScope: { reviewedFiles: 4, totalFiles: 12 },
  remainingScope: { remainingFiles: 8, totalFiles: 12 },
  findingCount: 2,
  publication: { eligible: true, hasPublishedOutput: false },
  continuationPending: true,
  zeroEvidenceFailure: false,
};

const REVIEW_DETAILS_BASE_PARAMS = {
  reviewOutputKey: "test-key-001",
  filesReviewed: 3,
  linesAdded: 50,
  linesRemoved: 10,
  findingCounts: { critical: 0, major: 1, medium: 2, minor: 0 },
  profileSelection: {
    selectedProfile: "balanced" as const,
    source: "auto" as const,
    linesChanged: 60,
    autoBand: null,
  },
  contributorExperience: projectContributorExperienceContract({
    source: "author-cache",
    tier: "regular",
  }).reviewDetails,
};

describe("formatPartialReviewComment", () => {
  test("bounded timeout disclaimer shows normalized reason, evidence, coverage, and continuation state", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: TIMEOUT_FIRST_PASS,
      timedOutAfterSeconds: 90,
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at timeout after covering 4 of 12 files from checkpoint evidence; 8 of 12 files remain unreviewed; follow-up review is pending (90s timeout).",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("max-turns disclaimer uses the same bounded-first-pass continuation contract", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: {
        ...TIMEOUT_FIRST_PASS,
        boundedReason: "max-turns",
        evidenceSource: "boundedness",
      },
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at max-turns after covering 4 of 12 files from boundedness evidence; 8 of 12 files remain unreviewed; follow-up review is pending.",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("retry result disclaimer keeps normalized coverage and merged retry count", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: TIMEOUT_FIRST_PASS,
      timedOutAfterSeconds: 90,
      isRetryResult: true,
      retryFilesReviewed: 3,
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at timeout after covering 4 of 12 files from checkpoint evidence; 8 of 12 files remain unreviewed; follow-up review is pending (90s timeout).",
        ">",
        "> Retry complete -- analyzed 7 of 12 files total after a reduced-scope follow-up.",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("retry-skipped disclaimer includes the reason and splitting guidance", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: {
        ...TIMEOUT_FIRST_PASS,
        coveredScope: { reviewedFiles: 2, totalFiles: 10 },
        remainingScope: { remainingFiles: 8, totalFiles: 10 },
      },
      timedOutAfterSeconds: 60,
      isRetrySkipped: true,
      retrySkipReason: "Retry skipped -- this repo has timed out frequently",
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at timeout after covering 2 of 10 files from checkpoint evidence; 8 of 10 files remain unreviewed; follow-up review is pending (60s timeout).",
        ">",
        "> Retry skipped -- this repo has timed out frequently",
        "> Consider splitting large PRs to stay within the review timeout budget.",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("empty summaryDraft still produces valid output", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "",
      firstPass: {
        ...TIMEOUT_FIRST_PASS,
        coveredScope: { reviewedFiles: 0, totalFiles: 1 },
        remainingScope: { remainingFiles: 1, totalFiles: 1 },
      },
      timedOutAfterSeconds: 30,
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at timeout after covering 0 of 1 files from checkpoint evidence; 1 of 1 files remain unreviewed; follow-up review is pending (30s timeout).",
        "",
        "",
      ].join("\n"),
    );
  });

  test("missing remaining scope states that continuation is still pending without implying exhaustive review", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: {
        ...TIMEOUT_FIRST_PASS,
        remainingScope: undefined,
        continuationPending: true,
      },
      timedOutAfterSeconds: 90,
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at timeout after covering 4 of 12 files from checkpoint evidence; remaining scope is not confirmed from structured evidence; follow-up review is pending (90s timeout).",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("Review Details and bounded comment tell the same timeout coverage and continuation story", () => {
    const comment = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: TIMEOUT_FIRST_PASS,
      timedOutAfterSeconds: 90,
      isRetrySkipped: true,
      retrySkipReason: "Retry skipped -- this repo has timed out frequently",
    });
    const details = formatReviewDetailsSummary({
      ...REVIEW_DETAILS_BASE_PARAMS,
      reviewFirstPass: TIMEOUT_FIRST_PASS,
      timeoutProgress: {
        analyzedFiles: 4,
        totalFiles: 12,
        findingCount: 2,
        retryState: "Retry skipped -- this repo has timed out frequently",
      },
    });

    expect(comment).toContain(
      "stopped at timeout after covering 4 of 12 files from checkpoint evidence; 8 of 12 files remain unreviewed; follow-up review is pending (90s timeout).",
    );
    expect(details).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(details).toContain("- Covered scope: 4/12 changed files");
    expect(details).toContain("- Remaining scope: 8/12 changed files");
    expect(details).toContain("- Continuation state: follow-up review pending for remaining scope");
    expect(details).toContain("- Retry state: Retry skipped -- this repo has timed out frequently");
  });

  test("Review Details and bounded comment both degrade truthfully when timeout scope is malformed", () => {
    const malformedFirstPass: ReviewFirstPassPayload = {
      ...TIMEOUT_FIRST_PASS,
      coveredScope: undefined,
      remainingScope: undefined,
      continuationPending: true,
    };
    const comment = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: malformedFirstPass,
      timedOutAfterSeconds: 90,
    });
    const details = formatReviewDetailsSummary({
      ...REVIEW_DETAILS_BASE_PARAMS,
      reviewFirstPass: malformedFirstPass,
      timeoutProgress: {
        analyzedFiles: 4,
        totalFiles: 12,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
    });

    expect(comment).toContain(
      "stopped at timeout using checkpoint evidence; remaining scope is not confirmed from structured evidence; follow-up review is pending (90s timeout).",
    );
    expect(details).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(details).toContain("- Remaining scope: not confirmed from structured evidence");
    expect(details).toContain("- Continuation state: follow-up review pending; remaining scope still unconfirmed");
    expect(details).not.toContain("- Covered scope:");
  });
});
