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

export async function publishMovedToDetailsReviewDetailsMerge(params: {
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
  if (!params.canPublishVisibleOutput("canonical Review Details moved-to-details preservation")) {
    return;
  }

  const upsertCanonical = params.upsertCanonicalReviewSurfaceFn ?? upsertCanonicalReviewSurface;
  const upsertDegraded = params.upsertDegradedReviewDetailsFallbackCommentFn ?? upsertDegradedReviewDetailsFallbackComment;
  let movedDetailsSurface: CanonicalReviewSurface | undefined;

  try {
    params.setReviewWorkPhase("publish");
    movedDetailsSurface = await upsertCanonical({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: "issue_comment",
      canonicalSurface: params.acceptedCanonicalSurface?.kind === "issue_comment"
        ? params.acceptedCanonicalSurface
        : undefined,
      body: params.fullDetailsBody,
      botHandles: params.botHandles,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      recheckCanPublish: () =>
        params.canPublishVisibleOutput("canonical Review Details moved-to-details preservation"),
    });
    params.logCanonicalReviewDetailsPublicationCompleted(movedDetailsSurface);
  } catch (appendErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "moved-to-details-canonical-merge-failed",
        err: appendErr,
      },
      "Failed to publish canonical Review Details for moved-to-details candidates; using degraded fallback comment",
    );

    if (params.canPublishVisibleOutput("degraded Review Details moved-to-details fallback comment")) {
      params.setReviewWorkPhase("publish");
      const fallbackCommentId = await upsertDegraded({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        body: params.fullDetailsBody,
        botHandles: params.botHandles,
        recheckCanPublish: () =>
          params.canPublishVisibleOutput("degraded Review Details moved-to-details fallback comment"),
      });
      if (typeof fallbackCommentId === "number") {
        params.logReviewDetailsPublicationCompleted({
          surfaceKind: "issue_comment",
          commentId: fallbackCommentId,
          publicationMode: "degraded-fallback",
        });
      }
    }
  }

  if (movedDetailsSurface?.kind !== "issue_comment") {
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
      canonicalSurface: movedDetailsSurface,
      body: params.renderReviewDetailsBody(),
      botHandles: params.botHandles,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      recheckCanPublish: () =>
        params.canPublishVisibleOutput("finalized moved-to-details Review Details timing update"),
    });
  } catch (appendErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "finalized-moved-to-details-merge-failed",
        err: appendErr,
      },
      "Failed to refresh finalized moved-to-details Review Details surface",
    );
  }
}
