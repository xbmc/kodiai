import {
  type FormatterSuggestionMentionRunner,
  type FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import {
  buildCombinedReviewAndFormatMentionLogFields,
  type MentionErrorDelivery,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import type { MentionEvent } from "./mention-types.ts";

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
}): Promise<boolean> {
  if (!params.enabled) {
    return false;
  }

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

  return true;
}
