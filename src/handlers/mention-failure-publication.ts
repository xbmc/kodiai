import type { Logger } from "pino";
import { err, ok, type Result } from "../lib/result.ts";
import {
  mentionErrorDeliveryFromResult,
  type MentionErrorDelivery,
  type MentionErrorPostResult,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import { buildMentionFailureFallbackBody } from "./mention-success-fallback.ts";

export type MentionFailureFallbackPublicationResult = {
  published: boolean;
  resolution: Extract<
    MentionPublishResolution,
    "turn-limit-fallback" | "failure-fallback"
  > | "skipped";
  fallbackDelivery: MentionErrorDelivery | null;
};

export type MentionFailureFallbackPublicationError = {
  published: false;
  resolution: Extract<
    MentionPublishResolution,
    "turn-limit-fallback-failed" | "failure-fallback-failed"
  > | "skipped";
  fallbackDelivery: MentionErrorDelivery | null;
};

export type MentionFailureFallbackPublicationStatus = Result<
  MentionFailureFallbackPublicationResult,
  MentionFailureFallbackPublicationError
>;

export async function publishMentionFailureFallback(params: {
  explicitReviewRequest: boolean;
  routingReason: string | undefined;
  stopReason: string | undefined;
  failureSubtype: string | undefined;
  reviewOutputKey: string | undefined;
  surface: string;
  issueNumber: number;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
  postMentionError: (errorBody: string) => Promise<MentionErrorPostResult>;
  logger: Logger;
}): Promise<MentionFailureFallbackPublicationStatus> {
  const exhaustedTurnBudget =
    params.stopReason === "max_turns"
    || params.failureSubtype === "error_max_turns";

  if (
    params.explicitReviewRequest
    && !params.canPublishExplicitReviewOutput("explicit mention review failure fallback", params.reviewOutputKey)
  ) {
    return ok({
      published: false,
      resolution: "skipped",
      fallbackDelivery: null,
    });
  }

  const failureFallbackBody = buildMentionFailureFallbackBody({
    explicitReviewRequest: params.explicitReviewRequest,
    exhaustedTurnBudget,
    routingReason: params.routingReason,
  });

  try {
    const fallbackResult = await params.postMentionError(failureFallbackBody);
    const fallbackDelivery = mentionErrorDeliveryFromResult(fallbackResult);

    if (exhaustedTurnBudget) {
      if (fallbackResult.ok) {
        return ok({
          published: true,
          resolution: "turn-limit-fallback",
          fallbackDelivery,
        });
      }

      return err({
        published: false,
        resolution: "turn-limit-fallback-failed",
        fallbackDelivery,
      });
    }

    if (fallbackResult.ok) {
      return ok({
        published: true,
        resolution: "failure-fallback",
        fallbackDelivery,
      });
    }

    return err({
      published: false,
      resolution: "failure-fallback-failed",
      fallbackDelivery,
    });
  } catch (postErr) {
    if (exhaustedTurnBudget) {
      params.logger.warn(
        { err: postErr, surface: params.surface, issueNumber: params.issueNumber },
        "Failed to post turn-limit notice (non-blocking)",
      );
    } else {
      params.logger.warn(
        { err: postErr, surface: params.surface, issueNumber: params.issueNumber, stopReason: params.stopReason },
        "Failed to post failure fallback notice (non-blocking)",
      );
    }

    return err({
      published: false,
      resolution: "skipped",
      fallbackDelivery: null,
    });
  }
}
