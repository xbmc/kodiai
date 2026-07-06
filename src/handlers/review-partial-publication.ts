import type { Octokit } from "@octokit/rest";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";

export async function publishBoundedFirstPassReview(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
}): Promise<number | undefined> {
  if (!params.canPublishVisibleOutput("bounded first-pass review")) {
    return undefined;
  }

  params.setReviewWorkPhase("publish");
  const partialComment = await createIssueCommentWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.prNumber,
    body: params.body,
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });
  return partialComment.data.id;
}
