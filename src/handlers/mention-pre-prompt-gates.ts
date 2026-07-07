import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { MentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";
import type { MentionEvent } from "./mention-types.ts";
import { evaluateMentionWritePreflight } from "./mention-write-preflight.ts";
import { evaluateMentionWriteContextGate } from "./mention-write-context-gate.ts";
import { maybePublishDisabledWriteModeRefusal } from "./mention-write-disabled.ts";
import { evaluateMentionConversationLimit } from "./mention-conversation-limit.ts";
import { logMentionProcessing } from "./mention-processing-log.ts";
import { postMentionEyesReaction } from "./mention-reactions.ts";

export type MentionPrePromptGateResult =
  | { action: "continue"; acquiredWriteKey: string | undefined }
  | { action: "stop"; acquiredWriteKey: string | undefined };

export async function runMentionPrePromptGates(params: {
  writeEnabled: boolean;
  writeOutputKey: string | undefined;
  writeBranchName: string | undefined;
  octokit: Octokit;
  mention: MentionEvent;
  deliveryId: string;
  installationId: number;
  triggerCommentUrl: string | undefined;
  inFlightWriteKeys: Set<string>;
  writeRateLimit: MentionWriteRateLimitRuntime;
  postMentionReply: (replyBody: string, options?: { sanitizeMentions?: boolean }) => Promise<void>;
  logger: Pick<Logger, "info" | "warn" | "debug">;
  isWriteRequest: boolean;
  isIssueThreadComment: boolean;
  isPlanOnly: boolean;
  writeConfigEnabled: boolean;
  writeIntentKeyword: string | null | undefined;
  writeKeyword: string;
  writeRequest: string;
  appSlug: string;
  maxTurnsPerPr: number;
  getConversationTurns: (key: string) => number;
  acceptClaudeAlias: boolean;
}): Promise<MentionPrePromptGateResult> {
  const writePreflight = await evaluateMentionWritePreflight({
    writeEnabled: params.writeEnabled,
    writeOutputKey: params.writeOutputKey,
    writeBranchName: params.writeBranchName,
    octokit: params.octokit,
    mention: params.mention,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    triggerCommentUrl: params.triggerCommentUrl,
    inFlightWriteKeys: params.inFlightWriteKeys,
    writeRateLimit: params.writeRateLimit,
    postMentionReply: params.postMentionReply,
    logger: params.logger,
  });
  const acquiredWriteKey = writePreflight.acquiredWriteKey;
  if (writePreflight.action === "stop") {
    return { action: "stop", acquiredWriteKey };
  }

  const writeContextGate = evaluateMentionWriteContextGate({
    isWriteRequest: params.isWriteRequest,
    isIssueThreadComment: params.isIssueThreadComment,
    prNumber: params.mention.prNumber,
  });
  if (!writeContextGate.allowed) {
    await params.postMentionReply(writeContextGate.replyBody, writeContextGate.replyOptions);
    return { action: "stop", acquiredWriteKey };
  }

  if (await maybePublishDisabledWriteModeRefusal({
    isWriteRequest: params.isWriteRequest,
    isPlanOnly: params.isPlanOnly,
    writeEnabled: params.writeConfigEnabled,
    mention: params.mention,
    keyword: params.writeIntentKeyword,
    writeKeyword: params.writeKeyword,
    writeRequest: params.writeRequest,
    appSlug: params.appSlug,
    logger: params.logger,
    postMentionReply: params.postMentionReply,
  })) {
    return { action: "stop", acquiredWriteKey };
  }

  const conversationLimit = evaluateMentionConversationLimit({
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    inReplyToId: params.mention.inReplyToId,
    maxTurnsPerPr: params.maxTurnsPerPr,
    getTurns: params.getConversationTurns,
  });
  if (conversationLimit.limited) {
    await params.postMentionReply(conversationLimit.replyBody);
    return { action: "stop", acquiredWriteKey };
  }

  logMentionProcessing({
    logger: params.logger,
    mention: params.mention,
    acceptClaudeAlias: params.acceptClaudeAlias,
  });

  await postMentionEyesReaction({
    octokit: params.octokit,
    mention: params.mention,
    logger: params.logger,
  });

  return { action: "continue", acquiredWriteKey };
}
