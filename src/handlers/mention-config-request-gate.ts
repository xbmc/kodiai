import type { Logger } from "pino";
import type { MentionEvent } from "./mention-types.ts";
import { isMentionAuthorAllowed } from "./mention-allowed-users.ts";
import {
  resolveMentionRequestContext,
  type MentionRequestContextResult,
} from "./mention-request-context.ts";

export type MentionConfigRequestGateResult =
  | { action: "stop" }
  | {
      action: "continue";
      acceptClaudeAlias: boolean;
      requestContext: Extract<MentionRequestContextResult, { action: "continue" }>;
    };

export function resolveMentionConfigRequestGate(params: {
  mention: MentionEvent;
  mentionConfig: {
    enabled: boolean;
    allowedUsers: readonly string[];
    acceptClaudeAlias?: boolean;
  };
  appSlug: string;
  logger: Pick<Logger, "info">;
}): MentionConfigRequestGateResult {
  const { mention, mentionConfig, logger } = params;

  if (!mentionConfig.enabled) {
    logger.info(
      { owner: mention.owner, repo: mention.repo },
      "Mentions disabled in config, skipping",
    );
    return { action: "stop" };
  }

  if (!isMentionAuthorAllowed(mention.commentAuthor, mentionConfig.allowedUsers)) {
    logger.info(
      {
        owner: mention.owner,
        repo: mention.repo,
        commentAuthor: mention.commentAuthor,
        gate: "mention-allowed-users",
        gateResult: "skipped",
        skipReason: "user-not-allowlisted",
      },
      "Mention author not in allowedUsers, skipping",
    );
    return { action: "stop" };
  }

  const acceptClaudeAlias = mentionConfig.acceptClaudeAlias !== false;
  const requestContext = resolveMentionRequestContext({
    appSlug: params.appSlug,
    acceptClaudeAlias,
    commentBody: mention.commentBody,
  });

  if (requestContext.action === "skip" && requestContext.reason === "handle-mismatch") {
    logger.info(
      {
        surface: mention.surface,
        owner: mention.owner,
        repo: mention.repo,
        issueNumber: mention.issueNumber,
        prNumber: mention.prNumber,
        acceptClaudeAlias,
      },
      "Mention does not match accepted handles for repo; skipping",
    );
    return { action: "stop" };
  }

  if (requestContext.action === "skip") {
    logger.info(
      {
        surface: mention.surface,
        owner: mention.owner,
        repo: mention.repo,
        issueNumber: mention.issueNumber,
        prNumber: mention.prNumber,
        acceptClaudeAlias,
      },
      "Mention contained no question after stripping mention; skipping",
    );
    return { action: "stop" };
  }

  return {
    action: "continue",
    acceptClaudeAlias,
    requestContext,
  };
}
