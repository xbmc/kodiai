import type { ExecutionResult, ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import {
  buildOrderedReviewPhaseSummary,
  createReviewPhaseTiming,
} from "../review-orchestration/review-phase-timing.ts";
import { buildReviewPhaseTimingSummaryLogFields } from "./review-publication-state.ts";

export function finalizeReviewPhaseSummary(params: {
  reviewPhaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  workspacePhaseStartedAt: number | undefined;
  retrievalPhaseStartedAt: number | undefined;
  publicationPhaseStartedAt: number | undefined;
  totalPhaseStartAt: number;
  executorResult: Pick<ExecutionResult, "conclusion" | "stopReason" | "failureSubtype"> | undefined;
  deliveryId: string;
  reviewOutputKey: string;
  installationId: number;
  repo: string;
  prNumber: number;
  reviewOutputPublished: boolean;
  reviewPublishResolution: string;
  reviewPublishFallbackDelivery?: string;
  logger: {
    info(fields: Record<string, unknown>, message?: string): void;
  };
  now?: () => number;
}): void {
  const now = params.now ?? (() => Date.now());

  if (params.publicationPhaseStartedAt !== undefined && !params.reviewPhaseTimings.has("publication")) {
    params.reviewPhaseTimings.set(
      "publication",
      createReviewPhaseTiming({
        name: "publication",
        status: "completed",
        durationMs: Math.max(0, now() - params.publicationPhaseStartedAt),
      }),
    );
  }

  const shouldLogPhaseSummary =
    params.workspacePhaseStartedAt !== undefined ||
    params.retrievalPhaseStartedAt !== undefined ||
    params.publicationPhaseStartedAt !== undefined ||
    params.executorResult !== undefined;

  if (!shouldLogPhaseSummary || params.deliveryId.length === 0 || params.reviewOutputKey.length === 0) {
    return;
  }

  try {
    params.logger.info(
      buildReviewPhaseTimingSummaryLogFields({
        deliveryId: params.deliveryId,
        reviewOutputKey: params.reviewOutputKey,
        installationId: params.installationId,
        repo: params.repo,
        prNumber: params.prNumber,
        executorResult: params.executorResult,
        reviewOutputPublished: params.reviewOutputPublished,
        reviewPublishResolution: params.reviewPublishResolution,
        reviewPublishFallbackDelivery: params.reviewPublishFallbackDelivery,
        totalDurationMs: Math.max(0, now() - params.totalPhaseStartAt),
        phases: buildOrderedReviewPhaseSummary(params.reviewPhaseTimings),
      }),
      "Review phase timing summary",
    );
  } catch {
    // logging failures must never block review publication
  }
}
