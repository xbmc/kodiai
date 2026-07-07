import {
  type FormatterSuggestionMentionRunner,
  type FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import {
  buildFormatOnlyMentionLogFields,
} from "./mention-publication-state.ts";
import type { MentionEvent } from "./mention-types.ts";

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
}): Promise<boolean> {
  if (!params.isPrSurface || params.formatterSuggestionMode !== "format-only") {
    return false;
  }

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

  return true;
}
