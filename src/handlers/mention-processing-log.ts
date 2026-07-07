import type { Logger } from "pino";
import type { MentionEvent } from "./mention-types.ts";

export function logMentionProcessing(params: {
  logger: Pick<Logger, "info">;
  mention: Pick<
    MentionEvent,
    "surface" | "owner" | "repo" | "issueNumber" | "prNumber" | "commentAuthor"
  >;
  acceptClaudeAlias: boolean;
}): void {
  params.logger.info(
    {
      surface: params.mention.surface,
      owner: params.mention.owner,
      repo: params.mention.repo,
      issueNumber: params.mention.issueNumber,
      prNumber: params.mention.prNumber,
      commentAuthor: params.mention.commentAuthor,
      acceptClaudeAlias: params.acceptClaudeAlias,
    },
    "Processing mention",
  );
}
