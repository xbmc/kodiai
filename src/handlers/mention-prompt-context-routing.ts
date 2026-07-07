import { isCodeSeekingMentionRequest } from "./mention-request-classification.ts";

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

  return {
    allowIssueCodePointers:
      params.isIssueThreadComment && isCodeSeekingMentionRequest(params.writeRequest),
    allowPrDiffContext: isPrMention,
    includeIssueCorpus: !isPrMention,
  };
}
