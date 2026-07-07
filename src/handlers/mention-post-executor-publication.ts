import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import type { Workspace } from "../jobs/types.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import { err, ok, type Result } from "../lib/result.ts";
import type {
  FormatterSuggestionMentionRunner,
  FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import { maybeReplyWritePermissionFailure } from "./mention-write-replies.ts";
import { publishCombinedReviewAndFormatMentionFormatterResult } from "./mention-combined-format-publication.ts";
import type { MentionExecutorDispatchPhaseResult } from "./mention-executor-dispatch-phase.ts";
import { publishMentionExecutionFallbacks } from "./mention-execution-fallbacks.ts";
import { publishExplicitMentionReviewIfEligible } from "./mention-explicit-review-publication-orchestration.ts";
import type { MentionEvent } from "./mention-types.ts";
import {
  type MentionExecutionPublicationState,
  resolveMentionExecutionPublicationState,
} from "./mention-publication-state.ts";
import { handleMentionPostExecution } from "./mention-post-execution.ts";
import { routeMentionWriteOutputIfEnabled } from "./mention-write-output-routing.ts";
import type { MentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";
import type { MentionWriteRequestContext } from "./mention-write-request-context.ts";

type RouteMentionWriteOutputParams = Parameters<typeof routeMentionWriteOutputIfEnabled>[0];

export type MentionPostExecutorPublicationValue = {
  writeOutputHandled: boolean;
};

export type MentionPostExecutorPublicationError = {
  error: unknown;
};

export type MentionPostExecutorPublicationResult = Result<
  MentionPostExecutorPublicationValue,
  MentionPostExecutorPublicationError
>;

export function buildMentionPostExecutorPublicationAdapters(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
}): Pick<Parameters<typeof publishMentionPostExecutorOutputs>[0], "getOctokit"> {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
  };
}

export async function publishMentionPostExecutorOutputs(params: {
  executorDispatch: MentionExecutorDispatchPhaseResult;
  explicitReviewRequest: boolean;
  eventName: string;
  eventAction: string | undefined;
  mention: MentionEvent;
  reviewOutputKey: string | undefined;
  deliveryId: string;
  installationId: number;
  explicitReviewHeadSha?: string | null;
  explicitReviewBaseSha?: string | null;
  appSlug: string;
  autoApprove: boolean;
  explicitReviewPromptFileCount: number | undefined;
  getOctokit: () => Promise<Octokit>;
  canPublishExplicitReviewOutput: Parameters<typeof publishExplicitMentionReviewIfEligible>[0]["canPublishExplicitReviewOutput"];
  setReviewWorkPhase: Parameters<typeof publishExplicitMentionReviewIfEligible>[0]["setReviewWorkPhase"];
  postMentionError: Parameters<typeof publishExplicitMentionReviewIfEligible>[0]["postMentionError"];
  logger: Logger;
  reviewPublishRightsLost: boolean;
  writeEnabled: boolean;
  mentionDerivedContextCacheStatus: Parameters<typeof handleMentionPostExecution>[0]["mentionDerivedContextCacheStatus"];
  mentionDerivedContextCacheReason: string | null;
  recordSuccessfulTurn: (key: string) => number;
  telemetryEnabled: boolean;
  telemetryStore: TelemetryStore;
  promptSections: Parameters<typeof handleMentionPostExecution>[0]["promptSections"];
  costWarningUsd: number;
  botHandles: string[];
  workspace: Workspace;
  workspaceToken?: string;
  octokit: RouteMentionWriteOutputParams["octokit"];
  forkContext: RouteMentionWriteOutputParams["forkContext"];
  gistPublisher?: Pick<GistPublisher, "enabled" | "createPatchGist">;
  writeContext: MentionWriteRequestContext;
  cloneRef?: string;
  writeConfig: RouteMentionWriteOutputParams["writeConfig"];
  postMentionReply: RouteMentionWriteOutputParams["postMentionReply"];
  writeRateLimit: MentionWriteRateLimitRuntime;
  explicitReviewRoutingReason: string | undefined;
  runFormatterSuggestionForMention: FormatterSuggestionMentionRunner;
  postFormatterVisibleDiagnostic: FormatterSuggestionVisibleDiagnosticPoster;
  reviewOutputAction: string;
}): Promise<MentionPostExecutorPublicationResult> {
  const { executorPlan, result } = params.executorDispatch;

  const {
    explicitReviewPublishEvaluation,
    explicitReviewResultFindingLines,
    explicitReviewPublication,
  } = await publishExplicitMentionReviewIfEligible({
    explicitReviewRequest: params.explicitReviewRequest,
    eventName: params.eventName,
    mention: params.mention,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    headSha: params.explicitReviewHeadSha,
    baseSha: params.explicitReviewBaseSha,
    result: {
      conclusion: result.conclusion,
      published: result.published,
      usedRepoInspectionTools: result.usedRepoInspectionTools,
      resultText: result.resultText,
      toolUseNames: result.toolUseNames,
      candidateFinding: result.candidateFinding,
    },
    appSlug: params.appSlug,
    autoApprove: params.autoApprove,
    explicitReviewPromptFileCount: params.explicitReviewPromptFileCount,
    getOctokit: params.getOctokit,
    canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
    postMentionError: params.postMentionError,
    logger: params.logger,
  });

  let publicationState: MentionExecutionPublicationState = resolveMentionExecutionPublicationState({
    result,
    explicitReviewPublication,
    reviewPublishRightsLost: params.reviewPublishRightsLost,
  });

  const mentionPostExecution = await handleMentionPostExecution({
    logger: params.logger,
    mention: params.mention,
    result,
    getPublicationState: () => publicationState,
    writeEnabled: params.writeEnabled,
    mentionDerivedContextCacheStatus: params.mentionDerivedContextCacheStatus,
    mentionDerivedContextCacheReason: params.mentionDerivedContextCacheReason,
    explicitReviewRequest: params.explicitReviewRequest,
    reviewOutputKey: params.reviewOutputKey,
    shouldDeferCompletionLog: publicationState.shouldDeferCompletionLog,
    recordSuccessfulTurn: params.recordSuccessfulTurn,
    telemetryEnabled: params.telemetryEnabled,
    telemetryStore: params.telemetryStore,
    deliveryId: params.deliveryId,
    eventType: `${params.eventName}.${params.eventAction ?? ""}`,
    promptSections: params.promptSections,
    costWarningUsd: params.costWarningUsd,
    canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
    getOctokit: params.getOctokit,
    botHandles: params.botHandles,
  });

  if (await routeMentionWriteOutputIfEnabled({
    workspace: params.workspace,
    workspaceToken: params.workspaceToken,
    octokit: params.octokit,
    mention: params.mention,
    forkContext: params.forkContext,
    gistPublisher: params.gistPublisher,
    writeContext: params.writeContext,
    cloneRef: params.cloneRef,
    writeConfig: params.writeConfig,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    appSlug: params.appSlug,
    logger: params.logger,
    postMentionReply: params.postMentionReply,
    maybeReplyWritePermissionFailure,
    writeRateLimit: params.writeRateLimit,
  })) {
    return ok({ writeOutputHandled: true });
  }

  publicationState = {
    ...publicationState,
    ...await publishMentionExecutionFallbacks({
      writeEnabled: params.writeEnabled,
      reviewPublishRightsLost: params.reviewPublishRightsLost,
      mentionOutputPublished: publicationState.mentionOutputPublished,
      publishResolution: publicationState.publishResolution,
      publishFallbackDelivery: publicationState.publishFallbackDelivery,
      result,
      explicitReviewRequest: params.explicitReviewRequest,
      hasUnpublishedFindings: explicitReviewPublishEvaluation.hasUnpublishedFindings,
      findingLines: explicitReviewResultFindingLines,
      skipReason: explicitReviewPublishEvaluation.skipReason,
      routingReason: params.explicitReviewRoutingReason,
      reviewOutputKey: params.reviewOutputKey,
      surface: params.mention.surface,
      issueNumber: params.mention.issueNumber,
      canPublishExplicitReviewOutput: params.canPublishExplicitReviewOutput,
      postMentionReply: params.postMentionReply,
      postMentionError: params.postMentionError,
      logger: params.logger,
    }),
  };

  if (publicationState.shouldDeferCompletionLog) {
    mentionPostExecution.logMentionExecutionCompleted();
  }

  const combinedFormatterPublication = await publishCombinedReviewAndFormatMentionFormatterResult({
    enabled: executorPlan.isCombinedFormatterSuggestionRequest,
    runFormatterSuggestionForMention: params.runFormatterSuggestionForMention,
    postFormatterVisibleDiagnostic: params.postFormatterVisibleDiagnostic,
    mention: params.mention,
    deliveryId: params.deliveryId,
    reviewOutputAction: params.reviewOutputAction,
    result: {
      conclusion: result.conclusion,
      stopReason: result.stopReason,
      failureSubtype: result.failureSubtype,
    },
    publishResolution: publicationState.publishResolution,
    publishFailureCategory: publicationState.publishFailureCategory,
    publishFallbackDelivery: publicationState.publishFallbackDelivery,
    logger: params.logger,
  });
  if (!combinedFormatterPublication.ok) {
    return err({ error: combinedFormatterPublication.err.error });
  }

  return ok({ writeOutputHandled: false });
}
