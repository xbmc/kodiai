import type { Logger } from "pino";
import type { ExecutionContext, ExecutionResult } from "../execution/types.ts";
import type {
  FormatterSuggestionMentionRunner,
  FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import { buildCombinedReviewAndFormatThrownMentionLogFields } from "./mention-publication-state.ts";
import type { MentionEvent } from "./mention-types.ts";

type MentionExecutionDispatchLogger = Pick<Logger, "warn" | "info">;

export async function executeMentionWithFormatterRecovery(params: {
  execute: (context: ExecutionContext) => Promise<ExecutionResult>;
  context: ExecutionContext;
  isCombinedFormatterSuggestionRequest: boolean;
  mention: MentionEvent;
  deliveryId: string;
  reviewOutputAction: string;
  runFormatterSuggestionForMention: FormatterSuggestionMentionRunner;
  postFormatterVisibleDiagnostic: FormatterSuggestionVisibleDiagnosticPoster;
  classifyFailure: (error: unknown) => unknown;
  logger: MentionExecutionDispatchLogger;
}): Promise<ExecutionResult> {
  try {
    return await params.execute(params.context);
  } catch (err) {
    if (params.isCombinedFormatterSuggestionRequest) {
      params.logger.warn(
        {
          surface: params.mention.surface,
          owner: params.mention.owner,
          repo: params.mention.repo,
          prNumber: params.mention.prNumber,
          formatterSuggestionRequest: true,
          formatterMode: "review-and-format",
          reviewConclusion: "threw",
          failureCategory: params.classifyFailure(err),
        },
        "Combined review-and-format review executor threw before formatter subflow",
      );
      const formatterResult = await params.runFormatterSuggestionForMention("review-and-format");
      const { visibleReplyPosted, visibleReplyFailed } = await params.postFormatterVisibleDiagnostic({
        formatterResult,
        formatterMode: "review-and-format",
      });
      params.logger.info(
        buildCombinedReviewAndFormatThrownMentionLogFields({
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
        "Combined review-and-format formatter subflow completed after review executor threw",
      );
    }
    throw err;
  }
}
