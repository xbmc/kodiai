import {
  type FormatterSuggestionMentionRunner,
  type FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import { err, ok, type Result } from "../lib/result.ts";
import {
  buildFormatOnlyMentionLogFields,
} from "./mention-publication-state.ts";
import type { MentionEvent } from "./mention-types.ts";

export type FormatOnlyMentionFormatterPublicationValue = {
  handled: boolean;
  visibleReplyPosted: boolean;
  visibleReplyFailed: boolean;
};

export type FormatOnlyMentionFormatterPublicationError = {
  handled: true;
  error: unknown;
};

export type FormatOnlyMentionFormatterPublicationResult = Result<
  FormatOnlyMentionFormatterPublicationValue,
  FormatOnlyMentionFormatterPublicationError
>;

export async function publishFormatOnlyMentionFormatterResult(params: {
  isPrSurface: boolean;
  formatterSuggestionMode: "format-only" | "review-and-format" | undefined;
  runFormatterSuggestionForMention: FormatterSuggestionMentionRunner;
  postFormatterVisibleDiagnostic: FormatterSuggestionVisibleDiagnosticPoster;
  mention: MentionEvent;
  deliveryId: string;
  reviewOutputAction: string;
  logger: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
}): Promise<FormatOnlyMentionFormatterPublicationResult> {
  if (!params.isPrSurface || params.formatterSuggestionMode !== "format-only") {
    return ok({ handled: false, visibleReplyPosted: false, visibleReplyFailed: false });
  }

  try {
    const formatterResult = await params.runFormatterSuggestionForMention("format-only");
    const { visibleReplyPosted, visibleReplyFailed } = await params.postFormatterVisibleDiagnostic({
      formatterResult,
      formatterMode: "format-only",
    });

    params.logger.info(
      buildFormatOnlyMentionLogFields({
        mention: {
          surface: params.mention.surface,
          owner: params.mention.owner,
          repo: params.mention.repo,
          issueNumber: params.mention.issueNumber,
          prNumber: params.mention.prNumber,
        },
        deliveryId: params.deliveryId,
        reviewOutputAction: params.reviewOutputAction,
        formatterResult,
        visibleReplyPosted,
        visibleReplyFailed,
      }),
      "Format-only formatter suggestion request completed",
    );

    return ok({ handled: true, visibleReplyPosted, visibleReplyFailed });
  } catch (error) {
    return err({ handled: true, error });
  }
}
