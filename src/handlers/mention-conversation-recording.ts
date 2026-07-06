import { buildMentionConversationKey } from "./mention-conversation-limit.ts";

export type MentionConversationRecordingResult =
  | { recorded: false }
  | { recorded: true; conversationKey: string };

export function recordSuccessfulMentionConversationTurn(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | undefined;
  inReplyToId: number | undefined;
  conclusion: string;
  recordSuccessfulTurn: (key: string) => number;
}): MentionConversationRecordingResult {
  if (params.inReplyToId === undefined || params.conclusion !== "success") {
    return { recorded: false };
  }

  const conversationKey = buildMentionConversationKey({
    owner: params.owner,
    repo: params.repo,
    issueNumber: params.issueNumber,
    prNumber: params.prNumber,
  });
  params.recordSuccessfulTurn(conversationKey);
  return { recorded: true, conversationKey };
}
