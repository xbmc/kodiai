import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { classifyError, type ErrorCategory } from "../lib/errors.ts";
import { err, ok, type Result } from "../lib/result.ts";
import {
  buildApprovedReviewBody,
  buildReviewOutputPublicationLogFields,
  ensureReviewOutputNotPublished,
} from "../review-orchestration/review-idempotency.ts";
import {
  type CanonicalSurfaceKind,
  reconcileSupersededCanonicalSurface,
  upsertCanonicalReviewSurface,
} from "../review-orchestration/review-canonical-surface.ts";
import {
  buildExplicitMentionReviewPublishFailureBody,
  buildExplicitReviewLifecycleEvidenceLine,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import {
  mentionErrorDeliveryFromResult,
  type MentionErrorDelivery,
  type MentionErrorPostResult,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";

export type ExplicitMentionReviewPublicationResult = {
  outputPublished: boolean;
  resolution: MentionPublishResolution;
  failureCategory?: ErrorCategory;
  fallbackDelivery: MentionErrorDelivery | null;
};

export type ExplicitMentionReviewPublicationStatus = Result<
  ExplicitMentionReviewPublicationResult,
  ExplicitMentionReviewPublicationResult
>;

export async function publishExplicitMentionReviewResult(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  surface: string;
  deliveryId: string;
  installationId: number;
  reviewOutputKey: string;
  /**
   * Trigger-agnostic identity for the GitHub-visible verdict surface (see
   * buildCanonicalReviewSurfaceKey). All idempotency checks and the actual
   * GitHub write use this key -- not `reviewOutputKey` -- so an explicit
   * mention re-review finds/updates the same comment or PR review an
   * automatic push-triggered review of this commit would use, instead of
   * creating a second, contradictory one.
   */
  canonicalReviewSurfaceKey: string;
  appSlug: string;
  autoApprove: boolean;
  usedRepoInspectionTools: boolean;
  explicitReviewPromptFileCount: number | undefined;
  explicitReviewFindingLifecycleResult: Parameters<typeof buildExplicitReviewLifecycleEvidenceLine>[0];
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  postMentionError: (errorBody: string) => Promise<MentionErrorPostResult>;
  summarizeError: (error: unknown) => string;
  logger: Logger;
}): Promise<ExplicitMentionReviewPublicationStatus> {
  try {
    const idempotencyCheck = await ensureReviewOutputNotPublished({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.canonicalReviewSurfaceKey,
    });

    if (!idempotencyCheck.shouldPublish) {
      params.logger.info(
        {
          surface: params.surface,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          gate: "review-output-idempotency",
          gateResult: "skipped",
          skipReason: "already-published",
          ...buildReviewOutputPublicationLogFields(idempotencyCheck),
        },
        "Skipping explicit mention review publish because output already exists",
      );
      return ok({
        outputPublished: true,
        resolution: "idempotency-skip",
        fallbackDelivery: null,
      });
    }

    params.logger.info(
      {
        surface: params.surface,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        gate: "review-output-idempotency",
        gateResult: "accepted",
        ...buildReviewOutputPublicationLogFields(idempotencyCheck),
      },
      "Explicit mention review idempotency check passed",
    );

    params.logger.info(
      {
        surface: params.surface,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        gate: "explicit-review-publish",
        gateResult: "attempt",
        publishAttemptOutcome: "attempting-approval",
        reviewOutputKey: params.reviewOutputKey,
      },
      "Attempting explicit mention review approval publish",
    );

    const explicitReviewLifecycleEvidenceLine = buildExplicitReviewLifecycleEvidenceLine(
      params.explicitReviewFindingLifecycleResult,
    );
    const approvalEvidence = [
      typeof params.explicitReviewPromptFileCount === "number"
        ? `Review prompt covered ${params.explicitReviewPromptFileCount} changed file${params.explicitReviewPromptFileCount === 1 ? "" : "s"}.`
        : null,
      params.usedRepoInspectionTools
        ? "Repo inspection tools were used to verify the changed code."
        : null,
      explicitReviewLifecycleEvidenceLine,
    ].filter((line): line is string => Boolean(line));

    if (!params.canPublishExplicitReviewOutput("explicit mention review publish", params.canonicalReviewSurfaceKey)) {
      params.logger.info(
        {
          surface: params.surface,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          gate: "explicit-review-publish",
          gateResult: "skipped",
          skipReason: "publish-rights-lost",
          reviewOutputKey: params.reviewOutputKey,
        },
        "Skipping explicit mention review publish because publish rights were superseded",
      );
      return ok({
        outputPublished: false,
        resolution: "none",
        fallbackDelivery: null,
      });
    }

    params.setReviewWorkPhase("publish");
    const cleanReviewBody = buildApprovedReviewBody({
      reviewOutputKey: params.canonicalReviewSurfaceKey,
      evidence: approvalEvidence,
    });
    const botHandles = [params.appSlug, "claude", "kodai"];
    const cleanReviewSurfaceKind: CanonicalSurfaceKind = params.autoApprove ? "pull_review" : "issue_comment";
    const canonicalSurface = await upsertCanonicalReviewSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.canonicalReviewSurfaceKey,
      preferredKind: cleanReviewSurfaceKind,
      body: cleanReviewBody,
      botHandles,
      ...(params.autoApprove ? { pullReviewEvent: "APPROVE" as const } : {}),
      recheckCanPublish: () =>
        params.canPublishExplicitReviewOutput("explicit mention review publish", params.canonicalReviewSurfaceKey),
    });
    if (!canonicalSurface) {
      params.logger.info(
        {
          surface: params.surface,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          gate: "explicit-review-publish",
          gateResult: "skipped",
          skipReason: "publish-rights-lost-during-write",
        },
        "Skipping explicit mention review publish because publish rights were superseded mid-write",
      );
      return ok({
        outputPublished: false,
        resolution: "none",
        fallbackDelivery: null,
      });
    }
    await reconcileSupersededCanonicalSurface({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.canonicalReviewSurfaceKey,
      newSurfaceKind: cleanReviewSurfaceKind,
      botHandles,
      logger: params.logger,
    });
    const resolution: MentionPublishResolution = params.autoApprove ? "approval-bridge" : "comment-approval";
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
        publishAttemptOutcome: params.autoApprove ? "submitted-approval" : "submitted-comment",
      },
      params.autoApprove
        ? "Submitted approval review for explicit mention request"
        : "Submitted approval-shaped comment for explicit mention request",
    );
    return ok({
      outputPublished: true,
      resolution,
      fallbackDelivery: null,
    });
  } catch (publishErr) {
    const publishFailureCategory = classifyError(publishErr, false);
    params.logger.warn(
      {
        err: publishErr,
        deliveryId: params.deliveryId,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        publishAttemptOutcome:
          publishFailureCategory === "api_error" ? "github-api-rejected" : "failed",
        publishFailureCategory,
      },
      "Failed to submit approval review for explicit mention request",
    );

    let outputDetectedAfterError = false;
    try {
      const recheck = await ensureReviewOutputNotPublished({
        octokit: params.octokit,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.canonicalReviewSurfaceKey,
      });

      if (!recheck.shouldPublish) {
        outputDetectedAfterError = true;
        params.logger.info(
          {
            surface: params.surface,
            owner: params.owner,
            repo: params.repo,
            prNumber: params.prNumber,
            gate: "review-output-idempotency",
            gateResult: "recovered",
            skipReason: "output-detected-after-error",
            ...buildReviewOutputPublicationLogFields(recheck),
          },
          "Explicit mention review publish error still produced output; suppressing fallback",
        );
      }
    } catch (recheckErr) {
      params.logger.warn(
        {
          err: recheckErr,
          deliveryId: params.deliveryId,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          reviewOutputKey: params.reviewOutputKey,
          publishAttemptOutcome: "recheck-failed",
          publishFailureCategory,
        },
        "Failed to recheck explicit mention review output after publish error",
      );
    }

    if (outputDetectedAfterError) {
      return ok({
        outputPublished: true,
        resolution: "duplicate-suppressed",
        failureCategory: publishFailureCategory,
        fallbackDelivery: null,
      });
    }

    if (!params.canPublishExplicitReviewOutput("explicit mention review fallback comment", params.canonicalReviewSurfaceKey)) {
      params.logger.info(
        {
          surface: params.surface,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          gate: "explicit-review-publish",
          gateResult: "skipped",
          skipReason: "publish-rights-lost",
          reviewOutputKey: params.reviewOutputKey,
          publishFailureCategory,
        },
        "Skipping explicit mention review fallback because publish rights were superseded",
      );
      return ok({
        outputPublished: false,
        resolution: "none",
        failureCategory: publishFailureCategory,
        fallbackDelivery: null,
      });
    }

    params.setReviewWorkPhase("publish");
    const fallbackResult = await params.postMentionError(
      buildExplicitMentionReviewPublishFailureBody({
        publishErr,
        summarizeError: params.summarizeError,
      }),
    );
    const fallbackDelivery = mentionErrorDeliveryFromResult(fallbackResult);

    if (fallbackResult.ok) {
      return ok({
        outputPublished: true,
        resolution: "publish-failure-fallback",
        failureCategory: publishFailureCategory,
        fallbackDelivery,
      });
    }

    params.logger.warn(
      {
        deliveryId: params.deliveryId,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        publishAttemptOutcome: "fallback-comment-failed",
        publishFailureCategory,
        publishFallbackDelivery: fallbackDelivery,
      },
      "Explicit mention review publish fallback could not be delivered",
    );
    return err({
      outputPublished: false,
      resolution: "publish-failure-comment-failed",
      failureCategory: publishFailureCategory,
      fallbackDelivery,
    });
  }
}
