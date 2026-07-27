import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { MergeConfidence } from "../lib/merge-confidence.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import { err as resultErr, ok, type Result } from "../lib/result.ts";
import type { VisibleBudgetProjection } from "../review-visible-budget/visible-budget-behavior.ts";
import {
  type CanonicalSurfaceKind,
  reconcileSupersededCanonicalSurface,
  upsertCanonicalReviewSurface,
  upsertDegradedReviewDetailsFallbackComment,
} from "../review-orchestration/review-canonical-surface.ts";
import { ensureReviewOutputNotPublished } from "../review-orchestration/review-idempotency.ts";
import { buildVisibleBudgetDisclosureEvidence } from "../review-orchestration/review-visible-budget-evidence.ts";
import {
  type ReviewDetailsPublicationRuntime,
  updateFinalizedReviewDetailsComment,
} from "./review-details-publication-runtime.ts";
import { buildCleanReviewApprovalBody } from "./review-clean-approval.ts";

export type CleanReviewPublicationResult =
  | { published: false; resolution: "skipped" }
  | { published: true; resolution: "auto-approval" | "clean-review-comment" };

export type CleanReviewPublicationStatus = Result<CleanReviewPublicationResult, unknown>;

export async function publishCleanReviewApproval(params: {
  resultPublished: boolean;
  autoApprove: boolean;
  getOctokit: () => Promise<Octokit>;
  getAppSlug: () => string;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  deliveryId: string;
  installationId: number;
  promptFileCount: number;
  canonicalReviewDetailsBody?: string | null;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  mergeConfidence?: MergeConfidence | null;
  logger: Pick<Logger, "info" | "error" | "warn">;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  refreshVisibleBudgetProjection: () => VisibleBudgetProjection | null;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  finalizePublicationPhaseTiming: ReviewDetailsPublicationRuntime["finalizePublicationPhaseTiming"];
  logReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logReviewDetailsPublicationCompleted"];
  logCanonicalReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logCanonicalReviewDetailsPublicationCompleted"];
}): Promise<CleanReviewPublicationStatus> {
  try {
    if (params.resultPublished) {
      params.logger.info(
        {
          prNumber: params.prNumber,
          gate: "auto-approve",
          gateResult: "skipped",
          skipReason: "output-published",
        },
        "Skipping auto-approval because review output was published",
      );
      return ok({ published: false, resolution: "skipped" });
    }

    const octokit = await params.getOctokit();
    const appSlug = params.getAppSlug();
    const botHandles = [appSlug, "claude"];

    const idempotencyCheck = await ensureReviewOutputNotPublished({
      octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
    });

    if (!idempotencyCheck.shouldPublish) {
      params.logger.info(
        {
          prNumber: params.prNumber,
          gate: "auto-approve",
          gateResult: "skipped",
          skipReason: "output-marker-present",
          existingLocation: idempotencyCheck.existingLocation,
        },
        "Skipping auto-approval because review output marker was published",
      );
      await mergeCleanReviewDetailsIntoExistingOutput({
        octokit,
        botHandles,
        idempotencyExistingLocation: idempotencyCheck.existingLocation,
        params,
      });
      return ok({ published: false, resolution: "skipped" });
    }

    const cleanReviewPublicationReason = params.autoApprove
      ? "auto-approval"
      : "clean review publication";
    if (!params.canPublishVisibleOutput(cleanReviewPublicationReason)) {
      return ok({ published: false, resolution: "skipped" });
    }

    params.setReviewWorkPhase("publish");
    const visibleBudgetDisclosureEvidence = buildVisibleBudgetDisclosureEvidence(
      params.refreshVisibleBudgetProjection(),
    );
    const approvalBody = buildCleanReviewApprovalBody({
      reviewOutputKey: params.reviewOutputKey,
      promptFileCount: params.promptFileCount,
      visibleBudgetDisclosureEvidence,
      mergeConfidence: params.mergeConfidence ?? null,
      reviewDetailsBlock: params.canonicalReviewDetailsBody,
    });

    const cleanReviewSurfaceKind: CanonicalSurfaceKind = params.autoApprove
      ? "pull_review"
      : "issue_comment";

    const canonicalApprovalReview = await upsertCanonicalReviewSurface({
      octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: cleanReviewSurfaceKind,
      body: approvalBody,
      botHandles,
      ...(params.autoApprove ? { pullReviewEvent: "APPROVE" as const } : {}),
      recheckCanPublish: () => params.canPublishVisibleOutput(cleanReviewPublicationReason),
    });

    if (canonicalApprovalReview) {
      await reconcileSupersededCanonicalSurface({
        octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        newSurfaceKind: cleanReviewSurfaceKind,
        botHandles,
        logger: params.logger,
      });
    }

    params.finalizePublicationPhaseTiming();

    if (
      canonicalApprovalReview?.kind === cleanReviewSurfaceKind
      && params.canonicalReviewDetailsBody
      && params.canPublishVisibleOutput("finalized clean review canonical Review Details merge")
    ) {
      const finalizedCleanReviewDetails = await upsertCanonicalReviewSurface({
        octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        preferredKind: cleanReviewSurfaceKind,
        reviewDetailsBlock: params.renderReviewDetailsBody(),
        botHandles,
        summaryBody: canonicalApprovalReview.body,
        canonicalSurface: canonicalApprovalReview,
        requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
        reviewBoundedness: params.reviewBoundedness,
        ...(params.autoApprove ? { pullReviewEvent: "APPROVE" as const } : {}),
        recheckCanPublish: () =>
          params.canPublishVisibleOutput("finalized clean review canonical Review Details merge"),
      });
      params.logCanonicalReviewDetailsPublicationCompleted(finalizedCleanReviewDetails);
    }

    const resolution = params.autoApprove ? "auto-approval" : "clean-review-comment";
    params.logger.info(
      {
        evidenceType: "review",
        outcome: params.autoApprove ? "submitted-approval" : "published-comment-approval",
        deliveryId: params.deliveryId,
        installationId: params.installationId,
        owner: params.owner,
        repoName: params.repo,
        repo: `${params.owner}/${params.repo}`,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
      },
      "Evidence bundle",
    );
    params.logger.info(
      { prNumber: params.prNumber, reviewOutputKey: params.reviewOutputKey },
      params.autoApprove
        ? "Submitted silent approval (no issues found)"
        : "Published clean review comment (no issues found)",
    );

    return ok({ published: true, resolution });
  } catch (err) {
    params.logger.error(
      { err, prNumber: params.prNumber },
      params.autoApprove
        ? "Failed to submit approval"
        : "Failed to publish clean review comment",
    );
    return resultErr(err);
  }
}

async function mergeCleanReviewDetailsIntoExistingOutput(input: {
  octokit: Octokit;
  botHandles: string[];
  idempotencyExistingLocation: "review-comment" | "issue-comment" | "review" | null;
  params: Parameters<typeof publishCleanReviewApproval>[0];
}): Promise<void> {
  const { params } = input;
  if (!params.canonicalReviewDetailsBody) {
    return;
  }

  if (
    input.idempotencyExistingLocation !== "review-comment" &&
    params.canPublishVisibleOutput("clean review canonical Review Details merge")
  ) {
    params.setReviewWorkPhase("publish");
    const canonicalSurfaceKind: CanonicalSurfaceKind = input.idempotencyExistingLocation === "review"
      ? "pull_review"
      : "issue_comment";
    const finalizedExistingReviewDetails = await upsertCanonicalReviewSurface({
      octokit: input.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      preferredKind: canonicalSurfaceKind,
      reviewDetailsBlock: params.canonicalReviewDetailsBody,
      botHandles: input.botHandles,
      requireDegradationDisclosure: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      ...(canonicalSurfaceKind === "pull_review" ? { pullReviewEvent: "APPROVE" as const } : {}),
      recheckCanPublish: () =>
        params.canPublishVisibleOutput("clean review canonical Review Details merge"),
    });
    params.logCanonicalReviewDetailsPublicationCompleted(finalizedExistingReviewDetails);
    params.finalizePublicationPhaseTiming();
    return;
  }

  if (!params.canPublishVisibleOutput("degraded Review Details fallback comment")) {
    return;
  }

  params.setReviewWorkPhase("publish");
  const reviewDetailsPublication = await upsertDegradedReviewDetailsFallbackComment({
    octokit: input.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    body: params.canonicalReviewDetailsBody,
    botHandles: input.botHandles,
    recheckCanPublish: () =>
      params.canPublishVisibleOutput("degraded Review Details fallback comment"),
  });
  if (!reviewDetailsPublication.ok) {
    params.logger.error(
      {
        err: reviewDetailsPublication.err.error,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
      },
      "Failed to publish clean-review degraded Review Details fallback comment",
    );
  }
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
    const finalizedUpdate = await updateFinalizedReviewDetailsComment({
      octokit: input.octokit,
      owner: params.owner,
      repo: params.repo,
      commentId: reviewDetailsCommentId,
      body: params.canonicalReviewDetailsBody,
      botHandles: input.botHandles,
    });
    if (!finalizedUpdate.ok) {
      throw finalizedUpdate.err;
    }
  }
}
