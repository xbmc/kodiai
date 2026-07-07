import type { Logger } from "pino";
import { ok, type Result } from "../lib/result.ts";
import type { MentionEvent } from "./mention-types.ts";
import { buildWriteDisabledReply } from "./mention-write-replies.ts";

export type DisabledWriteModeRefusalStatus =
  | { status: "skipped"; refused: false }
  | { status: "refused"; refused: true };

export type DisabledWriteModeRefusalResult = Result<DisabledWriteModeRefusalStatus, never>;

export async function maybePublishDisabledWriteModeRefusal(params: {
  isWriteRequest: boolean;
  isPlanOnly: boolean;
  writeEnabled: boolean;
  mention: MentionEvent;
  keyword: string | null | undefined;
  writeKeyword: string;
  writeRequest: string;
  appSlug: string;
  logger: Pick<Logger, "info">;
  postMentionReply: (replyBody: string, options?: { sanitizeMentions?: boolean }) => Promise<void>;
}): Promise<DisabledWriteModeRefusalResult> {
  if (!params.isWriteRequest || params.isPlanOnly || params.writeEnabled) {
    return ok({ status: "skipped", refused: false });
  }

  params.logger.info(
    {
      surface: params.mention.surface,
      owner: params.mention.owner,
      repo: params.mention.repo,
      issueNumber: params.mention.issueNumber,
      prNumber: params.mention.prNumber,
      commentAuthor: params.mention.commentAuthor,
      keyword: params.keyword,
      gate: "write-mode",
      gateResult: "skipped",
      skipReason: "write-disabled",
    },
    "Write intent detected but write-mode disabled; refusing to apply changes",
  );

  const retryCommand =
    params.writeRequest.trim().length > 0
      ? `@${params.appSlug} ${params.writeKeyword}: ${params.writeRequest}`
      : `@${params.appSlug} ${params.writeKeyword}: <same request>`;

  await params.postMentionReply(
    buildWriteDisabledReply({ retryCommand }),
    { sanitizeMentions: false },
  );
  return ok({ status: "refused", refused: true });
}
