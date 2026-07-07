import {
  type FormatterSuggestionMentionRunner,
  type FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import { err, ok, type Result } from "../lib/result.ts";
import {
  buildCombinedReviewAndFormatMentionLogFields,
  type MentionErrorDelivery,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import type { MentionEvent } from "./mention-types.ts";

export type CombinedReviewAndFormatMentionFormatterPublicationValue = {
  handled: boolean;
  visibleReplyPosted: boolean;
  visibleReplyFailed: boolean;
};

export type CombinedReviewAndFormatMentionFormatterPublicationError = {
  handled: true;
  error: unknown;
};

export type CombinedReviewAndFormatMentionFormatterPublicationResult = Result<
  CombinedReviewAndFormatMentionFormatterPublicationValue,
  CombinedReviewAndFormatMentionFormatterPublicationError
>;

export async function publishCombinedReviewAndFormatMentionFormatterResult(params: {
  enabled: boolean;
  runFormatterSuggestionForMention: FormatterSuggestionMentionRunner;
  postFormatterVisibleDiagnostic: FormatterSuggestionVisibleDiagnosticPoster;
  mention: MentionEvent;
  deliveryId: string;
  reviewOutputAction: string;
  result: {
    conclusion: string;
    stopReason?: string;
    failureSubtype?: string;
  };
  publishResolution: MentionPublishResolution;
  publishFailureCategory: unknown;
  publishFallbackDelivery: MentionErrorDelivery | null;
  logger: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
}): Promise<CombinedReviewAndFormatMentionFormatterPublicationResult> {
  if (!params.enabled) {
    return ok({ handled: false, visibleReplyPosted: false, visibleReplyFailed: false });
  }

  try {
    const formatterResult = await params.runFormatterSuggestionForMention("review-and-format");
    const { visibleReplyPosted, visibleReplyFailed } = await params.postFormatterVisibleDiagnostic({
      formatterResult,
      formatterMode: "review-and-format",
    });

    params.logger.info(
      buildCombinedReviewAndFormatMentionLogFields({
        mention: {
          surface: params.mention.surface,
          owner: params.mention.owner,
          repo: params.mention.repo,
          issueNumber: params.mention.issueNumber,
          prNumber: params.mention.prNumber,
        },
        deliveryId: params.deliveryId,
        reviewOutputAction: params.reviewOutputAction,
        result: params.result,
        publishResolution: params.publishResolution,
        publishFailureCategory: params.publishFailureCategory,
        publishFallbackDelivery: params.publishFallbackDelivery,
        formatterResult,
        visibleReplyPosted,
        visibleReplyFailed,
      }),
      "Combined review-and-format mention request completed",
    );

    return ok({ handled: true, visibleReplyPosted, visibleReplyFailed });
  } catch (error) {
    return err({ handled: true, error });
  }
}
