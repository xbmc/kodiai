import { buildPrContextRequiredReply } from "./mention-write-replies.ts";

export type MentionWriteContextGateInput = {
  isWriteRequest: boolean;
  isIssueThreadComment: boolean;
  prNumber: number | undefined;
};

export type MentionWriteContextGateResult =
  | { allowed: true }
  | {
    allowed: false;
    replyBody: string;
    replyOptions: { sanitizeMentions: false };
  };

export function evaluateMentionWriteContextGate(
  input: MentionWriteContextGateInput,
): MentionWriteContextGateResult {
  if (!input.isWriteRequest || input.prNumber !== undefined || input.isIssueThreadComment) {
    return { allowed: true };
  }

  return {
    allowed: false,
    replyBody: buildPrContextRequiredReply(),
    replyOptions: { sanitizeMentions: false },
  };
}
