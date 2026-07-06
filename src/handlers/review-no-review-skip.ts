import type { Octokit } from "@octokit/rest";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";

export function buildNoReviewSkipAcknowledgmentBody(): string {
  return "Review skipped per `[no-review]` in PR title.";
}

export async function postNoReviewSkipAcknowledgment(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  botHandles: string[];
}): Promise<void> {
  await createIssueCommentWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.prNumber,
    body: buildNoReviewSkipAcknowledgmentBody(),
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });
}
