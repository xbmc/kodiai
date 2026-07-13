import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ExecutionResult } from "../execution/types.ts";
import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";
import type { ErrorCategory } from "../lib/errors.ts";
import type { MergeConfidence } from "../lib/merge-confidence.ts";
import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import type { TimeoutBudgetDetails } from "../lib/review-details-formatting.ts";
import { ok, type Result } from "../lib/result.ts";
import type { VisibleBudgetProjection } from "../review-visible-budget/visible-budget-behavior.ts";
import type { ReviewDetailsPublicationRuntime } from "./review-details-publication-runtime.ts";
import {
  publishCleanReviewApproval,
  type CleanReviewPublicationStatus,
} from "./review-clean-approval-publication.ts";
import {
  publishReviewExecutionErrorFallback,
  type ReviewExecutionErrorFallbackPublicationResult,
} from "./review-error-publication.ts";
import {
  publishReviewFailureFallback,
  type ReviewFailureFallbackPublicationResult,
} from "./review-failure-publication.ts";

export type ReviewFallbackPublicationStatePatch = {
  reviewOutputPublished?: boolean;
  reviewPublishResolution?: string;
  reviewPublishFallbackDelivery?: string;
};

export type ReviewFallbackPublicationResult = Result<ReviewFallbackPublicationStatePatch, never>;

export type ReviewFallbackExecutionErrorContext = {
  category: ErrorCategory;
  timeoutDuration: number;
  complexityInfo: string;
};

function resolveExecutionErrorFallbackContext(params: {
  executionErrorContext?: ReviewFallbackExecutionErrorContext;
  turnBudgetExhausted: boolean;
}): ReviewFallbackExecutionErrorContext | undefined {
  if (params.executionErrorContext) return params.executionErrorContext;
  if (!params.turnBudgetExhausted) return undefined;
  return {
    category: "timeout",
    timeoutDuration: 0,
    complexityInfo: "Review stopped after reaching its turn budget.",
  };
}

export type ReviewFallbackPublicationStateTarget = {
  reviewOutputPublished: boolean;
  reviewPublishResolution: string;
  reviewPublishFallbackDelivery?: string;
};

export function buildReviewFallbackPublicationAdapters(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  appSlug: string;
  visibleBudgetProjection: {
    refresh: () => VisibleBudgetProjection | null;
  };
}): Pick<
  Parameters<typeof publishReviewFallbackOutputs>[0],
  "getOctokit" | "getAppSlug" | "refreshVisibleBudgetProjection"
> {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
    getAppSlug: () => params.appSlug,
    refreshVisibleBudgetProjection: () => params.visibleBudgetProjection.refresh(),
  };
}

export function buildReviewFallbackPublicationParams(params: {
  publicationState: ReviewFallbackPublicationStateTarget;
  executionResult: Pick<ExecutionResult, "conclusion" | "published" | "errorMessage">;
  executionErrorContext?: ReviewFallbackExecutionErrorContext;
  suppressCleanApprovalReason?: string;
  publishedPartialReview: boolean;
  deferredPublicOutputForContinuation: boolean;
  turnBudgetExhausted: boolean;
  fallbackRetryState?: string;
  appliedTimeoutBudget?: TimeoutBudgetDetails | null;
  adapters: Pick<
    Parameters<typeof publishReviewFallbackOutputs>[0],
    "getOctokit" | "getAppSlug" | "refreshVisibleBudgetProjection"
  >;
  owner: string;
  repo: string;
  pr: { number: number };
  reviewConfig: { autoApprove: boolean };
  reviewOutputKey: string;
  deliveryId: string;
  installationId: number;
  promptFiles: readonly unknown[];
  canonicalReviewDetailsBody?: string | null;
  authorClassification: { searchEnrichment: { degraded: boolean } };
  reviewBoundedness: ReviewBoundednessContract | null;
  depBumpContext?: { mergeConfidence?: MergeConfidence | null } | null;
  logger: Logger;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  finalizePublicationPhaseTiming: ReviewDetailsPublicationRuntime["finalizePublicationPhaseTiming"];
  logReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logReviewDetailsPublicationCompleted"];
  logCanonicalReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logCanonicalReviewDetailsPublicationCompleted"];
}): Parameters<typeof publishAndApplyReviewFallbackOutputs>[0] {
  return {
    publicationState: params.publicationState,
    result: {
      conclusion: params.executionResult.conclusion,
      published: params.executionResult.published,
      errorMessage: params.executionResult.errorMessage,
    },
    executionErrorContext: params.executionErrorContext,
    suppressCleanApprovalReason: params.suppressCleanApprovalReason,
    publishedPartialReview: params.publishedPartialReview,
    deferredPublicOutputForContinuation: params.deferredPublicOutputForContinuation,
    turnBudgetExhausted: params.turnBudgetExhausted,
    fallbackRetryState: params.fallbackRetryState,
    appliedTimeoutBudget: params.appliedTimeoutBudget,
    getOctokit: params.adapters.getOctokit,
    getAppSlug: params.adapters.getAppSlug,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.pr.number,
    autoApprove: params.reviewConfig.autoApprove,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    promptFileCount: params.promptFiles.length,
    canonicalReviewDetailsBody: params.canonicalReviewDetailsBody,
    authorSearchEnrichmentDegraded: params.authorClassification.searchEnrichment.degraded,
    reviewBoundedness: params.reviewBoundedness,
    mergeConfidence: params.depBumpContext?.mergeConfidence ?? null,
    logger: params.logger,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
    refreshVisibleBudgetProjection: params.adapters.refreshVisibleBudgetProjection,
    renderReviewDetailsBody: params.renderReviewDetailsBody,
    finalizePublicationPhaseTiming: params.finalizePublicationPhaseTiming,
    logReviewDetailsPublicationCompleted: params.logReviewDetailsPublicationCompleted,
    logCanonicalReviewDetailsPublicationCompleted: params.logCanonicalReviewDetailsPublicationCompleted,
  };
}

export async function publishReviewFallbackOutputs(params: {
  result: Pick<ExecutionResult, "conclusion" | "published" | "errorMessage">;
  executionErrorContext?: ReviewFallbackExecutionErrorContext;
  suppressCleanApprovalReason?: string;
  publishedPartialReview: boolean;
  deferredPublicOutputForContinuation: boolean;
  turnBudgetExhausted: boolean;
  fallbackRetryState?: string;
  appliedTimeoutBudget?: TimeoutBudgetDetails | null;
  getOctokit: () => Promise<Octokit>;
  getAppSlug: () => string;
  owner: string;
  repo: string;
  prNumber: number;
  autoApprove: boolean;
  reviewOutputKey: string;
  deliveryId: string;
  installationId: number;
  promptFileCount: number;
  canonicalReviewDetailsBody?: string | null;
  authorSearchEnrichmentDegraded: boolean;
  reviewBoundedness: ReviewBoundednessContract | null;
  mergeConfidence?: MergeConfidence | null;
  logger: Logger;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
  refreshVisibleBudgetProjection: () => VisibleBudgetProjection | null;
  renderReviewDetailsBody: ReviewDetailsPublicationRuntime["renderReviewDetailsBody"];
  finalizePublicationPhaseTiming: ReviewDetailsPublicationRuntime["finalizePublicationPhaseTiming"];
  logReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logReviewDetailsPublicationCompleted"];
  logCanonicalReviewDetailsPublicationCompleted: ReviewDetailsPublicationRuntime["logCanonicalReviewDetailsPublicationCompleted"];
  publishExecutionErrorFallback?: typeof publishReviewExecutionErrorFallback;
  publishFailureFallback?: typeof publishReviewFailureFallback;
  publishCleanReviewApproval?: typeof publishCleanReviewApproval;
}): Promise<ReviewFallbackPublicationResult> {
  const patch: ReviewFallbackPublicationStatePatch = {};

  const executionErrorContext = resolveExecutionErrorFallbackContext(params);

  if (
    executionErrorContext
    && params.result.conclusion !== "success"
    && !params.publishedPartialReview
    && !params.deferredPublicOutputForContinuation
  ) {
    const publishExecutionErrorFallback =
      params.publishExecutionErrorFallback ?? publishReviewExecutionErrorFallback;
    const errorPublication: ReviewExecutionErrorFallbackPublicationResult =
      await publishExecutionErrorFallback({
        octokit: await params.getOctokit(),
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        exhaustedTurnBudget: params.turnBudgetExhausted,
        retryScheduled: params.fallbackRetryState?.startsWith("scheduled") === true,
        category: executionErrorContext.category,
        errorMessage: params.result.errorMessage ?? (
          params.turnBudgetExhausted
            ? "Review stopped after reaching its turn budget."
            : undefined
        ),
        totalTimeoutSeconds: executionErrorContext.timeoutDuration,
        complexityInfo: executionErrorContext.complexityInfo,
        timeoutEstimate: params.appliedTimeoutBudget,
        logger: params.logger,
        canPublishVisibleOutput: params.canPublishVisibleOutput,
        setReviewWorkPhase: params.setReviewWorkPhase,
      });
    const errorPublicationState = errorPublication.ok
      ? errorPublication.value
      : errorPublication.err;
    if (errorPublicationState.resolution !== "skipped") {
      patch.reviewOutputPublished = errorPublicationState.published;
      patch.reviewPublishResolution = errorPublicationState.resolution;
      patch.reviewPublishFallbackDelivery = errorPublicationState.fallbackDelivery;
    }
  }

  if (
    params.result.conclusion === "failure"
    && !(params.result.published ?? false)
    && !params.turnBudgetExhausted
  ) {
    const publishFailureFallback = params.publishFailureFallback ?? publishReviewFailureFallback;
    const failurePublication: ReviewFailureFallbackPublicationResult =
      await publishFailureFallback({
        octokit: await params.getOctokit(),
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        logger: params.logger,
        canPublishVisibleOutput: params.canPublishVisibleOutput,
        setReviewWorkPhase: params.setReviewWorkPhase,
      });
    const failurePublicationState = failurePublication.ok
      ? failurePublication.value
      : failurePublication.err;
    patch.reviewPublishFallbackDelivery = failurePublicationState.fallbackDelivery;
    if (failurePublicationState.resolution !== "skipped") {
      patch.reviewOutputPublished = failurePublicationState.published;
      patch.reviewPublishResolution = failurePublicationState.resolution;
    }
  }

  if (params.result.conclusion === "success" && params.suppressCleanApprovalReason) {
    params.logger.info(
      {
        prNumber: params.prNumber,
        gate: "auto-approve",
        gateResult: "skipped",
        skipReason: params.suppressCleanApprovalReason,
      },
      "Skipping clean review approval because review findings were not clean",
    );
  }

  if (params.result.conclusion === "success" && !params.suppressCleanApprovalReason) {
    const publishCleanApproval = params.publishCleanReviewApproval ?? publishCleanReviewApproval;
    const cleanReviewPublication: CleanReviewPublicationStatus = await publishCleanApproval({
      resultPublished: params.result.published ?? false,
      autoApprove: params.autoApprove,
      getOctokit: params.getOctokit,
      getAppSlug: params.getAppSlug,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      promptFileCount: params.promptFileCount,
      canonicalReviewDetailsBody: params.canonicalReviewDetailsBody,
      authorSearchEnrichmentDegraded: params.authorSearchEnrichmentDegraded,
      reviewBoundedness: params.reviewBoundedness,
      mergeConfidence: params.mergeConfidence,
      logger: params.logger,
      canPublishVisibleOutput: params.canPublishVisibleOutput,
      setReviewWorkPhase: params.setReviewWorkPhase,
      refreshVisibleBudgetProjection: params.refreshVisibleBudgetProjection,
      renderReviewDetailsBody: params.renderReviewDetailsBody,
      finalizePublicationPhaseTiming: params.finalizePublicationPhaseTiming,
      logReviewDetailsPublicationCompleted: params.logReviewDetailsPublicationCompleted,
      logCanonicalReviewDetailsPublicationCompleted: params.logCanonicalReviewDetailsPublicationCompleted,
    });
    const cleanReviewPublicationState = cleanReviewPublication.ok
      ? cleanReviewPublication.value
      : { published: false as const, resolution: "skipped" as const };
    if (cleanReviewPublicationState.published) {
      patch.reviewOutputPublished = true;
      patch.reviewPublishResolution = cleanReviewPublicationState.resolution;
    }
  }

  return ok(patch);
}

export function applyReviewFallbackPublicationStatePatch(
  target: ReviewFallbackPublicationStateTarget,
  patch: ReviewFallbackPublicationStatePatch,
): void {
  const reviewOutputPublished = patch.reviewOutputPublished;
  if (reviewOutputPublished !== undefined) {
    target.reviewOutputPublished = reviewOutputPublished;
  }
  const reviewPublishResolution = patch.reviewPublishResolution;
  if (reviewPublishResolution !== undefined) {
    target.reviewPublishResolution = reviewPublishResolution;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "reviewPublishFallbackDelivery")) {
    target.reviewPublishFallbackDelivery = patch.reviewPublishFallbackDelivery;
  }
}

export async function publishAndApplyReviewFallbackOutputs(
  params: Parameters<typeof publishReviewFallbackOutputs>[0] & {
    publicationState: ReviewFallbackPublicationStateTarget;
  },
): Promise<ReviewFallbackPublicationResult> {
  const { publicationState, ...publicationParams } = params;
  const fallbackPublication = await publishReviewFallbackOutputs(publicationParams);
  if (!fallbackPublication.ok) return fallbackPublication;
  applyReviewFallbackPublicationStatePatch(publicationState, fallbackPublication.value);
  return fallbackPublication;
}
