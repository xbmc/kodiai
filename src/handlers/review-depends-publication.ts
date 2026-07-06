import type { Octokit } from "@octokit/rest";
import {
  createIssueCommentWithPublicationPipeline,
  createPullReviewWithPublicationPipeline,
} from "../lib/github-publication.ts";
import type { InlineComment } from "../lib/depends-review-builder.ts";

export type DependsReviewPublicationResult = {
  publishedSummary: boolean;
  publishedInlineComments: boolean;
};

export async function publishDependsReviewOutput(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  summaryBody: string;
  inlineComments: InlineComment[];
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
}): Promise<DependsReviewPublicationResult> {
  let publishedSummary = false;
  let publishedInlineComments = false;

  if (params.canPublishVisibleOutput("[depends] deep review summary comment")) {
    params.setReviewWorkPhase("publish");
    await createIssueCommentWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: params.summaryBody,
      botHandles: params.botHandles,
      preserveKodiaiMarkers: true,
    });
    publishedSummary = true;
  }

  if (
    params.inlineComments.length > 0
    && params.canPublishVisibleOutput("[depends] deep review inline comments")
  ) {
    params.setReviewWorkPhase("publish");
    await createPullReviewWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      event: "COMMENT",
      comments: params.inlineComments.map(comment => ({
        path: comment.path,
        line: comment.line,
        body: comment.body,
      })),
      botHandles: params.botHandles,
    });
    publishedInlineComments = true;
  }

  return { publishedSummary, publishedInlineComments };
}
