import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import { ok, type Result } from "../lib/result.ts";
import {
  upsertCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import type { ReviewDetailsBodyRuntimeParams } from "./review-details-body.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import {
  publishDegradedReviewDetailsFallbackFailOpen,
} from "./review-details-degraded-fallback.ts";

type UpsertCanonicalReviewSurface = typeof upsertCanonicalReviewSurface;
type PublishDegradedReviewDetailsFallbackFailOpen = typeof publishDegradedReviewDetailsFallbackFailOpen;

export type TimeoutReviewDetailsPublicationStatus = {
  delivery: "canonical-merge" | "degraded-fallback" | "skipped";
  published: boolean;
};

export type TimeoutReviewDetailsPublicationResult =
  Result<TimeoutReviewDetailsPublicationStatus, never>;

export async function publishTimeoutReviewDetailsMerge(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  partialCommentId?: number;
  partialBody: string;
  botHandles: string[];
  timeoutReviewDetailsRuntime: ReviewDetailsBodyRuntimeParams;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "warn">;
  canPublishVisibleOutput: (reason: string) => boolean;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  upsertCanonicalReviewSurfaceFn?: UpsertCanonicalReviewSurface;
  publishDegradedReviewDetailsFallbackFailOpenFn?: PublishDegradedReviewDetailsFallbackFailOpen;
}): Promise<TimeoutReviewDetailsPublicationResult> {
  const renderBody = () => params.renderReviewDetailsBody(params.timeoutReviewDetailsRuntime);

  try {
    if (!params.canPublishVisibleOutput("timeout canonical Review Details merge")) {
      return ok({ delivery: "skipped", published: false });
    }

    const upsertCanonical = params.upsertCanonicalReviewSurfaceFn ?? upsertCanonicalReviewSurface;
    await upsertCanonical({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: "issue_comment",
      canonicalSurface: params.partialCommentId
        ? { kind: "issue_comment", commentId: params.partialCommentId, body: params.partialBody }
        : undefined,
      summaryBody: params.partialBody,
      reviewDetailsBlock: renderBody(),
      botHandles: params.botHandles,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      recheckCanPublish: () =>
        params.canPublishVisibleOutput("timeout canonical Review Details merge"),
    });
    return ok({ delivery: "canonical-merge", published: true });
  } catch (reviewDetailsErr) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-details-output",
        gateResult: "degraded-fallback",
        reviewOutputKey: params.reviewOutputKey,
        err: reviewDetailsErr,
      },
      "Failed to update timeout canonical review surface with Review Details; using degraded fallback comment",
    );

    const publishFallback =
      params.publishDegradedReviewDetailsFallbackFailOpenFn ?? publishDegradedReviewDetailsFallbackFailOpen;
    const fallbackPublication = await publishFallback({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      renderBody,
      botHandles: params.botHandles,
      publishReason: "timeout degraded Review Details fallback comment",
      failureMessage: "Failed to publish degraded Review Details fallback comment for timeout partial output",
      baseLog: params.baseLog,
      logger: params.logger,
      canPublishVisibleOutput: params.canPublishVisibleOutput,
    });
    if (!fallbackPublication.ok) {
      return ok({ delivery: "degraded-fallback", published: false });
    }
    return ok(fallbackPublication.value);
  }
}
