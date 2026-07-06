export type MentionConversationLimitInput = {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | undefined;
  inReplyToId: number | undefined;
  maxTurnsPerPr: number;
  getTurns: (key: string) => number;
};

export type MentionConversationLimitResult =
  | { limited: false }
  | { limited: true; replyBody: string };

export function buildMentionConversationKey(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | undefined;
}): string {
  return `${params.owner}/${params.repo}#${params.prNumber ?? params.issueNumber}`;
}

export function evaluateMentionConversationLimit(
  input: MentionConversationLimitInput,
): MentionConversationLimitResult {
  if (input.inReplyToId === undefined) {
    return { limited: false };
  }

  const conversationKey = buildMentionConversationKey(input);
  const turns = input.getTurns(conversationKey);
  if (turns < input.maxTurnsPerPr) {
    return { limited: false };
  }

  return {
    limited: true,
    replyBody: [
      `Conversation limit reached (${input.maxTurnsPerPr} turns per PR).`,
      "Start a new thread or open a new issue for further questions.",
    ].join("\n"),
  };
}
