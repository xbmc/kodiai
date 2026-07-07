import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { ok, type Result } from "../lib/result.ts";
import {
  upsertDegradedReviewDetailsFallbackComment,
} from "../review-orchestration/review-canonical-surface.ts";

type UpsertDegradedReviewDetailsFallbackComment = typeof upsertDegradedReviewDetailsFallbackComment;

export type DegradedReviewDetailsFallbackFailOpenStatus = {
  delivery: "degraded-fallback" | "skipped";
  published: boolean;
};

export type DegradedReviewDetailsFallbackFailOpenResult =
  Result<DegradedReviewDetailsFallbackFailOpenStatus, never>;

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
}): Promise<DegradedReviewDetailsFallbackFailOpenResult> {
  if (!params.canPublishVisibleOutput(params.publishReason)) {
    return ok({ delivery: "skipped", published: false });
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
      return ok({
        delivery: "degraded-fallback",
        published: fallbackResult.value.published,
      });
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
    return ok({ delivery: "degraded-fallback", published: false });
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
    return ok({ delivery: "degraded-fallback", published: false });
  }
}
