import type { Octokit } from "@octokit/rest";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import { ok, type Result } from "../lib/result.ts";
import {
  upsertDegradedReviewDetailsFallbackComment,
} from "../review-orchestration/review-canonical-surface.ts";
import {
  type ReviewDetailsPublicationRuntime,
  updateFinalizedReviewDetailsComment,
} from "./review-details-publication-runtime.ts";

type UpsertDegradedReviewDetailsFallbackComment = typeof upsertDegradedReviewDetailsFallbackComment;
type UpdateFinalizedReviewDetailsComment = typeof updateFinalizedReviewDetailsComment;

export type StandaloneReviewDetailsFallbackStatus = {
  delivery: "degraded-fallback" | "skipped";
  published: boolean;
};

export type StandaloneReviewDetailsFallbackResult =
  Result<StandaloneReviewDetailsFallbackStatus, never>;

export async function publishStandaloneReviewDetailsFallback(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  fullDetailsBody: string;
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  finalizePublicationPhaseTiming: ReviewDetailsPublicationRuntime["finalizePublicationPhaseTiming"];
  logReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logReviewDetailsPublicationCompleted"];
  upsertDegradedReviewDetailsFallbackCommentFn?: UpsertDegradedReviewDetailsFallbackComment;
  updateFinalizedReviewDetailsCommentFn?: UpdateFinalizedReviewDetailsComment;
}): Promise<StandaloneReviewDetailsFallbackResult> {
  if (!params.canPublishVisibleOutput("degraded Review Details fallback comment")) {
    return ok({ delivery: "skipped", published: false });
  }

  const upsertDegraded =
    params.upsertDegradedReviewDetailsFallbackCommentFn ?? upsertDegradedReviewDetailsFallbackComment;
  const updateFinalized =
    params.updateFinalizedReviewDetailsCommentFn ?? updateFinalizedReviewDetailsComment;

  params.setReviewWorkPhase("publish");
  const reviewDetailsPublication = await upsertDegraded({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    body: params.fullDetailsBody,
    botHandles: params.botHandles,
    recheckCanPublish: () =>
      params.canPublishVisibleOutput("degraded Review Details fallback comment"),
  });
  const reviewDetailsCommentId = reviewDetailsPublication.ok
    && reviewDetailsPublication.value.published
    ? reviewDetailsPublication.value.commentId
    : undefined;

  if (typeof reviewDetailsCommentId === "number") {
    params.logReviewDetailsPublicationCompleted({
      surfaceKind: "issue_comment",
      commentId: reviewDetailsCommentId,
      publicationMode: "degraded-fallback",
    });
  }

  params.finalizePublicationPhaseTiming();
  if (
    reviewDetailsCommentId !== undefined &&
    params.canPublishVisibleOutput("finalized Review Details timing update")
  ) {
    await updateFinalized({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      commentId: reviewDetailsCommentId,
      body: params.renderReviewDetailsBody(),
      botHandles: params.botHandles,
    });
  }
  return ok({
    delivery: "degraded-fallback",
    published: typeof reviewDetailsCommentId === "number",
  });
}
