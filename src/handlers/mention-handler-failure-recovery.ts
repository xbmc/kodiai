import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { GuardrailAuditStore } from "../lib/guardrail/audit-store.ts";
import type { MentionEvent } from "./mention-types.ts";
import { publishMentionHandlerFailureError } from "./mention-result-fallback-publication.ts";

export async function handleMentionHandlerFailureRecovery(params: {
  error: unknown;
  githubApp: GitHubApp;
  installationId: number;
  mention: MentionEvent;
  possibleHandles: string[];
  logger: Logger;
  guardrailAuditStore?: GuardrailAuditStore;
  explicitReviewRequest: boolean;
  reviewOutputKey: string | undefined;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey: string | undefined) => boolean;
}): Promise<void> {
  params.logger.error(
    { err: params.error, surface: params.mention.surface, issueNumber: params.mention.issueNumber },
    "Mention handler failed",
  );

  try {
    const handlerFailurePublication = await publishMentionHandlerFailureError({
      githubApp: params.githubApp,
      installationId: params.installationId,
      mention: params.mention,
      possibleHandles: params.possibleHandles,
      logger: params.logger,
      guardrailAuditStore: params.guardrailAuditStore,
      explicitReviewRequest: params.explicitReviewRequest,
      reviewOutputKey: params.reviewOutputKey,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      error: params.error,
    });
    if (!handlerFailurePublication.ok) {
      params.logger.error(
        { err: handlerFailurePublication.err.error },
        "Failed to post error comment",
      );
    }
  } catch (commentErr) {
    params.logger.error({ err: commentErr }, "Failed to post error comment");
  }
}
