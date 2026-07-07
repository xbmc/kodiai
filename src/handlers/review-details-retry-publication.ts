import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import {
  upsertCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import type { ContinuationFamilyProjectionStatus } from "../knowledge/types.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import {
  publishDegradedReviewDetailsFallbackFailOpen,
} from "./review-details-degraded-fallback.ts";

type UpsertCanonicalReviewSurface = typeof upsertCanonicalReviewSurface;
type PublishDegradedReviewDetailsFallbackFailOpen = typeof publishDegradedReviewDetailsFallbackFailOpen;

export type RetryReviewDetailsPublicationResult =
  | {
    status: "published";
    projectionStatus: ContinuationFamilyProjectionStatus;
    logMessage: string;
  }
  | { status: "settled-without-canonical-update" };

export async function publishRetryReviewDetailsMerge(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  attemptId: string;
  deliveryId: string;
  reviewOutputKey: string;
  retryReviewOutputKey: string;
  commentIdToUpdate?: number;
  mergeBody: string;
  reviewDetailsFirstPass: ReviewFirstPassPayload | null;
  botHandles: string[];
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "warn">;
  canPublishReviewWorkOutput: (attemptId: string, reason: string, deliveryId: string) => boolean;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  settleRetryWithoutCanonicalUpdate: (params: {
    attemptId: string;
    reviewOutputKey: string;
    deliveryId: string;
    reason: "publish-superseded";
    logMessage: string;
  }) => Promise<void>;
  upsertCanonicalReviewSurfaceFn?: UpsertCanonicalReviewSurface;
  publishDegradedReviewDetailsFallbackFailOpenFn?: PublishDegradedReviewDetailsFallbackFailOpen;
}): Promise<RetryReviewDetailsPublicationResult> {
  const canonicalLogMessage = params.commentIdToUpdate
    ? "Retry complete -- updated partial review comment with merged results"
    : "Retry complete -- published final review comment with merged results";

  const degradedLogMessage = params.commentIdToUpdate
    ? "Retry complete -- updated partial review comment with merged results; Review Details published via degraded fallback comment"
    : "Retry complete -- published final review comment with merged results; Review Details published via degraded fallback comment";

  const renderBody = () =>
    params.renderReviewDetailsBody({
      reviewFirstPass: params.reviewDetailsFirstPass,
    });

  try {
    const upsertCanonical = params.upsertCanonicalReviewSurfaceFn ?? upsertCanonicalReviewSurface;
    const mergedBodyWithDetails = await upsertCanonical({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: "issue_comment",
      canonicalSurface: params.commentIdToUpdate
        ? {
            kind: "issue_comment",
            commentId: params.commentIdToUpdate,
            body: params.mergeBody,
          }
        : undefined,
      summaryBody: params.mergeBody,
      reviewDetailsBlock: renderBody(),
      botHandles: params.botHandles,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      recheckCanPublish: () =>
        params.canPublishReviewWorkOutput(
          params.attemptId,
          "retry canonical Review Details merge",
          params.deliveryId,
        ),
    });

    if (!mergedBodyWithDetails) {
      await params.settleRetryWithoutCanonicalUpdate({
        attemptId: params.attemptId,
        reviewOutputKey: params.retryReviewOutputKey,
        deliveryId: params.deliveryId,
        reason: "publish-superseded",
        logMessage: "Retry settlement skipped because publish rights were superseded",
      });
      return { status: "settled-without-canonical-update" };
    }

    return {
      status: "published",
      projectionStatus: "canonical",
      logMessage: canonicalLogMessage,
    };
  } catch (reviewDetailsErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "degraded-fallback",
        reviewOutputKey: params.reviewOutputKey,
        err: reviewDetailsErr,
      },
      "Failed to update retry canonical review surface with Review Details; using degraded fallback comment",
    );

    const publishFallback =
      params.publishDegradedReviewDetailsFallbackFailOpenFn ?? publishDegradedReviewDetailsFallbackFailOpen;
    await publishFallback({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      renderBody,
      botHandles: params.botHandles,
      publishReason: "retry degraded Review Details fallback comment",
      failureMessage: "Failed to publish degraded Review Details fallback comment after retry merge",
      baseLog: params.baseLog,
      logger: params.logger,
      canPublishVisibleOutput: (reason) =>
        params.canPublishReviewWorkOutput(params.attemptId, reason, params.deliveryId),
    });

    return {
      status: "published",
      projectionStatus: "degraded",
      logMessage: degradedLogMessage,
    };
  }
}
