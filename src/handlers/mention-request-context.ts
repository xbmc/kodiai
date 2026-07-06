import {
  detectFormatterSuggestionRequest,
  type FormatterSuggestionRequest,
} from "./formatter-suggestion-intent.ts";
import {
  buildAcceptedMentionHandles,
  mentionBodyMatchesAcceptedHandles,
} from "./mention-handle-match.ts";
import { stripMention } from "./mention-types.ts";

type MentionRequestContextSkipReason = "handle-mismatch" | "empty-question";

export type MentionRequestContextResult =
  | {
      action: "skip";
      reason: MentionRequestContextSkipReason;
      acceptedHandles: string[];
    }
  | {
      action: "continue";
      acceptedHandles: string[];
      userQuestion: string;
      formatterSuggestionRequest: FormatterSuggestionRequest | undefined;
    };

export function resolveMentionRequestContext({
  appSlug,
  acceptClaudeAlias,
  commentBody,
}: {
  appSlug: string;
  acceptClaudeAlias: boolean;
  commentBody: string;
}): MentionRequestContextResult {
  const acceptedHandles = buildAcceptedMentionHandles({ appSlug, acceptClaudeAlias });

  if (!mentionBodyMatchesAcceptedHandles(commentBody, acceptedHandles)) {
    return {
      action: "skip",
      reason: "handle-mismatch",
      acceptedHandles,
    };
  }

  const userQuestion = stripMention(commentBody, acceptedHandles);
  if (userQuestion.trim().length === 0) {
    return {
      action: "skip",
      reason: "empty-question",
      acceptedHandles,
    };
  }

  return {
    action: "continue",
    acceptedHandles,
    userQuestion,
    formatterSuggestionRequest: detectFormatterSuggestionRequest(userQuestion),
  };
}
