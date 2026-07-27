import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import { classifyError } from "../lib/errors.ts";
import { err, ok, type Result } from "../lib/result.ts";
import { buildReviewOutputMarker } from "../review-orchestration/review-idempotency.ts";
import type {
  ExplicitMentionReviewPublishSkipReason,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import type { MentionEvent } from "./mention-types.ts";
import { publishBlockedReviewFindingsNotice } from "./review-blocked-findings-notice.ts";
import {
  mentionErrorDeliveryFromResult,
  type MentionErrorDelivery,
  type MentionErrorPostResult,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import { postMentionHandlerError } from "./mention-publication.ts";
import {
  buildMentionErrorFallbackBody,
  buildMentionSuccessFallbackBody,
} from "./mention-success-fallback.ts";

export type MentionErrorFallbackPublicationResult = {
  published: boolean;
  resolution: Extract<MentionPublishResolution, "success-fallback" | "error-fallback"> | "skipped";
  fallbackDelivery: MentionErrorDelivery | null;
};

export type MentionErrorFallbackPublicationError = {
  published: false;
  resolution: Extract<MentionPublishResolution, "error-comment-failed">;
  fallbackDelivery: MentionErrorDelivery;
};

export type MentionErrorFallbackPublicationStatus = Result<
  MentionErrorFallbackPublicationResult,
  MentionErrorFallbackPublicationError
>;

export type MentionSuccessFallbackPublicationStatus = Result<MentionErrorFallbackPublicationResult>;

export type MentionHandlerFailureErrorPublicationValue = {
  published: boolean;
  resolution: "handler-failure-error" | "skipped";
};

export type MentionHandlerFailureErrorPublicationError = {
  published: false;
  resolution: "handler-failure-error-failed";
  error: unknown;
};

export type MentionHandlerFailureErrorPublicationStatus = Result<
  MentionHandlerFailureErrorPublicationValue,
  MentionHandlerFailureErrorPublicationError
>;

export async function publishMentionSuccessFallback(params: {
  explicitReviewRequest: boolean;
  hasUnpublishedFindings: boolean;
  findingLines: string[];
  resultText: string | undefined;
  skipReason: ExplicitMentionReviewPublishSkipReason | undefined;
  reviewOutputKey: string | undefined;
  canonicalReviewSurfaceKey: string | undefined;
  owner: string;
  repo: string;
  prNumber: number | undefined;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  postMentionReply: (replyBody: string) => Promise<void>;
  logger: Pick<Logger, "info" | "warn">;
}): Promise<MentionSuccessFallbackPublicationStatus> {
  if (
    params.explicitReviewRequest &&
    !params.canPublishExplicitReviewOutput("explicit mention review fallback reply", params.reviewOutputKey)
  ) {
    return ok({
      published: false,
      resolution: "skipped",
      fallbackDelivery: null,
    });
  }

  // A NOT-APPROVED verdict with concrete findings must go through the same canonical
  // marker system the automatic pipeline and the mention approval path use -- not a
  // plain unmarked reply -- so it can be found/reconciled instead of leaving a second,
  // disconnected surface for the same commit (see xbmc/xbmc#28648).
  if (
    params.explicitReviewRequest
    && params.hasUnpublishedFindings
    && params.findingLines.length > 0
    && params.canonicalReviewSurfaceKey
    && params.prNumber !== undefined
  ) {
    const body = [
      "Decision: NOT APPROVED",
      "",
      "Issues:",
      ...params.findingLines,
      "",
      buildReviewOutputMarker(params.canonicalReviewSurfaceKey),
    ].join("\n");
    const published = await publishBlockedReviewFindingsNotice({
      octokit: await params.getOctokit(),
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.canonicalReviewSurfaceKey,
      body,
      botHandles: params.botHandles,
      logger: params.logger,
      canPublishVisibleOutput: (reason) =>
        params.canPublishExplicitReviewOutput(reason, params.canonicalReviewSurfaceKey),
      setReviewWorkPhase: params.setReviewWorkPhase,
    });
    return ok({
      published,
      resolution: published ? "success-fallback" : "skipped",
      fallbackDelivery: null,
    });
  }

  const fallbackBody = buildMentionSuccessFallbackBody({
    explicitReviewRequest: params.explicitReviewRequest,
    hasUnpublishedFindings: params.hasUnpublishedFindings,
    findingLines: params.findingLines,
    resultText: params.resultText,
    skipReason: params.skipReason,
  });
  await params.postMentionReply(fallbackBody);
  return ok({
    published: true,
    resolution: "success-fallback",
    fallbackDelivery: null,
  });
}

export async function publishMentionErrorFallback(params: {
  explicitReviewRequest: boolean;
  isTimeout: boolean | undefined;
  errorMessage: string | undefined;
  reviewOutputKey: string | undefined;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  postMentionError: (errorBody: string) => Promise<MentionErrorPostResult>;
}): Promise<MentionErrorFallbackPublicationStatus> {
  if (
    params.explicitReviewRequest &&
    !params.canPublishExplicitReviewOutput("explicit mention review error fallback", params.reviewOutputKey)
  ) {
    return ok({
      published: false,
      resolution: "skipped",
      fallbackDelivery: null,
    });
  }

  const category = params.isTimeout
    ? "timeout"
    : classifyError(new Error(params.errorMessage ?? "Unknown error"), false);
  const errorBody = buildMentionErrorFallbackBody({
    category,
    detail: params.errorMessage ?? "An unexpected error occurred while processing your request.",
  });
  const fallbackResult = await params.postMentionError(errorBody);
  const fallbackDelivery = mentionErrorDeliveryFromResult(fallbackResult);
  if (fallbackResult.ok) {
    return ok({
      published: true,
      resolution: "error-fallback",
      fallbackDelivery,
    });
  }

  return err({
    published: false,
    resolution: "error-comment-failed",
    fallbackDelivery,
  });
}

export async function publishMentionHandlerFailureError(params: {
  githubApp: GitHubApp;
  installationId: number;
  mention: MentionEvent;
  possibleHandles: string[];
  guardrailAuditStore?: GuardrailAuditStore;
  explicitReviewRequest: boolean;
  reviewOutputKey: string | undefined;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  logger: Parameters<typeof postMentionHandlerError>[0]["logger"];
  error: unknown;
  postMentionHandlerError?: typeof postMentionHandlerError;
}): Promise<MentionHandlerFailureErrorPublicationStatus> {
  if (
    params.explicitReviewRequest &&
    !params.canPublishExplicitReviewOutput(
      "explicit mention review handler failure error comment",
      params.reviewOutputKey,
    )
  ) {
    return ok({
      published: false,
      resolution: "skipped",
    });
  }

  const category = classifyError(params.error, false);
  const detail = params.error instanceof Error ? params.error.message : "An unexpected error occurred";
  const errorBody = buildMentionErrorFallbackBody({ category, detail });
  const publishHandlerError = params.postMentionHandlerError ?? postMentionHandlerError;
  try {
    await publishHandlerError({
      githubApp: params.githubApp,
      installationId: params.installationId,
      mention: params.mention,
      possibleHandles: params.possibleHandles,
      logger: params.logger,
      guardrailAuditStore: params.guardrailAuditStore,
      errorBody,
    });
  } catch (error) {
    return err({
      published: false,
      resolution: "handler-failure-error-failed",
      error,
    });
  }

  return ok({
    published: true,
    resolution: "handler-failure-error",
  });
}
