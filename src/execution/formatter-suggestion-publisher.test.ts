import { describe, expect, test } from "bun:test";
import { buildReviewOutputMarker } from "../handlers/review-idempotency.ts";
import {
  publishFormatterSuggestionReview,
  type FormatterSuggestionPublisherOctokit,
} from "./formatter-suggestion-publisher.ts";
import type { ReviewOutputPublicationGate } from "./mcp/review-output-publication-gate.ts";
import type { FormatterSuggestionPayload } from "./formatter-suggestions.ts";
import type { ReviewOutputPublicationStatus } from "../handlers/review-idempotency.ts";

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

function createFakeScanningOctokit(params: { existingReviewBody?: string }) {
  const createReviewCalls: CreateReviewPayload[] = [];
  const listReviewCommentsCalls: unknown[] = [];
  const listIssueCommentsCalls: unknown[] = [];
  const listReviewsCalls: unknown[] = [];
  const octokit = {
    rest: {
      pulls: {
        createReview: async (payload: CreateReviewPayload) => {
          createReviewCalls.push(payload);
          return { data: { id: 98765, html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-98765" } };
        },
        listReviewComments: async (payload: unknown) => {
          listReviewCommentsCalls.push(payload);
          return { data: [] };
        },
        listReviews: async (payload: unknown) => {
          listReviewsCalls.push(payload);
          return { data: params.existingReviewBody ? [{ body: params.existingReviewBody }] : [] };
        },
      },
      issues: {
        listComments: async (payload: unknown) => {
          listIssueCommentsCalls.push(payload);
          return { data: [] };
        },
      },
    },
  } as unknown as FormatterSuggestionPublisherOctokit;

  return { octokit, createReviewCalls, listReviewCommentsCalls, listIssueCommentsCalls, listReviewsCalls };
}

function makePublicationStatus(overrides: Partial<ReviewOutputPublicationStatus> = {}): ReviewOutputPublicationStatus {
  return {
    reviewOutputKey: "formatter-output-key",
    marker: buildReviewOutputMarker("formatter-output-key"),
    shouldPublish: true,
    publicationState: "publish",
    existingLocation: null,
    idempotencyDecision: "publish",
    scanStats: {
      reviewComments: { scanned: 1, hitCap: false },
      issueComments: { scanned: 2, hitCap: false },
      reviews: { scanned: 3, hitCap: false },
    },
    ...overrides,
  };
}

function createFakePublicationGate(status: ReviewOutputPublicationStatus): {
  gate: ReviewOutputPublicationGate;
  resolveCalls: unknown[];
} {
  const resolveCalls: unknown[] = [];
  return {
    gate: {
      resolve: async (octokit) => {
        resolveCalls.push(octokit);
        return status;
      },
    },
    resolveCalls,
  };
}

function createRejectingPublicationGate(error: unknown): {
  gate: ReviewOutputPublicationGate;
  resolveCalls: unknown[];
} {
  const resolveCalls: unknown[] = [];
  return {
    gate: {
      resolve: async (octokit) => {
        resolveCalls.push(octokit);
        throw error;
      },
    },
    resolveCalls,
  };
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

    const { gate, resolveCalls } = createFakePublicationGate(makePublicationStatus());

    const result = await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      reviewOutputKey: "formatter-output-key",
      suggestions,
      publicationGate: gate,
    });

    expect(resolveCalls).toEqual([octokit]);
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
        publicationState: "publish",
        existingLocation: null,
        idempotencyDecision: "publish",
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

  test("returns no-suggestions without publishing when the suggestion batch is empty", async () => {
    const { octokit, createReviewCalls } = createFakeOctokit();
    const skipped = [
      {
        reason: "target-range-not-in-pr-diff" as const,
        detail: "formatter touched a line outside the PR diff",
        oldPath: "src/example.ts",
        newPath: "src/example.ts",
      },
    ];

    const { gate, resolveCalls } = createRejectingPublicationGate(new Error("empty batches must not resolve the gate"));

    const result = await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      reviewOutputKey: "formatter-output-key",
      suggestions: [],
      skipped,
      publicationGate: gate,
    });

    expect(resolveCalls).toHaveLength(0);
    expect(createReviewCalls).toHaveLength(0);
    expect(result).toMatchObject({
      status: "no-suggestions",
      posted: 0,
      skipped: 1,
      reviewOutput: {
        key: "formatter-output-key",
        marker: buildReviewOutputMarker("formatter-output-key"),
        markerIncluded: false,
      },
      skippedSuggestions: skipped,
    });
  });

  test("skips publication before createReview when the review output gate finds an existing review", async () => {
    const { octokit, createReviewCalls } = createFakeOctokit();
    const { gate, resolveCalls } = createFakePublicationGate(makePublicationStatus({
      shouldPublish: false,
      publicationState: "skip-existing-output",
      existingLocation: "review",
      idempotencyDecision: "skip-existing-review",
    }));

    const result = await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      reviewOutputKey: "formatter-output-key",
      suggestions: [makeSuggestion()],
      publicationGate: gate,
    });

    expect(resolveCalls).toEqual([octokit]);
    expect(createReviewCalls).toHaveLength(0);
    expect(result).toMatchObject({
      status: "skipped",
      posted: 0,
      skipped: 0,
      reviewOutput: {
        key: "formatter-output-key",
        marker: buildReviewOutputMarker("formatter-output-key"),
        markerIncluded: false,
        publicationState: "skip-existing-output",
        existingLocation: "review",
        idempotencyDecision: "skip-existing-review",
      },
      skippedSuggestions: [],
    });
  });

  test("creates the default publication gate and skips when an existing review contains the marker", async () => {
    const { octokit, createReviewCalls, listReviewCommentsCalls, listIssueCommentsCalls, listReviewsCalls } =
      createFakeScanningOctokit({ existingReviewBody: `Already posted\n\n${buildReviewOutputMarker("formatter-output-key")}` });

    const result = await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      reviewOutputKey: "formatter-output-key",
      suggestions: [makeSuggestion()],
    });

    expect(createReviewCalls).toHaveLength(0);
    expect(listReviewCommentsCalls).toHaveLength(1);
    expect(listIssueCommentsCalls).toHaveLength(1);
    expect(listReviewsCalls).toHaveLength(1);
    expect(result).toMatchObject({
      status: "skipped",
      posted: 0,
      reviewOutput: {
        key: "formatter-output-key",
        markerIncluded: false,
        publicationState: "skip-existing-output",
        existingLocation: "review",
        idempotencyDecision: "skip-existing-review",
      },
    });
  });

  test("returns failed without createReview when the review output gate rejects", async () => {
    const { octokit, createReviewCalls } = createFakeOctokit();
    const { gate, resolveCalls } = createRejectingPublicationGate(new Error("GitHub scan failed with token ghp_secret"));

    const result = await publishFormatterSuggestionReview({
      octokit,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitId: "abc123def456",
      reviewOutputKey: "formatter-output-key",
      suggestions: [makeSuggestion()],
      publicationGate: gate,
    });

    expect(resolveCalls).toEqual([octokit]);
    expect(createReviewCalls).toHaveLength(0);
    expect(result).toMatchObject({
      status: "failed",
      posted: 0,
      skipped: 0,
      reviewOutput: {
        key: "formatter-output-key",
        marker: buildReviewOutputMarker("formatter-output-key"),
        markerIncluded: false,
      },
      skippedSuggestions: [],
    });
    expect(result.error).toContain("GitHub scan failed");
    expect(result.error).not.toContain("ghp_secret");
  });
});
