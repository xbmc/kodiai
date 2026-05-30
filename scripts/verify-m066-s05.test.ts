import { describe, expect, test } from "bun:test";
import { buildReviewOutputKey, buildReviewOutputMarker } from "../src/review-orchestration/review-idempotency.ts";

function makeReviewOutputKey(overrides?: Partial<{
  owner: string;
  repo: string;
  prNumber: number;
  action: string;
  deliveryId: string;
  headSha: string;
}>) {
  return buildReviewOutputKey({
    installationId: 42,
    owner: overrides?.owner ?? "xbmc",
    repo: overrides?.repo ?? "kodiai",
    prNumber: overrides?.prNumber ?? 101,
    action: overrides?.action ?? "mention-format-suggestions",
    deliveryId: overrides?.deliveryId ?? "delivery-101",
    headSha: overrides?.headSha ?? "head-101",
  });
}

type ReviewFixture = {
  id?: number;
  body?: string | null;
  state?: string | null;
  html_url?: string | null;
  pull_request_url?: string | null;
  submitted_at?: string | null;
};

type ReviewCommentFixture = {
  id?: number;
  body?: string | null;
  html_url?: string | null;
  pull_request_review_id?: number | null;
  updated_at?: string | null;
};

type CollectionOverrides = {
  prUrl?: string;
  reviews?: ReviewFixture[];
  reviewComments?: ReviewCommentFixture[];
};

type CollectionFixture = {
  prUrl: string;
  reviews: ReviewFixture[];
  reviewComments: ReviewCommentFixture[];
};

type JsonReport = {
  command: "verify:m066:s05";
  generated_at: string;
  repo: string | null;
  review_output_key: string | null;
  delivery_id: string | null;
  success: boolean;
  status_code: string;
  preflight: {
    githubAccess: "available" | "missing" | "unavailable";
  };
  proof: {
    pr_number: number | null;
    pr_url: string | null;
    review_id: number | null;
    review_url: string | null;
    first_suggestion_comment_id: number | null;
    first_suggestion_comment_url: string | null;
    matched_review_output_key: string | null;
  };
  artifactCounts: {
    reviews: number;
    matchingReviews: number;
    reviewComments: number;
    matchingSuggestionComments: number;
  };
  issues: string[];
};

function markerBody(reviewOutputKey = makeReviewOutputKey()) {
  return [
    "Formatter suggestions are ready.",
    "",
    buildReviewOutputMarker(reviewOutputKey),
  ].join("\n");
}

function suggestionBody() {
  return [
    "Use this patch:",
    "",
    "```suggestion",
    "const value = format(input);",
    "```",
  ].join("\n");
}

function makeCollection(overrides?: CollectionOverrides): CollectionFixture {
  return {
    prUrl: overrides?.prUrl ?? "https://github.com/xbmc/kodiai/pull/101",
    reviews: overrides?.reviews ?? [{
      id: 7001,
      body: markerBody(),
      state: "COMMENTED",
      html_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7001",
      pull_request_url: "https://api.github.com/repos/xbmc/kodiai/pulls/101",
      submitted_at: "2026-05-04T18:00:00.000Z",
    }],
    reviewComments: overrides?.reviewComments ?? [{
      id: 9001,
      body: suggestionBody(),
      html_url: "https://github.com/xbmc/kodiai/pull/101#discussion_r9001",
      pull_request_review_id: 7001,
      updated_at: "2026-05-04T18:01:00.000Z",
    }],
  };
}

async function loadModule() {
  return await import("./verify-m066-s05.ts");
}

describe("verify-m066-s05", () => {
  test("parse args accepts repo, review-output-key, optional delivery-id, json, and help", async () => {
    const { parseVerifyM066S05Args } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    expect(parseVerifyM066S05Args([
      "--repo",
      "xbmc/kodiai",
      "--review-output-key",
      reviewOutputKey,
      "--delivery-id",
      "delivery-101",
      "--json",
    ])).toEqual({
      help: false,
      json: true,
      repo: "xbmc/kodiai",
      reviewOutputKey,
      deliveryId: "delivery-101",
      invalidArg: null,
    });

    expect(parseVerifyM066S05Args(["--help"]).help).toBe(true);
  });

  test("main rejects missing review-output-key, malformed key, wrong action, delivery mismatch, and repo mismatch before live lookup", async () => {
    const { main } = await loadModule();
    const cases: Array<{ args: string[]; issue: string }> = [
      { args: ["--repo", "xbmc/kodiai", "--json"], issue: "Missing required --review-output-key." },
      { args: ["--repo", "xbmc/kodiai", "--review-output-key", "not-a-key", "--json"], issue: "Malformed --review-output-key." },
      { args: ["--repo", "xbmc/kodiai", "--review-output-key", makeReviewOutputKey({ action: "mention-review" }), "--json"], issue: "--review-output-key must encode the mention-format-suggestions action." },
      { args: ["--repo", "xbmc/kodiai", "--review-output-key", makeReviewOutputKey(), "--delivery-id", "delivery-999", "--json"], issue: "Provided --delivery-id does not match the delivery id encoded in --review-output-key." },
      { args: ["--repo", "other/repo", "--review-output-key", makeReviewOutputKey(), "--json"], issue: "Provided --repo does not match the repository encoded in --review-output-key." },
    ];

    for (const testCase of cases) {
      const stdoutChunks: string[] = [];
      const exitCode = await main(testCase.args, {
        stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
        stderr: { write: () => undefined },
        collectProof: async () => {
          throw new Error("should not be called");
        },
      });
      const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
      expect(exitCode).toBe(1);
      expect(report.status_code).toBe("m066_s05_invalid_arg");
      expect(report.issues).toContain(testCase.issue);
    }
  });

  test("evaluate reports missing GitHub access without printing secret values or collecting artifacts", async () => {
    const { evaluateM066S05 } = await loadModule();

    const report = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey: makeReviewOutputKey(),
      generatedAt: "2026-05-04T18:05:00.000Z",
      githubAccess: "missing",
      collectProof: async () => {
        throw new Error("should not be called");
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m066_s05_missing_github_access");
    expect(report.preflight.githubAccess).toBe("missing");
    expect(report.issues.join("\n")).not.toContain("PRIVATE KEY");
    expect(report.issues.join("\n")).not.toContain("GITHUB_PRIVATE_KEY=");
  });

  test("evaluate succeeds for exactly one COMMENTED PR review marker with an associated suggestion-fenced review comment", async () => {
    const { evaluateM066S05, renderM066S05Report } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const report = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      deliveryId: "delivery-101",
      generatedAt: "2026-05-04T18:10:00.000Z",
      githubAccess: "available",
      collectProof: async () => makeCollection(),
    });

    expect(report).toMatchObject({
      command: "verify:m066:s05",
      generated_at: "2026-05-04T18:10:00.000Z",
      repo: "xbmc/kodiai",
      review_output_key: reviewOutputKey,
      delivery_id: "delivery-101",
      success: true,
      status_code: "m066_s05_ok",
      preflight: { githubAccess: "available" },
      proof: {
        pr_number: 101,
        pr_url: "https://github.com/xbmc/kodiai/pull/101",
        review_id: 7001,
        review_url: "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7001",
        first_suggestion_comment_id: 9001,
        first_suggestion_comment_url: "https://github.com/xbmc/kodiai/pull/101#discussion_r9001",
        matched_review_output_key: reviewOutputKey,
      },
      artifactCounts: {
        reviews: 1,
        matchingReviews: 1,
        reviewComments: 1,
        matchingSuggestionComments: 1,
      },
      issues: [],
    } satisfies Partial<JsonReport>);

    const human = renderM066S05Report(report);
    expect(human).toContain("Status: m066_s05_ok");
    expect(human).toContain("Review URL: https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7001");
    expect(human).toContain("First suggestion comment URL: https://github.com/xbmc/kodiai/pull/101#discussion_r9001");
  });

  test("evaluate fails closed for duplicate matching reviews, wrong review state, issue-comment-only surfaces, and missing suggestion fences", async () => {
    const { evaluateM066S05 } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const duplicate = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      githubAccess: "available",
      collectProof: async () => makeCollection({
        reviews: [
          { id: 7001, body: markerBody(reviewOutputKey), state: "COMMENTED", html_url: "review-1" },
          { id: 7002, body: markerBody(reviewOutputKey), state: "COMMENTED", html_url: "review-2" },
        ],
      }),
    });
    const wrongState = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      githubAccess: "available",
      collectProof: async () => makeCollection({ reviews: [{ id: 7001, body: markerBody(reviewOutputKey), state: "APPROVED", html_url: "review-1" }] }),
    });
    const issueOnly = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      githubAccess: "available",
      collectProof: async () => makeCollection({ reviews: [], reviewComments: [] }),
    });
    const noSuggestion = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      githubAccess: "available",
      collectProof: async () => makeCollection({
        reviewComments: [{ id: 9001, body: "regular comment", html_url: "comment-1", pull_request_review_id: 7001 }],
      }),
    });

    expect(duplicate.status_code).toBe("m066_s05_duplicate_reviews");
    expect(wrongState.status_code).toBe("m066_s05_wrong_review_state");
    expect(issueOnly.status_code).toBe("m066_s05_no_matching_review");
    expect(noSuggestion.status_code).toBe("m066_s05_no_suggestion_comment");
    expect(noSuggestion.issues).toContain("No associated review comment for the matching review contains a fenced ```suggestion block.");
  });

  test("evaluate treats malformed API data and GitHub API failures as named bounded failures", async () => {
    const { evaluateM066S05 } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const malformed = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      githubAccess: "available",
      collectProof: async () => makeCollection({ reviews: [{ body: markerBody(reviewOutputKey), state: "COMMENTED", html_url: "review-1" }] }),
    });

    const unavailable = await evaluateM066S05({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      githubAccess: "available",
      collectProof: async () => {
        throw new Error("GitHub exploded with a very long diagnostic ".repeat(20));
      },
    });

    expect(malformed.status_code).toBe("m066_s05_malformed_github_data");
    expect(malformed.issues).toContain("Matching review is missing numeric id.");
    expect(unavailable.status_code).toBe("m066_s05_github_unavailable");
    expect(unavailable.issues.join("\n").length).toBeLessThan(500);
  });

  test("main emits json output and package.json wires verify:m066:s05 to the verifier script", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--repo", "xbmc/kodiai", "--review-output-key", makeReviewOutputKey(), "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
      githubAccess: "available",
      collectProof: async () => makeCollection(),
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(0);
    expect(report.command).toBe("verify:m066:s05");
    expect(report.status_code).toBe("m066_s05_ok");

    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["verify:m066:s05"]).toBe("bun scripts/verify-m066-s05.ts");
  });
});
