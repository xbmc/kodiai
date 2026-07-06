import { describe, expect, test } from "bun:test";
import {
  extractFindingsFromReviewComments,
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
