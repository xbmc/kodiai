import { describe, expect, test } from "bun:test";
import { buildReviewOutputMarker } from "../handlers/review-idempotency.ts";
import {
  publishFormatterSuggestionReview,
  type FormatterSuggestionPublisherOctokit,
} from "./formatter-suggestion-publisher.ts";
import type { FormatterSuggestionPayload } from "./formatter-suggestions.ts";

type CreateReviewPayload = Parameters<FormatterSuggestionPublisherOctokit["rest"]["pulls"]["createReview"]>[0];

function makeSuggestion(overrides: Partial<FormatterSuggestionPayload> = {}): FormatterSuggestionPayload {
  return {
    path: "src/example.ts",
    line: 12,
    side: "RIGHT",
    suggestionBody: "```suggestion\nconst value = 1;\n```",
    oldStart: 12,
    oldEnd: 12,
    newStart: 12,
    hunkHeader: "@@ -12 +12 @@",
    ...overrides,
  };
}

function createFakeOctokit() {
  const createReviewCalls: CreateReviewPayload[] = [];
  const octokit: FormatterSuggestionPublisherOctokit = {
    rest: {
      pulls: {
        createReview: async (payload: CreateReviewPayload) => {
          createReviewCalls.push(payload);
          return { data: { id: 98765, html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-98765" } };
        },
      },
    },
  };

  return { octokit, createReviewCalls };
}

describe("publishFormatterSuggestionReview", () => {
  test("publishes one COMMENT review with batched single-line and multi-line formatter suggestions", async () => {
    const { octokit, createReviewCalls } = createFakeOctokit();
    const suggestions: FormatterSuggestionPayload[] = [
      makeSuggestion({
        path: "src/single.ts",
        line: 8,
        suggestionBody: "```suggestion\nconst single = true;\n```",
        oldStart: 8,
        oldEnd: 8,
        newStart: 8,
        hunkHeader: "@@ -8 +8 @@",
      }),
      makeSuggestion({
        path: "src/multi.ts",
        line: 23,
        startLine: 21,
        suggestionBody: "```suggestion\nfunction demo() {\n  return true;\n}\n```",
        oldStart: 21,
        oldEnd: 23,
        newStart: 21,
        hunkHeader: "@@ -21,3 +21,3 @@",
      }),
    ];

    const result = await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      reviewOutputKey: "formatter-output-key",
      suggestions,
    });

    expect(createReviewCalls).toHaveLength(1);
    expect(createReviewCalls[0]).toMatchObject({
      owner: "acme",
      repo: "widgets",
      pull_number: 42,
      commit_id: "abc123def456",
      event: "COMMENT",
    });
    expect(createReviewCalls[0]?.body).toContain("Kodiai formatter suggestions");
    expect(createReviewCalls[0]?.body).toContain(buildReviewOutputMarker("formatter-output-key"));
    expect(createReviewCalls[0]?.comments).toEqual([
      {
        path: "src/single.ts",
        line: 8,
        side: "RIGHT",
        body: "```suggestion\nconst single = true;\n```",
      },
      {
        path: "src/multi.ts",
        line: 23,
        side: "RIGHT",
        start_line: 21,
        start_side: "RIGHT",
        body: "```suggestion\nfunction demo() {\n  return true;\n}\n```",
      },
    ]);
    expect(result).toMatchObject({
      status: "posted",
      posted: 2,
      skipped: 0,
      review: {
        id: 98765,
        url: "https://github.com/acme/widgets/pull/42#pullrequestreview-98765",
      },
      reviewOutput: {
        key: "formatter-output-key",
        marker: buildReviewOutputMarker("formatter-output-key"),
        markerIncluded: true,
      },
    });
  });

  test("omits the review output marker when no reviewOutputKey is provided", async () => {
    const { octokit, createReviewCalls } = createFakeOctokit();

    await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      suggestions: [makeSuggestion()],
    });

    expect(createReviewCalls).toHaveLength(1);
    expect(createReviewCalls[0]?.body).not.toContain("kodiai:review-output-key");
  });
});
