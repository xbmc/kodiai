import type { Octokit } from "@octokit/rest";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import { err, ok, type Result } from "../lib/result.ts";

export type BoundedFirstPassReviewPublicationValue = {
  published: boolean;
  commentId: number | undefined;
};

export type BoundedFirstPassReviewPublicationError = {
  published: false;
  error: unknown;
};

export type BoundedFirstPassReviewPublicationResult = Result<
  BoundedFirstPassReviewPublicationValue,
  BoundedFirstPassReviewPublicationError
>;

export async function publishBoundedFirstPassReview(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
}): Promise<BoundedFirstPassReviewPublicationResult> {
  if (!params.canPublishVisibleOutput("bounded first-pass review")) {
    return ok({
      published: false,
      commentId: undefined,
    });
  }

  params.setReviewWorkPhase("publish");
  try {
    const partialComment = await createIssueCommentWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: params.body,
      botHandles: params.botHandles,
      preserveKodiaiMarkers: true,
    });
    return ok({
      published: true,
      commentId: partialComment.data.id,
    });
  } catch (error) {
    return err({
      published: false,
      error,
    });
  }
}
