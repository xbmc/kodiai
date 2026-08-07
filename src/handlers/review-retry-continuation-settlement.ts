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
 * Every quiet-settlement exit below (retry produced nothing usable, missing base
 * checkpoint, non-merge decision, no meaningful delta, non-publishable merge
 * context) discards the retry on the assumption that the *original* first-pass
 * review already put something visible on the PR. That assumption only holds
 * when the original attempt actually published a partial comment or inline
 * findings. If the original attempt deferred publication in favor of this retry
 * (the normal "let the retry publish the final result" flow) and the retry then
 * hits any of these quiet-settlement branches, quiet-settling would leave the PR
 * with zero visible output even though a full review attempt ran. Detect that
 * case so we can fail open with a clear "ran out of steps" comment instead of
 * silence.
 *
 * The retry's own publication state counts too: a retry that posted inline
 * findings via MCP (`retryResult.published`) has already put visible output on
 * the PR, so a settlement branch that discards its *checkpoint* must not then
 * post a "ran out of steps" comment contradicting the review the reader can see.
 */
function hasNothingBeenPublishedYet(params: {
  partialCommentId?: number;
  hasPublishedInlines?: boolean;
  retryResult: Pick<ExecutionResult, "published">;
}): boolean {
  return params.partialCommentId === undefined
    && !params.hasPublishedInlines
    && !params.retryResult.published;
}

/**
 * What to do with a finished retry. Separating the decision from its execution
 * means the "nothing reached the PR yet" fallback is applied once, at the single
 * point every non-publishing outcome passes through, rather than being repeated
 * at each branch where it can be forgotten.
 */
type RetrySettlementPlan =
  | {
    kind: "quiet";
    reason: string;
    settlementReason?: string;
    persistFamilyState: boolean;
    discardCheckpoints: boolean;
  }
  | { kind: "no-canonical-update"; reason: string; logMessage: string }
  | {
    kind: "merge";
    settlementReason: string;
    mergeContext: Extract<ReturnType<typeof resolveReviewContinuationMergeContext>, { status: "publishable" }>;
  };

async function planRetrySettlement(
  params: Parameters<typeof settleRetryContinuationResults>[0],
): Promise<RetrySettlementPlan> {
  if (!params.retryCompletedWithResults) {
    return { kind: "quiet", reason: "no-retry-results", persistFamilyState: false, discardCheckpoints: false };
  }

  if (!params.baseCheckpoint) {
    return {
      kind: "no-canonical-update",
      reason: "missing-base-checkpoint",
      logMessage: "Retry settlement skipped because the base checkpoint was missing",
    };
  }

  const settlementDecision = settleReviewContinuation({
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: params.retryReviewOutputKey,
    baseCheckpoint: params.baseCheckpoint,
    continuationCheckpoint: params.retryCheckpoint,
    continuationPublished: params.retryResult.published ?? false,
  });

  if (settlementDecision.decision !== "merge-continuation") {
    return {
      kind: "quiet",
      reason: settlementDecision.reason,
      settlementReason: settlementDecision.reason,
      persistFamilyState: true,
      discardCheckpoints: false,
    };
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
    return {
      kind: "quiet",
      reason: "no-meaningful-delta",
      settlementReason: "no-meaningful-delta",
      persistFamilyState: true,
      discardCheckpoints: true,
    };
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
    return {
      kind: "no-canonical-update",
      reason: mergeContext.reason,
      logMessage: "Retry merge skipped because bounded first-pass state became non-publishable",
    };
  }

  return { kind: "merge", settlementReason: settlementDecision.reason, mergeContext };
}

export type RetryContinuationSettlementStatus =
  | (RetryNoAdditionalResultsSettlementStatus & { published: boolean })
  | { status: "settled-without-canonical-update"; published: boolean; reason: string }
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
  hasPublishedInlines?: boolean;
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
  const postFallbackIfNothingPublished = async (settlementReason: string): Promise<boolean> => {
    if (!hasNothingBeenPublishedYet(params)) {
      return false;
    }

    const exhaustedTurnBudget =
      params.firstPassOutcome.stopReason === "max_turns" ||
      params.firstPassOutcome.failureSubtype === "error_max_turns" ||
      params.retryResult.stopReason === "max_turns" ||
      params.retryResult.failureSubtype === "error_max_turns";

    // This publisher emits *error* comments. A retry that ran to completion and
    // simply found nothing new is not an error, and labelling it one would be
    // the same false-notice problem this module exists to remove, just
    // inverted. There is no "completed, no findings" member of ErrorCategory
    // and inventing one would put a non-error concept in the error taxonomy --
    // so log the gap instead of narrating a failure that did not happen.
    if (params.retryCompletedWithResults && !exhaustedTurnBudget) {
      params.logger.warn(
        {
          deliveryId: params.deliveryId,
          prNumber: params.prNumber,
          retryConclusion: params.retryResult.conclusion,
          settlementReason,
        },
        "Retry completed with no additional findings and nothing had reached the PR -- no error comment posted (see review-retry-continuation-settlement.ts)",
      );
      return false;
    }

    const publishExecutionErrorFallback =
      params.publishReviewExecutionErrorFallbackFn ?? publishReviewExecutionErrorFallback;

    // This is the only GitHub call on the quiet-settlement paths, which
    // previously never touched the network. Letting it reject would skip the
    // settlement below and strand the retry's checkpoints and continuation
    // family state -- strictly worse than the silent drop this replaced.
    let fallbackPublication: Awaited<ReturnType<PublishReviewExecutionErrorFallback>> | undefined;
    try {
      fallbackPublication = await publishExecutionErrorFallback({
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
    } catch (err) {
      params.logger.error(
        { err, deliveryId: params.deliveryId, prNumber: params.prNumber, settlementReason },
        "Turn-limit fallback publication threw; settling the retry anyway so checkpoints are not stranded",
      );
      return false;
    }

    const postedFallback = fallbackPublication.ok ? fallbackPublication.value.published : false;

    params.logger.info(
      {
        deliveryId: params.deliveryId,
        prNumber: params.prNumber,
        retryConclusion: params.retryResult.conclusion,
        settlementReason,
        published: postedFallback,
      },
      "Retry settled without publishing and nothing had reached the PR yet -- posted fallback so the review does not silently disappear",
    );

    return postedFallback;
  };

  const plan = await planRetrySettlement(params);

  if (plan.kind === "merge") {
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
      settlementReason: plan.settlementReason,
      mergeContext: plan.mergeContext,
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

  // Every non-publishing outcome funnels through here, so the "did anything
  // reach the PR?" check cannot be forgotten when a new settlement branch is
  // added -- which is exactly how the original silent-drop bug happened.
  const published = await postFallbackIfNothingPublished(plan.reason);

  if (plan.kind === "no-canonical-update") {
    await params.settleRetryWithoutCanonicalUpdate({
      attemptId: params.attemptId,
      reviewOutputKey: params.retryReviewOutputKey,
      deliveryId: params.deliveryId,
      reason: plan.reason,
      logMessage: plan.logMessage,
    });
    return ok({ status: "settled-without-canonical-update", published, reason: plan.reason });
  }

  const quietSettlement = await settleRetryWithNoAdditionalResults({
    logger: params.logger,
    deliveryId: params.deliveryId,
    prNumber: params.prNumber,
    retryConclusion: params.retryResult.conclusion,
    ...(plan.settlementReason ? { settlementReason: plan.settlementReason } : {}),
    ...(plan.persistFamilyState
      ? {
        quietSettlement: {
          attemptId: params.attemptId,
          reviewOutputKey: params.retryReviewOutputKey,
          persistContinuationFamilyState: params.persistContinuationFamilyState,
        },
      }
      : {}),
    ...(plan.discardCheckpoints
      ? {
        discardCheckpoints: () => discardCheckpointsFailOpen(params.knowledgeStore, params.logger, [
          params.reviewOutputKey,
          params.retryReviewOutputKey,
        ]),
      }
      : {}),
  });
  if (!quietSettlement.ok) {
    return ok({
      status: "quiet-settled",
      published,
      persistedContinuationState: false,
      discardedCheckpoints: false,
      reason: plan.reason,
    });
  }
  return ok({ ...quietSettlement.value, published });
}
