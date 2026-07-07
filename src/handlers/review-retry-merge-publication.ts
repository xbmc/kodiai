import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import type { ReviewContinuationMergeContext } from "./review-continuation-merge-context.ts";
import { resolveMergedContinuationFamilyState } from "./review-continuation-family-state-projection.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import { publishRetryReviewDetailsMerge } from "./review-details-retry-publication.ts";
import { discardCheckpointsFailOpen } from "./review-handler-utils.ts";

export async function publishRetryMergeContinuationResults(params: {
  getOctokit: () => Promise<Octokit>;
  getAppSlug: () => string;
  owner: string;
  repo: string;
  prNumber: number;
  attemptId: string;
  deliveryId: string;
  reviewOutputKey: string;
  retryReviewOutputKey: string;
  retryConclusion: string;
  partialCommentId?: number;
  settlementReason: string;
  mergeContext: Extract<ReviewContinuationMergeContext, { status: "publishable" }>;
  knowledgeStore: KnowledgeStore | undefined;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  logger: Logger;
  canPublishReviewWorkOutput: (attemptId: string, reason: string, deliveryId: string) => boolean;
  setPublishPhase: () => void;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  settleRetryWithoutCanonicalUpdate: Parameters<typeof publishRetryReviewDetailsMerge>[0]["settleRetryWithoutCanonicalUpdate"];
  persistContinuationFamilyState: (
    state: ReturnType<typeof resolveMergedContinuationFamilyState>,
  ) => Promise<void>;
}): Promise<void> {
  const retryOctokit = await params.getOctokit();
  const storedCheckpoint = (await params.knowledgeStore?.getCheckpoint?.(params.reviewOutputKey)) ?? null;
  const commentIdToUpdate = storedCheckpoint?.partialCommentId ?? params.partialCommentId;

  if (!params.canPublishReviewWorkOutput(
    params.attemptId,
    "retry partial review merge",
    params.deliveryId,
  )) {
    return;
  }

  params.setPublishPhase();

  const retryReviewDetailsPublication = await publishRetryReviewDetailsMerge({
    octokit: retryOctokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    attemptId: params.attemptId,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    retryReviewOutputKey: params.retryReviewOutputKey,
    commentIdToUpdate,
    mergeBody: params.mergeContext.body,
    reviewDetailsFirstPass: params.mergeContext.reviewDetailsFirstPass,
    botHandles: [params.getAppSlug(), "claude"],
    authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
    reviewBoundedness: params.reviewBoundedness,
    baseLog: params.baseLog,
    logger: params.logger,
    canPublishReviewWorkOutput: params.canPublishReviewWorkOutput,
    renderReviewDetailsBody: params.renderReviewDetailsBody,
    settleRetryWithoutCanonicalUpdate: params.settleRetryWithoutCanonicalUpdate,
  });

  if (!retryReviewDetailsPublication.ok) {
    params.logger.warn(
      { ...params.baseLog, err: retryReviewDetailsPublication.err },
      "Retry Review Details publication failed",
    );
    return;
  }

  const retryReviewDetailsPublicationStatus = retryReviewDetailsPublication.value;
  if (retryReviewDetailsPublicationStatus.status === "settled-without-canonical-update") {
    return;
  }

  params.logger.info(
    {
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      retryConclusion: params.retryConclusion,
      retryFilesReviewed: params.mergeContext.retryFilesReviewed,
      partialCommentId: params.partialCommentId,
      settlementReason: params.settlementReason,
      projectionStatus: retryReviewDetailsPublicationStatus.projectionStatus,
    },
    retryReviewDetailsPublicationStatus.logMessage,
  );

  await params.persistContinuationFamilyState(resolveMergedContinuationFamilyState({
    attemptId: params.attemptId,
    projectionStatus: retryReviewDetailsPublicationStatus.projectionStatus,
    reviewOutputKey: params.retryReviewOutputKey,
  }));

  discardCheckpointsFailOpen(params.knowledgeStore, params.logger, [params.reviewOutputKey, params.retryReviewOutputKey]);
}
