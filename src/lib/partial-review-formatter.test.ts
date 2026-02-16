import { describe, expect, test } from "bun:test";
import { formatPartialReviewComment } from "./partial-review-formatter.ts";

describe("formatPartialReviewComment", () => {
  test("standard timeout disclaimer shows correct counts and duration", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      filesReviewed: 4,
      totalFiles: 12,
      timedOutAfterSeconds: 90,
    });

    expect(out).toBe(
      [
        "> **Partial review** -- timed out after analyzing 4 of 12 files (90s).",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("retry result disclaimer shows merged file count and by-risk label", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      filesReviewed: 4,
      totalFiles: 12,
      timedOutAfterSeconds: 90,
      isRetryResult: true,
      retryFilesReviewed: 3,
    });

    expect(out).toBe(
      [
        "> **Partial review** -- Analyzed 7 of 12 files. Reviewed top 3 files by risk in retry.",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("retry-skipped disclaimer includes reason and splitting guidance", () => {
    const out = formatPartialReviewComment({
      summaryDraft: "Body",
      filesReviewed: 2,
      totalFiles: 10,
      timedOutAfterSeconds: 60,
      isRetrySkipped: true,
      retrySkipReason: "Retry skipped -- this repo has timed out frequently",
    });

    expect(out).toBe(
      [
        "> **Partial review** -- timed out after analyzing 2 of 10 files (60s).",
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
      filesReviewed: 0,
      totalFiles: 1,
      timedOutAfterSeconds: 30,
    });

    expect(out).toBe(
      [
        "> **Partial review** -- timed out after analyzing 0 of 1 files (30s).",
        "",
        "",
      ].join("\n"),
    );
  });
});
