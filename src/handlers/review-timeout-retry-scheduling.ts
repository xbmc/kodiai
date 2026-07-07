import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type { Octokit } from "@octokit/rest";
import type { enqueueReviewTimeoutRetryJob } from "./review-timeout-retry-enqueue.ts";
import type { ReviewRetryEnqueueContext } from "./review-retry-enqueue-context.ts";
import { enqueueReviewTimeoutRetryJob as defaultEnqueueReviewTimeoutRetryJob } from "./review-timeout-retry-enqueue.ts";
import { recordReviewTimeoutRetryPreEnqueueSideEffects } from "./review-timeout-retry-pre-enqueue.ts";

type RetryJobParams = Parameters<typeof enqueueReviewTimeoutRetryJob>[0]["retryJobParams"];
type EnqueueRetryParams = Omit<
  Parameters<typeof enqueueReviewTimeoutRetryJob>[0],
  "retryJobParams" | "reviewWorkCoordinator"
>;
type PreEnqueueParams = Omit<
  Parameters<typeof recordReviewTimeoutRetryPreEnqueueSideEffects>[0],
  "retryEnqueueContext" | "retryAttemptId"
>;

export function buildReviewTimeoutRetrySettlementAdapters(params: {
  retryAttemptId: string;
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  appSlug: string;
  setReviewWorkPhaseForAttempt: (attemptId: string, phase: "publish") => void;
}): Pick<RetryJobParams["settlement"], "getOctokit" | "getAppSlug" | "setPublishPhase"> {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
    getAppSlug: () => params.appSlug,
    setPublishPhase: () => params.setReviewWorkPhaseForAttempt(params.retryAttemptId, "publish"),
  };
}

export function buildReviewTimeoutRetryPreEnqueueParams(params: {
  telemetryEnabled: boolean;
  telemetryStore: PreEnqueueParams["telemetryStore"];
  logger: PreEnqueueParams["logger"];
  deliveryId: string;
  owner: string;
  repo: string;
  pr: { number: number; user: { login: string } };
  eventAction: string;
  reviewOutputKey: string;
  executionConclusion: string;
  hasPublishedInlines: boolean;
  timeoutReviewedFiles: string[];
  timeoutInspectedFiles: string[];
  timeoutFindingCount: number;
  summaryDraft: string;
  timeoutTotalFiles: number;
  partialCommentId: number | undefined;
  recentTimeouts: number;
  isChronicTimeout: boolean;
  timeoutClassificationTelemetry: PreEnqueueParams["timeoutClassificationTelemetry"];
  timeoutFirstPass: PreEnqueueParams["timeoutFirstPass"];
  knowledgeStore: PreEnqueueParams["knowledgeStore"];
  persistContinuationFamilyState: PreEnqueueParams["persistContinuationFamilyState"];
}): PreEnqueueParams {
  return {
    telemetryEnabled: params.telemetryEnabled,
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    deliveryId: params.deliveryId,
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.pr.number,
    prAuthor: params.pr.user.login,
    eventType: `pull_request.${params.eventAction}`,
    reviewOutputKey: params.reviewOutputKey,
    executionConclusion: params.executionConclusion,
    hadInlineOutput: params.hasPublishedInlines,
    checkpointFilesReviewed: params.timeoutReviewedFiles,
    checkpointFilesInspected: params.timeoutInspectedFiles,
    checkpointFindingCount: params.timeoutFindingCount,
    checkpointSummaryDraft: params.summaryDraft,
    checkpointTotalFiles: params.timeoutTotalFiles,
    partialCommentId: params.partialCommentId,
    recentTimeouts: params.recentTimeouts,
    chronicTimeout: params.isChronicTimeout,
    timeoutClassificationTelemetry: params.timeoutClassificationTelemetry,
    timeoutFirstPass: params.timeoutFirstPass,
    knowledgeStore: params.knowledgeStore,
    persistContinuationFamilyState: params.persistContinuationFamilyState,
  };
}

export function buildReviewTimeoutRetryEnqueueParams(params: {
  jobQueue: EnqueueRetryParams["jobQueue"];
  installationId: number;
  parentDeliveryId: string;
  eventName: string;
  reviewFamilyKey: string;
  pr: { number: number };
  reviewOutputKey: string;
  knowledgeStore: EnqueueRetryParams["knowledgeStore"];
  logger: EnqueueRetryParams["logger"];
  finalizeContinuationAttempt: EnqueueRetryParams["finalizeContinuationAttempt"];
}): EnqueueRetryParams {
  return {
    jobQueue: params.jobQueue,
    installationId: params.installationId,
    parentDeliveryId: params.parentDeliveryId,
    eventName: params.eventName,
    reviewFamilyKey: params.reviewFamilyKey,
    prNumber: params.pr.number,
    reviewOutputKey: params.reviewOutputKey,
    knowledgeStore: params.knowledgeStore,
    logger: params.logger,
    finalizeContinuationAttempt: params.finalizeContinuationAttempt,
  };
}

export async function scheduleReviewTimeoutRetryContinuation(params: {
  retryEnqueueContext: ReviewRetryEnqueueContext;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "claim" | "complete" | "release">;
  reviewFamilyKey: string;
  preEnqueue: PreEnqueueParams;
  enqueue: EnqueueRetryParams;
  buildRetryJobParams: (retryAttemptId: string) => RetryJobParams;
  enqueueRetryJob?: typeof enqueueReviewTimeoutRetryJob;
}): Promise<{ continuationProjectionDegraded: boolean }> {
  const retryReviewWorkAttempt = params.reviewWorkCoordinator.claim({
    familyKey: params.reviewFamilyKey,
    source: "automatic-review",
    lane: "review",
    deliveryId: params.retryEnqueueContext.retryDeliveryId,
    phase: "claimed",
  });

  const retryPreEnqueueSideEffects = await recordReviewTimeoutRetryPreEnqueueSideEffects({
    ...params.preEnqueue,
    retryEnqueueContext: params.retryEnqueueContext,
    retryAttemptId: retryReviewWorkAttempt.attemptId,
  });

  const enqueueRetryJob = params.enqueueRetryJob ?? defaultEnqueueReviewTimeoutRetryJob;
  enqueueRetryJob({
    ...params.enqueue,
    retryJobParams: params.buildRetryJobParams(retryReviewWorkAttempt.attemptId),
    reviewWorkCoordinator: params.reviewWorkCoordinator,
  });

  return {
    continuationProjectionDegraded: retryPreEnqueueSideEffects.continuationProjectionDegraded,
  };
}
