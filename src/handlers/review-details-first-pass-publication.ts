import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import { ok, type Result } from "../lib/result.ts";
import type { CanonicalReviewSurface } from "../review-orchestration/review-canonical-surface.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import {
  publishMovedToDetailsReviewDetailsMerge,
} from "./review-details-moved-to-details-merge.ts";
import {
  publishPublishedReviewDetailsMerge,
} from "./review-details-published-merge.ts";
import {
  publishStandaloneReviewDetailsFallback,
} from "./review-details-standalone-fallback.ts";

type PublishPublishedReviewDetailsMerge = typeof publishPublishedReviewDetailsMerge;
type PublishMovedToDetailsReviewDetailsMerge = typeof publishMovedToDetailsReviewDetailsMerge;
type PublishStandaloneReviewDetailsFallback = typeof publishStandaloneReviewDetailsFallback;

export type FirstPassReviewDetailsPublicationValue = {
  canonicalReviewDetailsBody: string | null;
};

export type FirstPassReviewDetailsPublicationResult =
  Result<FirstPassReviewDetailsPublicationValue, never>;

export function resolveFirstPassReviewDetailsPublicationBody(
  publication: FirstPassReviewDetailsPublicationResult,
): string | null {
  return publication.ok ? publication.value.canonicalReviewDetailsBody : null;
}

export async function publishFirstPassReviewDetails(params: {
  reviewOutputSucceeded: boolean;
  resultPublished: boolean;
  resultConclusion: string;
  candidateMovedToDetailsCount: number;
  blockedFindingsNoticeWillPublish: boolean;
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  botHandles: string[];
  acceptedCanonicalSurface?: CanonicalReviewSurface | null;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  attemptLogFields?: Record<string, unknown>;
  logger: Pick<Logger, "info" | "warn">;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  finalizePublicationPhaseTiming: ReviewDetailsPublicationRuntime["finalizePublicationPhaseTiming"];
  logReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logReviewDetailsPublicationCompleted"];
  logCanonicalReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logCanonicalReviewDetailsPublicationCompleted"];
  publishPublishedReviewDetailsMergeFn?: PublishPublishedReviewDetailsMerge;
  publishMovedToDetailsReviewDetailsMergeFn?: PublishMovedToDetailsReviewDetailsMerge;
  publishStandaloneReviewDetailsFallbackFn?: PublishStandaloneReviewDetailsFallback;
}): Promise<FirstPassReviewDetailsPublicationResult> {
  if (!params.reviewOutputSucceeded) {
    return ok({ canonicalReviewDetailsBody: null });
  }

  params.logger.info(
    {
      ...params.baseLog,
      gate: "review-details-output",
      gateResult: "attempt",
      reviewOutputKey: params.reviewOutputKey,
      ...params.attemptLogFields,
    },
    "Attempting canonical Review Details publication",
  );

  try {
    const fullDetailsBody = params.renderReviewDetailsBody();

    if (params.resultPublished) {
      const publishPublished = params.publishPublishedReviewDetailsMergeFn ?? publishPublishedReviewDetailsMerge;
      const publishedMerge = await publishPublished({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        fullDetailsBody,
        botHandles: params.botHandles,
        acceptedCanonicalSurface: params.acceptedCanonicalSurface,
        authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
        reviewBoundedness: params.reviewBoundedness,
        baseLog: params.baseLog,
        logger: params.logger,
        canPublishVisibleOutput: params.canPublishVisibleOutput,
        setReviewWorkPhase: params.setReviewWorkPhase,
        renderReviewDetailsBody: params.renderReviewDetailsBody,
        finalizePublicationPhaseTiming: params.finalizePublicationPhaseTiming,
        logReviewDetailsPublicationCompleted: params.logReviewDetailsPublicationCompleted,
        logCanonicalReviewDetailsPublicationCompleted: params.logCanonicalReviewDetailsPublicationCompleted,
      });
      if (!publishedMerge.ok) return ok({ canonicalReviewDetailsBody: null });
      const publishedMergeStatus = publishedMerge.value;
      if (publishedMergeStatus.delivery === "skipped") {
        return ok({ canonicalReviewDetailsBody: fullDetailsBody });
      }
      return ok({ canonicalReviewDetailsBody: fullDetailsBody });
    }

    if (params.candidateMovedToDetailsCount > 0 && !params.blockedFindingsNoticeWillPublish) {
      const publishMovedToDetails =
        params.publishMovedToDetailsReviewDetailsMergeFn ?? publishMovedToDetailsReviewDetailsMerge;
      const movedToDetailsMerge = await publishMovedToDetails({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        fullDetailsBody,
        botHandles: params.botHandles,
        acceptedCanonicalSurface: params.acceptedCanonicalSurface,
        authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
        reviewBoundedness: params.reviewBoundedness,
        baseLog: params.baseLog,
        logger: params.logger,
        canPublishVisibleOutput: params.canPublishVisibleOutput,
        setReviewWorkPhase: params.setReviewWorkPhase,
        renderReviewDetailsBody: params.renderReviewDetailsBody,
        finalizePublicationPhaseTiming: params.finalizePublicationPhaseTiming,
        logReviewDetailsPublicationCompleted: params.logReviewDetailsPublicationCompleted,
        logCanonicalReviewDetailsPublicationCompleted: params.logCanonicalReviewDetailsPublicationCompleted,
      });
      if (!movedToDetailsMerge.ok) return ok({ canonicalReviewDetailsBody: null });
      const movedToDetailsMergeStatus = movedToDetailsMerge.value;
      if (movedToDetailsMergeStatus.delivery === "skipped") {
        return ok({ canonicalReviewDetailsBody: fullDetailsBody });
      }
      return ok({ canonicalReviewDetailsBody: fullDetailsBody });
    }

    const canonicalSurfaceOwnedElsewhere =
      params.resultConclusion === "success" || params.blockedFindingsNoticeWillPublish;
    if (!canonicalSurfaceOwnedElsewhere) {
      const publishStandalone =
        params.publishStandaloneReviewDetailsFallbackFn ?? publishStandaloneReviewDetailsFallback;
      const standaloneFallback = await publishStandalone({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        fullDetailsBody,
        botHandles: params.botHandles,
        canPublishVisibleOutput: params.canPublishVisibleOutput,
        setReviewWorkPhase: params.setReviewWorkPhase,
        renderReviewDetailsBody: params.renderReviewDetailsBody,
        finalizePublicationPhaseTiming: params.finalizePublicationPhaseTiming,
        logReviewDetailsPublicationCompleted: params.logReviewDetailsPublicationCompleted,
      });
      if (!standaloneFallback.ok) return ok({ canonicalReviewDetailsBody: null });
      const standaloneFallbackStatus = standaloneFallback.value;
      if (standaloneFallbackStatus.delivery === "skipped") {
        return ok({ canonicalReviewDetailsBody: fullDetailsBody });
      }
    }

    return ok({ canonicalReviewDetailsBody: fullDetailsBody });
  } catch (err) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "failed",
        reviewOutputKey: params.reviewOutputKey,
        err,
      },
      "Failed to publish first-pass Review Details output",
    );
    return ok({ canonicalReviewDetailsBody: null });
  }
}
