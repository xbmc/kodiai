import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import type { ErrorCategory } from "../lib/errors.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";
import { recordSuccessfulMentionConversationTurn } from "./mention-conversation-recording.ts";
import {
  buildMentionExecutionCompletedState,
  createMentionExecutionCompletedLogger,
  type MentionErrorDelivery,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";
import { recordMentionPostExecutionTelemetry } from "./mention-post-execution-telemetry.ts";
import type { MentionEvent } from "./mention-types.ts";

type MentionCompletionPublicationState = {
  mentionFailureSubtype: string | undefined;
  mentionExecutionErrorCategory: ErrorCategory | undefined;
  mentionOutputPublished: boolean;
  publishResolution: MentionPublishResolution;
  publishFailureCategory: ErrorCategory | null;
  publishFallbackDelivery: MentionErrorDelivery | null;
};

export async function handleMentionPostExecution(params: {
  logger: Logger;
  mention: MentionEvent;
  result: ExecutionResult;
  getPublicationState: () => MentionCompletionPublicationState;
  writeEnabled: boolean;
  mentionDerivedContextCacheStatus: Parameters<typeof recordMentionPostExecutionTelemetry>[0]["derivedContextCacheStatus"];
  mentionDerivedContextCacheReason: string | null;
  explicitReviewRequest: boolean;
  reviewOutputKey?: string;
  shouldDeferCompletionLog: boolean;
  recordSuccessfulTurn: (key: string) => number;
  telemetryEnabled: boolean;
  telemetryStore: TelemetryStore;
  deliveryId: string;
  eventType: string;
  promptSections?: PromptSectionRecord[];
  costWarningUsd: number;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey?: string) => boolean;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
}): Promise<{ logMentionExecutionCompleted: () => void }> {
  const logMentionExecutionCompleted = createMentionExecutionCompletedLogger({
    logger: params.logger,
    getState: () => buildMentionExecutionCompletedState({
      mention: params.mention,
      result: params.result,
      ...params.getPublicationState(),
      writeEnabled: params.writeEnabled,
      mentionDerivedContextCacheStatus: params.mentionDerivedContextCacheStatus,
      mentionDerivedContextCacheReason: params.mentionDerivedContextCacheReason,
      explicitReviewRequest: params.explicitReviewRequest,
      reviewOutputKey: params.reviewOutputKey,
    }),
  });
  if (!params.shouldDeferCompletionLog) {
    logMentionExecutionCompleted();
  }

  recordSuccessfulMentionConversationTurn({
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    inReplyToId: params.mention.inReplyToId,
    conclusion: params.result.conclusion,
    recordSuccessfulTurn: params.recordSuccessfulTurn,
  });

  await recordMentionPostExecutionTelemetry({
    telemetryEnabled: params.telemetryEnabled,
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    deliveryId: params.deliveryId,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    eventType: params.eventType,
    result: params.result,
    promptSections: params.promptSections,
    derivedContextCacheStatus: params.mentionDerivedContextCacheStatus,
    derivedContextCacheReason: params.mentionDerivedContextCacheReason ?? undefined,
    costWarningUsd: params.costWarningUsd,
    explicitReviewRequest: params.explicitReviewRequest,
    reviewOutputKey: params.reviewOutputKey,
    canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
    getOctokit: params.getOctokit,
    botHandles: params.botHandles,
  });

  return { logMentionExecutionCompleted };
}
