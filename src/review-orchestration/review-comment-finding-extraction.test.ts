import { describe, expect, test } from "bun:test";
import {
  extractFindingsFromReviewComments,
  InlineCommentRemovalError,
  removeFilteredInlineComments,
  type ExtractedFinding,
} from "./review-comment-finding-extraction.ts";
import { buildReviewOutputMarker } from "./review-idempotency.ts";

describe("ExtractedFinding shape", () => {
  test("accepts structured inline review comment metadata", () => {
    const finding: ExtractedFinding = {
      commentId: 1,
      filePath: "src/example.ts",
      title: "Missing null check",
      severity: "major",
      category: "correctness",
      startLine: 10,
      endLine: 12,
    };

    expect(finding.commentId).toBe(1);
    expect(finding.severity).toBe("major");
  });
});

describe("extractFindingsFromReviewComments", () => {
  test("scans beyond the first review-comment page for marked findings", async () => {
    const reviewOutputKey = "review-output-page-two";
    const marker = buildReviewOutputMarker(reviewOutputKey);
    const pagesSeen: number[] = [];
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async (params: { page?: number; per_page?: number }) => {
            const page = params.page ?? 1;
            pagesSeen.push(page);
            if (page === 1) {
              return {
                data: Array.from({ length: params.per_page ?? 100 }, (_, index) => ({
                  id: index + 1,
                  path: "src/old.ts",
                  body: "old unmarked comment",
                  line: 10,
                })),
              };
            }
            return {
              data: [{
                id: 250,
                path: "src/example.ts",
                body: [
                  marker,
                  "[major] Missing null check",
                  "",
                  "Finding body.",
                ].join("\n"),
                start_line: 10,
                line: 12,
              }],
            };
          },
        },
      },
    };
    const logger = {
      debug: () => undefined,
      warn: () => undefined,
    };

    const findings = await extractFindingsFromReviewComments({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      reviewOutputKey,
      logger: logger as never,
      baseLog: {},
    });

    expect(pagesSeen).toEqual([1, 2]);
    expect(findings).toEqual([{
      commentId: 250,
      filePath: "src/example.ts",
      title: "Missing null check",
      severity: "major",
      category: "correctness",
      startLine: 10,
      endLine: 12,
    }]);
  });
});

describe("removeFilteredInlineComments", () => {
  test("returns deletion evidence for removed inline comments", async () => {
    const deletedIds: number[] = [];
    const logger = {
      warn: () => undefined,
    };

    const result = await removeFilteredInlineComments({
      octokit: {
        rest: {
          pulls: {
            deleteReviewComment: async (params: { comment_id: number }) => {
              deletedIds.push(params.comment_id);
            },
          },
        },
      } as never,
      owner: "acme",
      repo: "repo",
      findings: [{ commentId: 10 }, { commentId: 10 }, { commentId: 11 }],
      logger: logger as never,
      baseLog: {},
    });

    expect(deletedIds.sort((left, right) => left - right)).toEqual([10, 11]);
    expect(result).toEqual({
      ok: true,
      value: {
        deletedCommentIds: [10, 11],
      },
    });
  });

  test("returns failed deletion evidence while keeping removals fail-open", async () => {
    const warnCalls: Array<[Record<string, unknown>, string]> = [];
    const deletionError = new Error("delete failed");
    const logger = {
      warn: (payload: Record<string, unknown>, message: string) => {
        warnCalls.push([payload, message]);
      },
    };

    const result = await removeFilteredInlineComments({
      octokit: {
        rest: {
          pulls: {
            deleteReviewComment: async (params: { comment_id: number }) => {
              if (params.comment_id === 12) {
                throw deletionError;
              }
            },
          },
        },
      } as never,
      owner: "acme",
      repo: "repo",
      findings: [{ commentId: 11 }, { commentId: 12 }],
      logger: logger as never,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(warnCalls).toEqual([[
      expect.objectContaining({
        deliveryId: "delivery-1",
        gate: "inline-policy-filter",
        commentId: 12,
        err: deletionError,
      }),
      "Failed to delete filtered inline review comment; continuing",
    ]]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBeInstanceOf(InlineCommentRemovalError);
      expect(result.err.deletedCommentIds).toEqual([11]);
      expect(result.err.failures.map((failure) => failure.commentId)).toEqual([12]);
      expect(result.err.message).toContain("1 inline review comment deletion failed");
    }
  });
});
