import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import {
  type CanonicalReviewSurface,
  upsertCanonicalReviewSurface,
  upsertDegradedReviewDetailsFallbackComment,
} from "../review-orchestration/review-canonical-surface.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";

type UpsertCanonicalReviewSurface = typeof upsertCanonicalReviewSurface;
type UpsertDegradedReviewDetailsFallbackComment = typeof upsertDegradedReviewDetailsFallbackComment;

export async function publishPublishedReviewDetailsMerge(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  fullDetailsBody: string;
  botHandles: string[];
  acceptedCanonicalSurface?: CanonicalReviewSurface | null;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "warn">;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  finalizePublicationPhaseTiming: ReviewDetailsPublicationRuntime["finalizePublicationPhaseTiming"];
  logReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logReviewDetailsPublicationCompleted"];
  logCanonicalReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logCanonicalReviewDetailsPublicationCompleted"];
  upsertCanonicalReviewSurfaceFn?: UpsertCanonicalReviewSurface;
  upsertDegradedReviewDetailsFallbackCommentFn?: UpsertDegradedReviewDetailsFallbackComment;
}): Promise<void> {
  if (!params.canPublishVisibleOutput("canonical Review Details merge")) {
    return;
  }

  const upsertCanonical = params.upsertCanonicalReviewSurfaceFn ?? upsertCanonicalReviewSurface;
  const upsertDegraded = params.upsertDegradedReviewDetailsFallbackCommentFn ?? upsertDegradedReviewDetailsFallbackComment;
  let canonicalIssueComment: CanonicalReviewSurface | undefined;

  try {
    params.setReviewWorkPhase("publish");
    canonicalIssueComment = await upsertCanonical({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: "issue_comment",
      canonicalSurface: params.acceptedCanonicalSurface?.kind === "issue_comment"
        ? params.acceptedCanonicalSurface
        : undefined,
      reviewDetailsBlock: params.fullDetailsBody,
      botHandles: params.botHandles,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      recheckCanPublish: () =>
        params.canPublishVisibleOutput("canonical Review Details merge"),
    });
    params.logCanonicalReviewDetailsPublicationCompleted(canonicalIssueComment);
  } catch (appendErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "degraded-fallback",
        err: appendErr,
      },
      "Failed to update canonical review surface with Review Details; using degraded fallback comment",
    );

    if (params.canPublishVisibleOutput("degraded Review Details fallback comment")) {
      params.setReviewWorkPhase("publish");
      const fallbackPublication = await upsertDegraded({
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
      const fallbackCommentId = fallbackPublication.ok
        && fallbackPublication.value.published
        ? fallbackPublication.value.commentId
        : undefined;
      if (typeof fallbackCommentId === "number") {
        params.logReviewDetailsPublicationCompleted({
          surfaceKind: "issue_comment",
          commentId: fallbackCommentId,
          publicationMode: "degraded-fallback",
        });
      }
    }
  }

  if (canonicalIssueComment?.kind !== "issue_comment") {
    return;
  }

  params.finalizePublicationPhaseTiming();
  try {
    await upsertCanonical({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: "issue_comment",
      canonicalSurface: canonicalIssueComment,
      reviewDetailsBlock: params.renderReviewDetailsBody(),
      botHandles: params.botHandles,
      summaryBody: canonicalIssueComment.body,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      recheckCanPublish: () =>
        params.canPublishVisibleOutput("finalized canonical Review Details merge"),
    });
  } catch (appendErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "finalized-canonical-merge-failed",
        err: appendErr,
      },
      "Failed to refresh finalized canonical Review Details surface",
    );
  }
}
