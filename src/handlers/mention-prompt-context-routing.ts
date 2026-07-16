import {
  isCodeSeekingMentionRequest,
  isDiffSeekingMentionRequest,
  isReviewRequest,
} from "./mention-request-classification.ts";

export type MentionPromptContextRouting = {
  allowIssueCodePointers: boolean;
  allowPrDiffContext: boolean;
  includeIssueCorpus: boolean;
};

export function resolveMentionPromptContextRouting(params: {
  isIssueThreadComment: boolean;
  prNumber: number | undefined;
  writeRequest: string;
}): MentionPromptContextRouting {
  const isPrMention = params.prNumber !== undefined;
  const isPrContextSeekingRequest = isPrMention && (
    isReviewRequest(params.writeRequest) ||
    isCodeSeekingMentionRequest(params.writeRequest) ||
    isDiffSeekingMentionRequest(params.writeRequest)
  );

  return {
    allowIssueCodePointers:
      params.isIssueThreadComment && isCodeSeekingMentionRequest(params.writeRequest),
    allowPrDiffContext: isPrContextSeekingRequest,
    includeIssueCorpus: !isPrMention,
  };
}
