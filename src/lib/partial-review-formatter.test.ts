import { describe, expect, test } from "bun:test";
import { formatPartialReviewComment } from "./partial-review-formatter.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";

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

describe("formatPartialReviewComment", () => {
  test("bounded timeout disclaimer shows normalized reason, evidence, and coverage", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      firstPass: TIMEOUT_FIRST_PASS,
      timedOutAfterSeconds: 90,
    });

    expect(out).toBe(
      [
        "> **Bounded first-pass review** -- stopped at timeout after covering 4 of 12 files from checkpoint evidence (8 remaining; 90s).",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("max-turns disclaimer uses the same bounded-first-pass contract", () => {
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
        "> **Bounded first-pass review** -- stopped at max-turns after covering 4 of 12 files from boundedness evidence (8 remaining).",
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
        "> **Bounded first-pass review** -- stopped at timeout after covering 4 of 12 files from checkpoint evidence (8 remaining; 90s).",
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
        "> **Bounded first-pass review** -- stopped at timeout after covering 2 of 10 files from checkpoint evidence (8 remaining; 60s).",
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
        "> **Bounded first-pass review** -- stopped at timeout after covering 0 of 1 files from checkpoint evidence (1 remaining; 30s).",
        "",
        "",
      ].join("\n"),
    );
  });
});
