import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { ok, type Result } from "../lib/result.ts";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { ExplicitMentionReviewPublishSkipReason } from "../review-orchestration/explicit-mention-review-publish.ts";
import {
  type MentionErrorDelivery,
  type MentionErrorPostResult,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import { publishMentionFailureFallback } from "./mention-failure-publication.ts";
import {
  publishMentionErrorFallback,
  publishMentionSuccessFallback,
} from "./mention-result-fallback-publication.ts";

export type MentionExecutionFallbackResult = {
  conclusion: string;
  resultText?: string;
  isTimeout?: boolean;
  errorMessage?: string;
  stopReason?: string;
  failureSubtype?: string;
};

export type MentionExecutionFallbackState = {
  mentionOutputPublished: boolean;
  publishResolution: MentionPublishResolution;
  publishFallbackDelivery: MentionErrorDelivery | null;
};

export type MentionExecutionFallbackPublicationResult = Result<MentionExecutionFallbackState>;

export async function publishMentionExecutionFallbacks(params: MentionExecutionFallbackState & {
  writeEnabled: boolean;
  reviewPublishRightsLost: boolean;
  result: MentionExecutionFallbackResult;
  explicitReviewRequest: boolean;
  hasUnpublishedFindings: boolean;
  findingLines: string[];
  skipReason: ExplicitMentionReviewPublishSkipReason | undefined;
  routingReason: string | undefined;
  reviewOutputKey: string | undefined;
  canonicalReviewSurfaceKey: string | undefined;
  surface: string;
  owner: string;
  repo: string;
  prNumber: number | undefined;
  issueNumber: number;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  postMentionReply: (replyBody: string) => Promise<void>;
  postMentionError: (errorBody: string) => Promise<MentionErrorPostResult>;
  logger: Logger;
}): Promise<MentionExecutionFallbackPublicationResult> {
  let mentionOutputPublished = params.mentionOutputPublished;
  let publishResolution = params.publishResolution;
  let publishFallbackDelivery = params.publishFallbackDelivery;

  if (
    !params.writeEnabled
    && params.result.conclusion === "success"
    && !mentionOutputPublished
    && publishResolution !== "publish-failure-comment-failed"
    && !params.reviewPublishRightsLost
  ) {
    const successFallbackPublication = await publishMentionSuccessFallback({
      explicitReviewRequest: params.explicitReviewRequest,
      hasUnpublishedFindings: params.hasUnpublishedFindings,
      findingLines: params.findingLines,
      resultText: params.result.resultText,
      skipReason: params.skipReason,
      reviewOutputKey: params.reviewOutputKey,
      canonicalReviewSurfaceKey: params.canonicalReviewSurfaceKey,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      getOctokit: params.getOctokit,
      botHandles: params.botHandles,
      setReviewWorkPhase: params.setReviewWorkPhase,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      postMentionReply: params.postMentionReply,
      logger: params.logger,
    });
    if (successFallbackPublication.ok && successFallbackPublication.value.resolution !== "skipped") {
      mentionOutputPublished = successFallbackPublication.value.published;
      publishResolution = successFallbackPublication.value.resolution;
      publishFallbackDelivery = successFallbackPublication.value.fallbackDelivery;
    }
  }

  if (params.result.conclusion === "error" && !params.reviewPublishRightsLost) {
    const errorFallbackPublication = await publishMentionErrorFallback({
      explicitReviewRequest: params.explicitReviewRequest,
      isTimeout: params.result.isTimeout,
      errorMessage: params.result.errorMessage,
      reviewOutputKey: params.reviewOutputKey,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      postMentionError: params.postMentionError,
    });
    const errorFallbackPublicationState = errorFallbackPublication.ok
      ? errorFallbackPublication.value
      : errorFallbackPublication.err;
    if (errorFallbackPublicationState.resolution !== "skipped") {
      mentionOutputPublished = errorFallbackPublicationState.published;
      publishResolution = errorFallbackPublicationState.resolution;
      publishFallbackDelivery = errorFallbackPublicationState.fallbackDelivery;
    }
  }

  if (
    params.result.conclusion === "failure"
    && !mentionOutputPublished
    && !params.reviewPublishRightsLost
  ) {
    const fallbackPublication = await publishMentionFailureFallback({
      explicitReviewRequest: params.explicitReviewRequest,
      routingReason: params.routingReason,
      stopReason: params.result.stopReason,
      failureSubtype: params.result.failureSubtype,
      reviewOutputKey: params.reviewOutputKey,
      surface: params.surface,
      issueNumber: params.issueNumber,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      postMentionError: params.postMentionError,
      logger: params.logger,
    });
    const fallbackPublicationState = fallbackPublication.ok ? fallbackPublication.value : fallbackPublication.err;
    if (fallbackPublicationState.resolution !== "skipped") {
      mentionOutputPublished = fallbackPublicationState.published;
      publishResolution = fallbackPublicationState.resolution;
      publishFallbackDelivery = fallbackPublicationState.fallbackDelivery;
    }
  }

  return ok({
    mentionOutputPublished,
    publishResolution,
    publishFallbackDelivery,
  });
}
