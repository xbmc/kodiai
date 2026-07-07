import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";
import type { TimeoutReviewDetailsProgress } from "../lib/review-details-formatting.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { ReviewDetailsBodyRuntimeParams } from "./review-details-body.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import type { ReviewTimeoutClassificationTelemetryFields } from "./review-resilience-telemetry.ts";
import { publishBoundedFirstPassReview } from "./review-partial-publication.ts";
import { persistPartialReviewCheckpoint } from "./review-partial-checkpoint.ts";
import { logBoundedFirstPassReviewPublished } from "./review-bounded-first-pass-evidence.ts";
import { publishTimeoutReviewDetailsMerge } from "./review-details-timeout-publication.ts";
import { logBoundedFirstPassPublicationFailure } from "./review-bounded-first-pass-publication-failure-log.ts";
import { recordReviewTimeoutResilienceTelemetry } from "./review-timeout-resilience-telemetry.ts";

export async function publishBoundedFirstPassTimeoutOutput(params: {
  timeoutFirstPass: ReviewFirstPassPayload | null;
  deferredPublicOutputForContinuation: boolean;
  partialBody: string | undefined;
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  logger: Logger;
  deliveryId: string;
  knowledgeStore: Pick<KnowledgeStore, "saveCheckpoint" | "updateCheckpointCommentId"> | undefined;
  filesReviewed: string[];
  filesInspected: string[];
  findingCount: number;
  summaryDraft: string;
  totalFiles: number;
  hasPartialResults: boolean;
  chronicTimeout: boolean;
  recentTimeouts: number;
  retryState: string;
  timeoutReviewDetails: TimeoutReviewDetailsProgress;
  timeoutBudget: ReviewDetailsBodyRuntimeParams["timeoutBudget"];
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  telemetryEnabled: boolean;
  telemetryStore: Pick<TelemetryStore, "recordResilienceEvent">;
  prAuthor: string;
  eventType: string;
  executionConclusion: string;
  hadInlineOutput: boolean;
  timeoutClassificationTelemetry: ReviewTimeoutClassificationTelemetryFields;
}): Promise<{
  partialCommentId: number | undefined;
  publishedPartialReview: boolean;
  continuationProjectionDegraded: boolean;
}> {
  if (
    params.timeoutFirstPass?.state !== "bounded-first-pass" ||
    params.deferredPublicOutputForContinuation ||
    params.partialBody === undefined
  ) {
    return {
      partialCommentId: undefined,
      publishedPartialReview: false,
      continuationProjectionDegraded: false,
    };
  }

  const partialPublication = await publishBoundedFirstPassReview({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    body: params.partialBody,
    botHandles: params.botHandles,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
  });
  if (!partialPublication.ok) {
    logBoundedFirstPassPublicationFailure({
      logger: params.logger,
      error: partialPublication.err.error,
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
    });
    return {
      partialCommentId: undefined,
      publishedPartialReview: false,
      continuationProjectionDegraded: false,
    };
  }

  const partialCommentId = partialPublication.value.commentId;
  if (partialCommentId === undefined) {
    return {
      partialCommentId: undefined,
      publishedPartialReview: false,
      continuationProjectionDegraded: false,
    };
  }

  await persistPartialReviewCheckpoint({
    knowledgeStore: params.knowledgeStore,
    logger: params.logger,
    checkpoint: {
      reviewOutputKey: params.reviewOutputKey,
      repo: `${params.owner}/${params.repo}`,
      prNumber: params.prNumber,
      filesReviewed: params.filesReviewed,
      filesInspected: params.filesInspected,
      findingCount: params.findingCount,
      summaryDraft: params.summaryDraft,
      totalFiles: params.totalFiles,
      partialCommentId,
    },
  });

  logBoundedFirstPassReviewPublished({
    logger: params.logger,
    deliveryId: params.deliveryId,
    prNumber: params.prNumber,
    partialCommentId,
    boundedReason: params.timeoutFirstPass.boundedReason,
    evidenceSource: params.timeoutFirstPass.evidenceSource,
    coveredFiles: params.timeoutFirstPass.coveredScope?.reviewedFiles ?? null,
    inspectedFiles: params.timeoutFirstPass.inspectedScope?.inspectedFiles ?? params.filesInspected.length,
    remainingFiles: params.timeoutFirstPass.remainingScope?.remainingFiles ?? null,
    findingCount: params.findingCount,
    hasPartialResults: params.hasPartialResults,
    isChronicTimeout: params.chronicTimeout,
    recentTimeouts: params.recentTimeouts,
    retryState: params.retryState,
    zeroEvidenceFailure: params.timeoutFirstPass.zeroEvidenceFailure,
  });

  await publishTimeoutReviewDetailsMerge({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    partialCommentId,
    partialBody: params.partialBody,
    botHandles: params.botHandles,
    timeoutReviewDetailsRuntime: {
      timeoutProgress: params.timeoutReviewDetails,
      reviewFirstPass: params.timeoutFirstPass,
      timeoutBudget: params.timeoutBudget,
    },
    authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
    reviewBoundedness: params.reviewBoundedness,
    baseLog: params.baseLog,
    logger: params.logger,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    renderReviewDetailsBody: params.renderReviewDetailsBody,
  });

  const timeoutResilienceTelemetry = await recordReviewTimeoutResilienceTelemetry({
    telemetryEnabled: params.telemetryEnabled,
    telemetryStore: params.telemetryStore,
    logger: params.logger,
    deliveryId: params.deliveryId,
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.prNumber,
    prAuthor: params.prAuthor,
    eventType: params.eventType,
    reviewOutputKey: params.reviewOutputKey,
    executionConclusion: params.executionConclusion,
    hadInlineOutput: params.hadInlineOutput,
    checkpointFilesReviewed: params.filesReviewed.length,
    checkpointFilesInspected: params.filesInspected.length,
    checkpointFindingCount: params.findingCount,
    checkpointTotalFiles: params.totalFiles,
    partialCommentId,
    recentTimeouts: params.recentTimeouts,
    chronicTimeout: params.chronicTimeout,
    retry: { enqueued: false },
    timeoutClassificationTelemetry: params.timeoutClassificationTelemetry,
  });

  return {
    partialCommentId,
    publishedPartialReview: true,
    continuationProjectionDegraded: timeoutResilienceTelemetry.projectionDegraded,
  };
}
