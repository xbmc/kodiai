import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import {
  removeFilteredInlineComments,
  type InlineCommentRemovalResult,
} from "../review-orchestration/review-comment-finding-extraction.ts";

type RemoveFilteredInlineComments = (params: Parameters<typeof removeFilteredInlineComments>[0]) => Promise<InlineCommentRemovalResult>;

export async function removeFilteredInlineCommentsForSuccessfulReview(params: {
  reviewOutputSucceeded: boolean;
  filteredInlineFindings: Array<{ commentId: number }>;
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  logger: Logger;
  baseLog: Record<string, unknown>;
  removeFilteredInlineComments?: RemoveFilteredInlineComments;
}): Promise<void> {
  if (!params.reviewOutputSucceeded || params.filteredInlineFindings.length === 0) return;

  const remove = params.removeFilteredInlineComments ?? removeFilteredInlineComments;
  await remove({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    findings: params.filteredInlineFindings,
    logger: params.logger,
    baseLog: params.baseLog,
  });
}
