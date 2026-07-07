import type { MentionEvent } from "./mention-types.ts";
import {
  detectImplicitIssueIntent,
  detectImplicitPrPatchIntent,
  isReviewRequest,
} from "./mention-request-classification.ts";
import {
  resolveMentionWriteIntent,
  type MentionWriteIntent,
} from "./mention-write-formatters.ts";
import { buildMentionWriteContext } from "./mention-write-keys.ts";

export type MentionWriteRequestContext = ReturnType<typeof resolveMentionWriteRequestContext>;

export function resolveMentionWriteRequestContext(params: {
  eventName: string;
  installationId: number;
  appSlug: string;
  mention: Pick<MentionEvent, "owner" | "repo" | "issueNumber" | "prNumber" | "commentId">;
  userQuestion: string;
  formatterSuggestionRequestMode?: string;
  writeConfigEnabled: boolean;
}): {
  isIssueThreadComment: boolean;
  isPrSurface: boolean;
  explicitReviewRequest: boolean;
  writeIntent: MentionWriteIntent;
  isWriteRequest: boolean;
  isPlanOnly: boolean;
  writeEnabled: boolean;
  writeKeyword: string;
  retryCommand: string;
  triggerCommentUrl: string;
  writeBranchName?: string;
  writeOutputKey?: string;
  writeSource: { type: "pr" | "issue"; number: number };
} {
  const isIssueThreadComment = params.eventName === "issue_comment" && params.mention.prNumber === undefined;
  const isPrSurface = params.mention.prNumber !== undefined;
  const explicitReviewRequest = isPrSurface && (
    isReviewRequest(params.userQuestion) || params.formatterSuggestionRequestMode === "review-and-format"
  );
  const writeIntent = resolveMentionWriteIntent({
    userQuestion: params.userQuestion,
    isIssueThreadComment,
    isPrSurface,
    formatterSuggestionRequestMode: params.formatterSuggestionRequestMode,
    detectImplicitIssueIntent,
    detectImplicitPrPatchIntent,
    isReviewRequest,
  });

  const isWriteRequest = writeIntent.writeIntent;
  const isPlanOnly = writeIntent.keyword === "plan";
  const writeEnabled = isWriteRequest && !isPlanOnly && params.writeConfigEnabled;
  const writeKeyword = writeIntent.keyword ?? "apply";
  const writeContext = buildMentionWriteContext({
    writeEnabled,
    writeKeyword,
    writeRequest: writeIntent.request,
    installationId: params.installationId,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    commentId: params.mention.commentId,
    appSlug: params.appSlug,
  });

  return {
    isIssueThreadComment,
    isPrSurface,
    explicitReviewRequest,
    writeIntent,
    isWriteRequest,
    isPlanOnly,
    writeEnabled,
    writeKeyword,
    ...writeContext,
  };
}
