import type { Logger } from "pino";
import {
  buildPrDiffCommentabilityIndex,
  type PrDiffCommentabilityIndex,
} from "../execution/formatter-suggestions.ts";
import {
  collectDiffContext,
  type DiffCollectionResult,
} from "../review-orchestration/review-diff-collection.ts";
import {
  fetchAllPullRequestFiles,
  type PullRequestFileMetadata,
  type PullRequestFilesClient,
} from "../lib/github-pr-files.ts";

export type ReviewDiffContextResult = {
  diffContext: DiffCollectionResult;
  diffContentForValidation: string;
  prDiffCommentabilityIndex: PrDiffCommentabilityIndex | undefined;
  allChangedFiles: string[];
};

export async function resolveReviewDiffContext(params: {
  diffContextCollector: typeof collectDiffContext;
  workspaceDir: string;
  baseRef: string;
  token?: string;
  octokit: PullRequestFilesClient;
  owner: string;
  repo: string;
  prNumber: number;
  logger: Logger;
  baseLog: Record<string, unknown>;
  fetchPullRequestFiles?: typeof fetchAllPullRequestFiles;
}): Promise<ReviewDiffContextResult> {
  const fetchPullRequestFiles = params.fetchPullRequestFiles ?? fetchAllPullRequestFiles;
  const diffContext = await params.diffContextCollector({
    workspaceDir: params.workspaceDir,
    baseRef: params.baseRef,
    maxFilesForFullDiff: 200,
    logger: params.logger,
    baseLog: params.baseLog,
    token: params.token,
    fallbackDiffProvider: async (): Promise<PullRequestFileMetadata[]> => await fetchPullRequestFiles({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.prNumber,
    }),
  });
  const diffContentForValidation = diffContext.diffContent ?? "";

  return {
    diffContext,
    diffContentForValidation,
    prDiffCommentabilityIndex: diffContentForValidation
      ? buildPrDiffCommentabilityIndex(diffContentForValidation)
      : undefined,
    allChangedFiles: diffContext.changedFiles,
  };
}
