import type { Logger } from "pino";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import type { Result } from "../lib/result.ts";
import { createReviewPhaseTiming } from "../review-orchestration/review-phase-timing.ts";

export type ReviewHandlerFailurePublicationValue = {
  phaseDetail: string;
};

export type ReviewHandlerFailurePublicationError = {
  phaseDetail: string;
};

export type ReviewHandlerFailurePublicationResult = Result<
  ReviewHandlerFailurePublicationValue,
  ReviewHandlerFailurePublicationError
>;

export async function handleReviewHandlerFailureRecovery(params: {
  error: unknown;
  prNumber: number;
  reviewPhaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  workspacePhaseStartedAt: number | undefined;
  retrievalPhaseStartedAt: number | undefined;
  publicationPhaseStartedAt: number | undefined;
  now?: () => number;
  logger: Pick<Logger, "error">;
  publishHandlerFailureError: () => Promise<ReviewHandlerFailurePublicationResult>;
}): Promise<number> {
  const now = params.now ?? (() => Date.now());

  if (!params.reviewPhaseTimings.has("workspace preparation") && params.workspacePhaseStartedAt !== undefined) {
    params.reviewPhaseTimings.set(
      "workspace preparation",
      createReviewPhaseTiming({
        name: "workspace preparation",
        status: "degraded",
        durationMs: Math.max(0, now() - params.workspacePhaseStartedAt),
        detail: "workspace preparation failed",
      }),
    );
  }

  if (!params.reviewPhaseTimings.has("retrieval/context assembly") && params.retrievalPhaseStartedAt !== undefined) {
    params.reviewPhaseTimings.set(
      "retrieval/context assembly",
      createReviewPhaseTiming({
        name: "retrieval/context assembly",
        status: "degraded",
        durationMs: Math.max(0, now() - params.retrievalPhaseStartedAt),
        detail: "retrieval/context assembly failed",
      }),
    );
  }

  const publicationPhaseStartedAt = params.publicationPhaseStartedAt ?? now();

  params.logger.error(
    { err: params.error, prNumber: params.prNumber },
    "Review handler failed",
  );

  try {
    const handlerFailurePublication = await params.publishHandlerFailureError();
    const phaseDetail = handlerFailurePublication.ok
      ? handlerFailurePublication.value.phaseDetail
      : handlerFailurePublication.err.phaseDetail;
    params.reviewPhaseTimings.set(
      "publication",
      createReviewPhaseTiming({
        name: "publication",
        status: "degraded",
        durationMs: Math.max(0, now() - publicationPhaseStartedAt),
        detail: phaseDetail,
      }),
    );
  } catch (commentErr) {
    params.logger.error({ err: commentErr }, "Failed to post error comment to PR");
    params.reviewPhaseTimings.set(
      "publication",
      createReviewPhaseTiming({
        name: "publication",
        status: "degraded",
        durationMs: Math.max(0, now() - publicationPhaseStartedAt),
        detail: "failed to publish error comment after handler failure",
      }),
    );
  }

  return publicationPhaseStartedAt;
}
