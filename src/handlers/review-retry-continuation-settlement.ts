import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import type { CheckpointRecord, KnowledgeStore } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import { ok, type Result } from "../lib/result.ts";
import { settleReviewContinuation } from "../lib/review-continuation-lifecycle.ts";
import type { ReviewFirstPassBoundedReason } from "../lib/review-first-pass.ts";
import { extractFindingsFromReviewComments } from "../review-orchestration/review-comment-finding-extraction.ts";
import { resolveReviewContinuationMergeContext } from "./review-continuation-merge-context.ts";
import { resolveReviewContinuationRevisionCounts } from "./review-continuation-revision-counts.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import { discardCheckpointsFailOpen } from "./review-handler-utils.ts";
import { publishReviewExecutionErrorFallback } from "./review-error-publication.ts";
import {
  publishRetryMergeContinuationResults,
  type RetryMergeContinuationPublicationStatus,
} from "./review-retry-merge-publication.ts";
import {
  settleRetryWithNoAdditionalResults,
  type RetryNoAdditionalResultsSettlementStatus,
} from "./review-retry-settlement.ts";

type PublishRetryMergeContinuationResults = typeof publishRetryMergeContinuationResults;
type PublishReviewExecutionErrorFallback = typeof publishReviewExecutionErrorFallback;

/**
 * When a retry/continuation attempt itself fails to produce usable results (e.g. it
 * also exhausts its turn budget), the settlement below quietly discards it on the
 * assumption that the *original* first-pass review already published a partial
 * review to the PR. That assumption only holds when the original attempt actually
 * published something. If the original attempt deferred publication in favor of
 * this retry (the normal "let the retry publish the final result" flow) and the
 * retry then also fails to produce results, quiet-settling would leave the PR with
 * zero visible output even though two full review attempts ran. Detect that case
 * so we can fail open with a clear "ran out of steps" comment instead of silence.
 */
function shouldForceTurnLimitFallback(params: {
  retryCompletedWithResults: boolean;
  partialCommentId?: number;
}): boolean {
  return !params.retryCompletedWithResults && params.partialCommentId === undefined;
}

export type RetryContinuationSettlementStatus =
  | (RetryNoAdditionalResultsSettlementStatus & { published: boolean })
  | { status: "settled-without-canonical-update"; published: false; reason: string }
  | RetryMergeContinuationPublicationStatus;

export type RetryContinuationSettlementResult =
  Result<RetryContinuationSettlementStatus, never>;

export async function settleRetryContinuationResults(params: {
  retryCompletedWithResults: boolean;
  getOctokit: () => Promise<Octokit>;
  getAppSlug: () => string;
  owner: string;
  repo: string;
  prNumber: number;
  attemptId: string;
  deliveryId: string;
  reviewOutputKey: string;
  canonicalReviewOutputKey: string;
  retryReviewOutputKey: string;
  retryResult: Pick<ExecutionResult, "conclusion" | "isTimeout" | "published" | "stopReason" | "failureSubtype" | "errorMessage">;
  firstPassOutcome: Pick<ExecutionResult, "conclusion" | "stopReason" | "failureSubtype" | "isTimeout">;
  baseCheckpoint: CheckpointRecord | null;
  retryCheckpoint: CheckpointRecord | null;
  partialCommentId?: number;
  retryFilesCount: number;
  timeoutDurationSeconds: number;
  timeoutFirstPassBoundedReason?: ReviewFirstPassBoundedReason | null;
  knowledgeStore: KnowledgeStore | undefined;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  baseLog: Record<string, unknown>;
  logger: Logger;
  canPublishReviewWorkOutput: (attemptId: string, reason: string, deliveryId: string) => boolean;
  setPublishPhase: () => void;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  settleRetryWithoutCanonicalUpdate: (params: {
    attemptId: string;
    reviewOutputKey: string;
    deliveryId: string;
    reason: string;
    logMessage: string;
  }) => Promise<void>;
  persistContinuationFamilyState: Parameters<typeof publishRetryMergeContinuationResults>[0]["persistContinuationFamilyState"];
  publishRetryMergeContinuationResultsFn?: PublishRetryMergeContinuationResults;
  publishReviewExecutionErrorFallbackFn?: PublishReviewExecutionErrorFallback;
}): Promise<RetryContinuationSettlementResult> {
  if (!params.retryCompletedWithResults) {
    let postedTurnLimitFallback = false;
    if (shouldForceTurnLimitFallback(params)) {
      const exhaustedTurnBudget =
        params.firstPassOutcome.stopReason === "max_turns" ||
        params.firstPassOutcome.failureSubtype === "error_max_turns" ||
        params.retryResult.stopReason === "max_turns" ||
        params.retryResult.failureSubtype === "error_max_turns";

      const publishExecutionErrorFallback =
        params.publishReviewExecutionErrorFallbackFn ?? publishReviewExecutionErrorFallback;
      const fallbackPublication = await publishExecutionErrorFallback({
        octokit: await params.getOctokit(),
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        exhaustedTurnBudget,
        retryScheduled: false,
        category: exhaustedTurnBudget ? "timeout" : "internal_error",
        errorMessage: exhaustedTurnBudget
          ? undefined
          : (params.retryResult.errorMessage ?? "The retry review run did not produce a publishable result."),
        totalTimeoutSeconds: params.timeoutDurationSeconds,
        complexityInfo: "Retry review run also failed to produce publishable results.",
        logger: params.logger,
        canPublishVisibleOutput: (reason) =>
          params.canPublishReviewWorkOutput(params.attemptId, reason, params.deliveryId),
        setReviewWorkPhase: params.setPublishPhase,
      });

      postedTurnLimitFallback = fallbackPublication.ok ? fallbackPublication.value.published : false;

      params.logger.info(
        {
          deliveryId: params.deliveryId,
          prNumber: params.prNumber,
          retryConclusion: params.retryResult.conclusion,
          published: postedTurnLimitFallback,
        },
        "Retry produced no additional results and nothing was published yet -- posting turn-limit fallback so the review does not silently disappear",
      );
    }

    const quietSettlement = await settleRetryWithNoAdditionalResults({
      logger: params.logger,
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      retryConclusion: params.retryResult.conclusion,
    });
    if (!quietSettlement.ok) {
      return ok({
        status: "quiet-settled",
        published: postedTurnLimitFallback,
        persistedContinuationState: false,
        discardedCheckpoints: false,
        reason: "no-retry-results",
      });
    }
    return ok({ ...quietSettlement.value, published: postedTurnLimitFallback });
  }

  if (!params.baseCheckpoint) {
    await params.settleRetryWithoutCanonicalUpdate({
      attemptId: params.attemptId,
      reviewOutputKey: params.retryReviewOutputKey,
      deliveryId: params.deliveryId,
      reason: "missing-base-checkpoint",
      logMessage: "Retry settlement skipped because the base checkpoint was missing",
    });
    return ok({
      status: "settled-without-canonical-update",
      published: false,
      reason: "missing-base-checkpoint",
    });
  }

  const settlementDecision = settleReviewContinuation({
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: params.retryReviewOutputKey,
    baseCheckpoint: params.baseCheckpoint,
    continuationCheckpoint: params.retryCheckpoint,
    continuationPublished: params.retryResult.published ?? false,
  });

  if (settlementDecision.decision !== "merge-continuation") {
    const quietSettlement = await settleRetryWithNoAdditionalResults({
      logger: params.logger,
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      retryConclusion: params.retryResult.conclusion,
      settlementReason: settlementDecision.reason,
      quietSettlement: {
        attemptId: params.attemptId,
        reviewOutputKey: params.retryReviewOutputKey,
        persistContinuationFamilyState: params.persistContinuationFamilyState,
      },
    });
    if (!quietSettlement.ok) {
      return ok({
        status: "quiet-settled",
        published: false,
        persistedContinuationState: false,
        discardedCheckpoints: false,
        reason: settlementDecision.reason,
      });
    }
    return ok({ ...quietSettlement.value, published: false });
  }

  const continuationRevisionCounts = await resolveReviewContinuationRevisionCounts({
    repo: `${params.owner}/${params.repo}`,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    logger: params.logger,
    baseLog: params.baseLog,
    getPriorReviewFindings: params.knowledgeStore?.getPriorReviewFindings,
    extractFindings: async () => await extractFindingsFromReviewComments({
      octokit: await params.getOctokit(),
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.canonicalReviewOutputKey,
      logger: params.logger,
      baseLog: params.baseLog,
    }),
  });

  if (
    continuationRevisionCounts
    && continuationRevisionCounts.new === 0
    && continuationRevisionCounts.stillOpen === 0
    && continuationRevisionCounts.resolved === 0
  ) {
    const quietSettlement = await settleRetryWithNoAdditionalResults({
      logger: params.logger,
      deliveryId: params.deliveryId,
      prNumber: params.prNumber,
      retryConclusion: params.retryResult.conclusion,
      settlementReason: "no-meaningful-delta",
      quietSettlement: {
        attemptId: params.attemptId,
        reviewOutputKey: params.retryReviewOutputKey,
        persistContinuationFamilyState: params.persistContinuationFamilyState,
      },
      discardCheckpoints: () => discardCheckpointsFailOpen(params.knowledgeStore, params.logger, [
        params.reviewOutputKey,
        params.retryReviewOutputKey,
      ]),
    });
    if (!quietSettlement.ok) {
      return ok({
        status: "quiet-settled",
        published: false,
        persistedContinuationState: false,
        discardedCheckpoints: false,
        reason: "no-meaningful-delta",
      });
    }
    return ok({ ...quietSettlement.value, published: false });
  }

  const mergeContext = resolveReviewContinuationMergeContext({
    reviewBoundedness: params.reviewBoundedness,
    mergedCheckpoint: settlementDecision.mergedCheckpoint,
    retryCheckpoint: params.retryCheckpoint,
    baseCheckpoint: params.baseCheckpoint,
    firstPassOutcome: {
      conclusion: params.firstPassOutcome.conclusion,
      stopReason: params.firstPassOutcome.stopReason,
      failureSubtype: params.firstPassOutcome.failureSubtype,
      isTimeout: params.firstPassOutcome.isTimeout,
      published: true,
    },
    timeoutFirstPassBoundedReason: params.timeoutFirstPassBoundedReason,
    timeoutDurationSeconds: params.timeoutDurationSeconds,
    retryFilesCount: params.retryFilesCount,
    reviewOutputKey: params.canonicalReviewOutputKey,
    continuationRevisionCounts,
  });

  if (mergeContext.status === "non-publishable") {
    await params.settleRetryWithoutCanonicalUpdate({
      attemptId: params.attemptId,
      reviewOutputKey: params.retryReviewOutputKey,
      deliveryId: params.deliveryId,
      reason: mergeContext.reason,
      logMessage: "Retry merge skipped because bounded first-pass state became non-publishable",
    });
    return ok({
      status: "settled-without-canonical-update",
      published: false,
      reason: mergeContext.reason,
    });
  }

  const publishRetryMerge =
    params.publishRetryMergeContinuationResultsFn ?? publishRetryMergeContinuationResults;
  return await publishRetryMerge({
    getOctokit: params.getOctokit,
    getAppSlug: params.getAppSlug,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    attemptId: params.attemptId,
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    canonicalReviewOutputKey: params.canonicalReviewOutputKey,
    retryReviewOutputKey: params.retryReviewOutputKey,
    retryConclusion: params.retryResult.conclusion,
    partialCommentId: params.partialCommentId,
    settlementReason: settlementDecision.reason,
    mergeContext,
    knowledgeStore: params.knowledgeStore,
    authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
    reviewBoundedness: params.reviewBoundedness,
    baseLog: params.baseLog,
    logger: params.logger,
    canPublishReviewWorkOutput: params.canPublishReviewWorkOutput,
    setPublishPhase: params.setPublishPhase,
    renderReviewDetailsBody: params.renderReviewDetailsBody,
    settleRetryWithoutCanonicalUpdate: params.settleRetryWithoutCanonicalUpdate,
    persistContinuationFamilyState: params.persistContinuationFamilyState,
  });
}
