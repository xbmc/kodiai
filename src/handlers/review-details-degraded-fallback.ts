import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import {
  upsertDegradedReviewDetailsFallbackComment,
} from "../review-orchestration/review-canonical-surface.ts";

type UpsertDegradedReviewDetailsFallbackComment = typeof upsertDegradedReviewDetailsFallbackComment;

export async function publishDegradedReviewDetailsFallbackFailOpen(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  renderBody: () => string;
  botHandles: string[];
  publishReason: string;
  failureMessage: string;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "warn">;
  canPublishVisibleOutput: (reason: string) => boolean;
  upsertDegradedReviewDetailsFallbackCommentFn?: UpsertDegradedReviewDetailsFallbackComment;
}): Promise<void> {
  if (!params.canPublishVisibleOutput(params.publishReason)) {
    return;
  }

  const upsertDegraded =
    params.upsertDegradedReviewDetailsFallbackCommentFn ?? upsertDegradedReviewDetailsFallbackComment;

  try {
    const fallbackResult = await upsertDegraded({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      body: params.renderBody(),
      botHandles: params.botHandles,
      recheckCanPublish: () => params.canPublishVisibleOutput(params.publishReason),
    });
    if (fallbackResult.ok) {
      return;
    }
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "failed",
        reviewOutputKey: params.reviewOutputKey,
        err: fallbackResult.err.error,
      },
      params.failureMessage,
    );
  } catch (fallbackErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "failed",
        reviewOutputKey: params.reviewOutputKey,
        err: fallbackErr,
      },
      params.failureMessage,
    );
  }
}
