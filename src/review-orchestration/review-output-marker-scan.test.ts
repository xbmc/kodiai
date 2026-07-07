import { describe, expect, test } from "bun:test";
import { scanReviewOutputMarkers } from "./review-output-marker-scan.ts";

describe("scanReviewOutputMarkers", () => {
  test("scans review comments, issue comments, and pull reviews with retry-bound pagination", async () => {
    const marker = "<!-- kodiai:review-output-key:test -->";
    const calls = {
      reviewComments: 0,
      issueComments: 0,
      reviews: 0,
    };
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => {
            calls.reviewComments += 1;
            if (calls.reviewComments === 1) {
              const error = new Error("temporary unavailable") as Error & { status?: number };
              error.status = 502;
              throw error;
            }
            return { data: [{ id: 1, body: `inline\n${marker}` }] };
          },
          listReviews: async () => {
            calls.reviews += 1;
            return { data: [] };
          },
        },
        issues: {
          listComments: async () => {
            calls.issueComments += 1;
            return { data: [] };
          },
        },
      },
    };

    const result = await scanReviewOutputMarkers({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      marker,
      perPage: 100,
      maxItems: 2000,
    });

    expect(result.reviewComments).toEqual({ found: true, scanned: 1, hitCap: false });
    expect(result.issueComments).toEqual({ found: false, scanned: 0, hitCap: false });
    expect(result.reviews).toEqual({ found: false, scanned: 0, hitCap: false });
    expect(calls).toEqual({
      reviewComments: 2,
      issueComments: 1,
      reviews: 1,
    });
  });
});
