import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import type { WebhookEvent } from "../webhook/types.ts";
import { routeAddonRuleReviewMention } from "./addon-review-routing.ts";
import { resolveMentionConfigRequestGate } from "./mention-config-request-gate.ts";
import type { MentionRequestContextResult } from "./mention-request-context.ts";
import type { MentionEvent } from "./mention-types.ts";
import {
  resolveMentionWriteRequestContext,
  type MentionWriteRequestContext,
} from "./mention-write-request-context.ts";

type MentionRequestPreparationContinue = {
  action: "continue";
  acceptClaudeAlias: boolean;
  acceptedHandles: string[];
  userQuestion: string;
  formatterSuggestionRequest?: Extract<MentionRequestContextResult, { action: "continue" }>["formatterSuggestionRequest"];
  mentionWriteRequestContext: MentionWriteRequestContext;
};

export type MentionRequestPreparationResult =
  | { action: "stop" }
  | MentionRequestPreparationContinue;

export async function prepareMentionRequestExecutionContext(params: {
  event: WebhookEvent;
  appSlug: string;
  mention: MentionEvent;
  config: Pick<RepoConfig, "mention" | "write">;
  addonRepos: readonly string[];
  getPullRequest: Parameters<typeof routeAddonRuleReviewMention>[0]["getPullRequest"];
  acknowledgeAddonReview: () => Promise<void>;
  dispatchAddonReview: Parameters<typeof routeAddonRuleReviewMention>[0]["dispatch"];
  logger: Logger;
}): Promise<MentionRequestPreparationResult> {
  const mentionConfigRequestGate = resolveMentionConfigRequestGate({
    mention: params.mention,
    mentionConfig: params.config.mention,
    appSlug: params.appSlug,
    logger: params.logger,
  });
  if (mentionConfigRequestGate.action === "stop") return { action: "stop" };

  const { acceptClaudeAlias, requestContext: mentionRequestContext } = mentionConfigRequestGate;
  const { userQuestion, formatterSuggestionRequest } = mentionRequestContext;
  const mentionWriteRequestContext = resolveMentionWriteRequestContext({
    eventName: params.event.name,
    installationId: params.event.installationId,
    appSlug: params.appSlug,
    mention: params.mention,
    userQuestion,
    formatterSuggestionRequestMode: formatterSuggestionRequest?.mode,
    writeConfigEnabled: params.config.write.enabled,
  });

  if (
    mentionWriteRequestContext.explicitReviewRequest &&
    params.mention.prNumber !== undefined &&
    await routeAddonRuleReviewMention({
      event: params.event,
      owner: params.mention.owner,
      repo: params.mention.repo,
      prNumber: params.mention.prNumber,
      addonRepos: params.addonRepos,
      getPullRequest: params.getPullRequest,
      beforeDispatch: params.acknowledgeAddonReview,
      dispatch: params.dispatchAddonReview,
      logger: params.logger,
    })
  ) {
    return { action: "stop" };
  }

  return {
    action: "continue",
    acceptClaudeAlias,
    acceptedHandles: mentionRequestContext.acceptedHandles,
    userQuestion,
    formatterSuggestionRequest,
    mentionWriteRequestContext,
  };
}
