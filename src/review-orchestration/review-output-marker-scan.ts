import type { Octokit } from "@octokit/rest";
import {
  type MarkerScanResult,
  scanIssueCommentMarkerPaged,
  scanPullReviewMarkerPaged,
  scanReviewCommentMarkerPaged,
} from "../lib/github-issue-comments.ts";
import { retryGitHubTransient } from "../lib/github-retry.ts";

export type ReviewOutputMarkerScanResult = {
  reviewComments: MarkerScanResult;
  issueComments: MarkerScanResult;
  reviews: MarkerScanResult;
};

export async function scanReviewOutputMarkers(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  marker: string;
  perPage: number;
  maxItems: number;
}): Promise<ReviewOutputMarkerScanResult> {
  const [reviewComments, issueComments, reviews] = await Promise.all([
    scanReviewCommentMarkerPaged({
      rest: {
        pulls: {
          listReviewComments: (args) =>
            retryGitHubTransient(() => params.octokit.rest.pulls.listReviewComments(args)),
        },
      },
    }, {
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      marker: params.marker,
      perPage: params.perPage,
      maxItems: params.maxItems,
      sort: "created",
      direction: "desc",
    }),
    scanIssueCommentMarkerPaged({
      rest: {
        issues: {
          listComments: (args) =>
            retryGitHubTransient(() => params.octokit.rest.issues.listComments(args)),
        },
      },
    }, {
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.prNumber,
      marker: params.marker,
      perPage: params.perPage,
      maxItems: params.maxItems,
    }),
    scanPullReviewMarkerPaged({
      rest: {
        pulls: {
          listReviews: (args) =>
            retryGitHubTransient(() => params.octokit.rest.pulls.listReviews(args)),
        },
      },
    }, {
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      marker: params.marker,
      perPage: params.perPage,
      maxItems: params.maxItems,
    }),
  ]);

  return { reviewComments, issueComments, reviews };
}
