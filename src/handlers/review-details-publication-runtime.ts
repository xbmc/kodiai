import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import type { FilteredFindingRecord } from "../lib/output-filter.ts";
import { updateIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import type { VisibleBudgetProjection } from "../review-visible-budget/visible-budget-behavior.ts";
import type {
  CanonicalReviewSurface,
  CanonicalSurfaceKind,
} from "../review-orchestration/review-canonical-surface.ts";
import {
  completeReviewPublicationPhaseTiming,
} from "../review-orchestration/review-phase-timing.ts";
import {
  buildCanonicalReviewDetailsPublicationCompletedLogFields,
  buildReviewDetailsPublicationCompletedLogFields,
} from "./review-publication-state.ts";
import {
  buildReviewDetailsBody,
  type ReviewDetailsBodyBaseParams,
  type ReviewDetailsBodyRuntimeParams,
} from "./review-details-body.ts";

export type ReviewDetailsPublicationRuntime = {
  renderReviewDetailsBody(params?: ReviewDetailsBodyRuntimeParams): string;
  finalizePublicationPhaseTiming(): void;
  logReviewDetailsPublicationCompleted(params: {
    surfaceKind: CanonicalSurfaceKind;
    commentId?: number;
    reviewId?: number;
    publicationMode: "canonical" | "degraded-fallback";
  }): void;
  logCanonicalReviewDetailsPublicationCompleted(
    surface: CanonicalReviewSurface | undefined,
    publicationMode?: "canonical" | "degraded-fallback",
  ): void;
};

export async function updateFinalizedReviewDetailsComment(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
  botHandles: string[];
}): Promise<void> {
  await updateIssueCommentWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    comment_id: params.commentId,
    body: params.body,
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });
}

export function createReviewDetailsPublicationRuntime(params: {
  logger: Pick<Logger, "info">;
  baseLog: Record<string, unknown>;
  reviewOutputKey: string;
  deliveryId: string;
  doctrineFields?: Record<string, unknown>;
  reviewDetailsBodyBase: ReviewDetailsBodyBaseParams;
  hasOperationalSignal: boolean;
  getVisibleBudgetProjection: () => VisibleBudgetProjection | null;
  filteredFindings: FilteredFindingRecord[];
  reviewPhaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  getPublicationPhaseStartedAt: () => number | undefined;
}): ReviewDetailsPublicationRuntime {
  return {
    renderReviewDetailsBody(runtime?: ReviewDetailsBodyRuntimeParams): string {
      return buildReviewDetailsBody({
        base: params.reviewDetailsBodyBase,
        hasOperationalSignal: params.hasOperationalSignal,
        visibleBudgetProjection: params.getVisibleBudgetProjection(),
        filteredFindings: params.filteredFindings,
        runtime,
      });
    },

    finalizePublicationPhaseTiming(): void {
      completeReviewPublicationPhaseTiming({
        phases: params.reviewPhaseTimings,
        publicationPhaseStartedAt: params.getPublicationPhaseStartedAt(),
      });
    },

    logReviewDetailsPublicationCompleted(logParams): void {
      params.logger.info(
        buildReviewDetailsPublicationCompletedLogFields({
          baseLog: params.baseLog,
          reviewOutputKey: params.reviewOutputKey,
          deliveryId: params.deliveryId,
          publicationMode: logParams.publicationMode,
          surfaceKind: logParams.surfaceKind,
          commentId: logParams.commentId,
          reviewId: logParams.reviewId,
          doctrineFields: params.doctrineFields,
        }),
        "Review Details publication completed",
      );
    },

    logCanonicalReviewDetailsPublicationCompleted(
      surface,
      publicationMode = "canonical",
    ): void {
      const fields = buildCanonicalReviewDetailsPublicationCompletedLogFields({
        surface,
        baseLog: params.baseLog,
        reviewOutputKey: params.reviewOutputKey,
        deliveryId: params.deliveryId,
        publicationMode,
        doctrineFields: params.doctrineFields,
      });
      if (fields) {
        params.logger.info(fields, "Review Details publication completed");
      }
    },
  };
}
