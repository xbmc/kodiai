import type { GitHubApp } from "../auth/github-app.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import { classifyError } from "../lib/errors.ts";
import { err, ok, type Result } from "../lib/result.ts";
import type {
  ExplicitMentionReviewPublishSkipReason,
} from "../review-orchestration/explicit-mention-review-publish.ts";
import type { MentionEvent } from "./mention-types.ts";
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
  resolution: Extract<MentionPublishResolution, "error-fallback"> | "skipped";
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

export async function publishMentionSuccessFallback(params: {
  explicitReviewRequest: boolean;
  hasUnpublishedFindings: boolean;
  findingLines: string[];
  resultText: string | undefined;
  skipReason: ExplicitMentionReviewPublishSkipReason | undefined;
  reviewOutputKey: string | undefined;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  postMentionReply: (replyBody: string) => Promise<void>;
}): Promise<boolean> {
  if (
    params.explicitReviewRequest &&
    !params.canPublishExplicitReviewOutput("explicit mention review fallback reply", params.reviewOutputKey)
  ) {
    return false;
  }

  const fallbackBody = buildMentionSuccessFallbackBody({
    explicitReviewRequest: params.explicitReviewRequest,
    hasUnpublishedFindings: params.hasUnpublishedFindings,
    findingLines: params.findingLines,
    resultText: params.resultText,
    skipReason: params.skipReason,
  });
  await params.postMentionReply(fallbackBody);
  return true;
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
}): Promise<void> {
  if (
    params.explicitReviewRequest &&
    !params.canPublishExplicitReviewOutput(
      "explicit mention review handler failure error comment",
      params.reviewOutputKey,
    )
  ) {
    return;
  }

  const category = classifyError(params.error, false);
  const detail = params.error instanceof Error ? params.error.message : "An unexpected error occurred";
  const errorBody = buildMentionErrorFallbackBody({ category, detail });
  await postMentionHandlerError({
    githubApp: params.githubApp,
    installationId: params.installationId,
    mention: params.mention,
    possibleHandles: params.possibleHandles,
    logger: params.logger,
    guardrailAuditStore: params.guardrailAuditStore,
    errorBody,
  });
}
