import type { Logger } from "pino";
import {
  type ExtractedFinding,
  extractFindingsFromReviewComments,
} from "../review-orchestration/review-comment-finding-extraction.ts";
import {
  toReviewCandidateFindingDetailsSummary,
  type ReviewCandidateFindingDetailsSummary,
  type ReviewCandidateFindingExecutionResult,
} from "../review-orchestration/review-candidate-finding.ts";
import {
  logReviewCandidateFindingResult,
  resolveReviewCandidateFindingResult,
  toReviewCandidateFindingSafeSnapshot,
  type ReviewCandidateFindingSafeSnapshot,
} from "../review-orchestration/review-candidate-finding-handler.ts";

type ExtractFindingsFromReviewComments = typeof extractFindingsFromReviewComments;
type ReviewCommentExtractionOctokit = Parameters<ExtractFindingsFromReviewComments>[0]["octokit"];

export type ReviewCandidateFindingContext = {
  result: ReviewCandidateFindingExecutionResult;
  detailsSummary: ReviewCandidateFindingDetailsSummary;
  configSnapshot: ReviewCandidateFindingSafeSnapshot;
  extractedFindings: ExtractedFinding[];
};

export async function resolveReviewCandidateFindingContext(params: {
  candidateFinding: unknown;
  executionSucceeded: boolean;
  octokit: ReviewCommentExtractionOctokit;
  extractFindings?: ExtractFindingsFromReviewComments;
  logger: Logger;
  baseLog: Record<string, unknown>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  deliveryId: string;
}): Promise<ReviewCandidateFindingContext> {
  const result = resolveReviewCandidateFindingResult({
    candidateFinding: params.candidateFinding,
    repo: `${params.owner}/${params.repo}`,
    pullNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
  });
  const detailsSummary = toReviewCandidateFindingDetailsSummary(result);
  const configSnapshot = toReviewCandidateFindingSafeSnapshot(result);
  logReviewCandidateFindingResult({
    logger: params.logger,
    baseLog: params.baseLog,
    result,
  });

  const extractFindings = params.extractFindings ?? extractFindingsFromReviewComments;
  const extractedFindings = params.executionSucceeded
    ? await extractFindings({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        logger: params.logger,
        baseLog: params.baseLog,
      })
    : [];

  return {
    result,
    detailsSummary,
    configSnapshot,
    extractedFindings,
  };
}
