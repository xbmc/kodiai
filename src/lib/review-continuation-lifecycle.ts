import type { CheckpointRecord } from "../knowledge/types.ts";
import type { PromptBudgetOutcome } from "../execution/prompt-budget.ts";
import type { ReviewCacheTelemetryObservation } from "../review-cache-telemetry/cache-telemetry.ts";
import type { ContinuationCompactionObservation } from "../review-continuation/continuation-compaction.ts";
import type { FileRiskScore } from "./file-risk-scorer.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { computeRetryScope } from "./retry-scope-reducer.ts";

export type ContinuationTimeoutEstimate = {
  riskLevel: "low" | "medium" | "high";
  dynamicTimeoutSeconds: number;
  reasoning: string;
  shouldReduceScope: boolean;
};

export type EstimateContinuationTimeoutParams = {
  timeoutSeconds: number;
  files: string[];
};

export type ContinuationCompactionPlanningSignals = {
  attemptId: string;
  priorAttemptId?: string;
  attemptOrdinal?: number;
  promptBudgetOutcomes: readonly PromptBudgetOutcome[];
  cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
};

export type PlanReviewContinuationParams = {
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload | null;
  checkpoint: CheckpointRecord | null;
  riskScores: FileRiskScore[];
  timeoutSeconds: number;
  hasPublishedInlineFindings: boolean;
  isChronicTimeout: boolean;
  continuationCompaction?: ContinuationCompactionPlanningSignals;
  estimateContinuationTimeout: (
    params: EstimateContinuationTimeoutParams,
  ) => ContinuationTimeoutEstimate;
};

export type ScheduleContinuationDecision = {
  decision: "schedule-continuation";
  reason: "remaining-scope-available";
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  continuationNumber: 1;
  continuationFiles: string[];
  scopeRatio: number;
  timeoutSeconds: number;
  checkpointEnabled: boolean;
  timeoutEstimate: ContinuationTimeoutEstimate;
  firstPass: ReviewFirstPassPayload;
  checkpoint: CheckpointRecord | null;
  continuationCompaction?: ContinuationCompactionObservation;
};

export type SkipContinuationReason =
  | "zero-evidence-failure"
  | "inline-output-already-published"
  | "invalid-checkpoint-scope"
  | "no-remaining-scope"
  | "chronic-timeout";

export type SkipContinuationDecision = {
  decision: "skip-continuation";
  reason: SkipContinuationReason;
  reviewOutputKey: string;
  firstPass: ReviewFirstPassPayload;
};

export type ReviewContinuationPlanDecision =
  | ScheduleContinuationDecision
  | SkipContinuationDecision;

export type SettleReviewContinuationParams = {
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  baseCheckpoint: CheckpointRecord | null;
  continuationCheckpoint: CheckpointRecord | null;
  continuationPublished: boolean;
};

export type MergeContinuationDecision = {
  decision: "merge-continuation";
  reason: "new-structured-results" | "inline-results-published";
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  mergedCheckpoint: CheckpointRecord;
  cleanupReviewOutputKeys: [string, string];
};

export type SettleWithoutUpdateDecision = {
  decision: "settle-without-update";
  reason: "no-new-results";
  reviewOutputKey: string;
  continuationReviewOutputKey: string;
  cleanupReviewOutputKeys: [string, string];
};

export type ReviewContinuationSettlementDecision =
  | MergeContinuationDecision
  | SettleWithoutUpdateDecision;

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertValidPositiveTimeoutSeconds(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function isValidCheckpointScope(checkpoint: CheckpointRecord | null): boolean {
  if (!checkpoint) {
    return true;
  }

  return checkpoint.filesReviewed.length <= checkpoint.totalFiles;
}

function deriveContinuationReviewOutputKey(reviewOutputKey: string, continuationNumber: number): string {
  return `${reviewOutputKey}-retry-${continuationNumber}`;
}

function mergeCheckpointState(params: {
  baseCheckpoint: CheckpointRecord;
  continuationCheckpoint: CheckpointRecord;
}): CheckpointRecord {
  const { baseCheckpoint, continuationCheckpoint } = params;

  return {
    ...baseCheckpoint,
    filesReviewed: Array.from(new Set([
      ...baseCheckpoint.filesReviewed,
      ...continuationCheckpoint.filesReviewed,
    ])),
    findingCount: Math.max(baseCheckpoint.findingCount, continuationCheckpoint.findingCount),
    summaryDraft: continuationCheckpoint.summaryDraft || baseCheckpoint.summaryDraft,
    totalFiles: Math.max(baseCheckpoint.totalFiles, continuationCheckpoint.totalFiles),
    partialCommentId: continuationCheckpoint.partialCommentId ?? baseCheckpoint.partialCommentId,
  };
}

function hasNewReviewedFiles(baseCheckpoint: CheckpointRecord, continuationCheckpoint: CheckpointRecord): boolean {
  const reviewedSet = new Set(baseCheckpoint.filesReviewed);
  return continuationCheckpoint.filesReviewed.some((file) => !reviewedSet.has(file));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function deriveBudgetSignalNames(outcomes: readonly PromptBudgetOutcome[]): string[] {
  return uniqueSorted(outcomes.map((outcome) => `prompt-budget.${outcome.status}`));
}

function deriveCacheSignalNames(observations: readonly ReviewCacheTelemetryObservation[]): string[] {
  return uniqueSorted(observations.flatMap((observation) => [
    ...(observation.safetySignalNames ?? []),
    ...(observation.missingSignalNames ?? []),
    ...(observation.invalidationSignalNames ?? []),
    ...(observation.status === "degraded" ? [`cache.${observation.reason ?? "degraded"}`] : []),
    ...(observation.status === "bypass" ? [`cache.${observation.reason ?? "bypass"}`] : []),
  ]));
}

function hasUsableCheckpointSummary(checkpoint: CheckpointRecord | null): boolean {
  return typeof checkpoint?.summaryDraft === "string" && checkpoint.summaryDraft.trim().length > 0;
}

function buildContinuationCompactionObservation(params: {
  reviewOutputKey: string;
  repo: string;
  attemptId: string;
  priorAttemptId?: string;
  attemptOrdinal?: number;
  checkpoint: CheckpointRecord | null;
  continuationFiles: readonly string[];
  omittedScopeCount: number;
  promptBudgetOutcomes: readonly PromptBudgetOutcome[];
  cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
}): ContinuationCompactionObservation {
  const budgetSignalNames = deriveBudgetSignalNames(params.promptBudgetOutcomes);
  const cacheSignalNames = deriveCacheSignalNames(params.cacheTelemetryObservations);
  const degradedCacheSignals = params.cacheTelemetryObservations.some((observation) => observation.status === "degraded");
  const unsafeCacheSignals = params.cacheTelemetryObservations.some((observation) => observation.status !== "hit" && observation.status !== "degraded");
  const hasCompleteBudgetSignals = params.promptBudgetOutcomes.length > 0
    && params.promptBudgetOutcomes.every((outcome) => outcome.status === "included");
  const hasCompleteCacheSignals = params.cacheTelemetryObservations.length > 0
    && params.cacheTelemetryObservations.every((observation) => observation.status === "hit")
    && cacheSignalNames.length > 0;

  const base = {
    caseId: "retry-prompt-compaction",
    deliveryId: params.reviewOutputKey,
    repo: params.repo,
    attemptId: params.attemptId,
    ...(params.priorAttemptId ? { priorAttemptId: params.priorAttemptId } : {}),
    ...(params.attemptOrdinal !== undefined ? { attemptOrdinal: params.attemptOrdinal } : {}),
    includedDeltaCount: params.continuationFiles.length,
    reusedCheckpointCount: 0,
    omittedScopeCount: params.omittedScopeCount,
    remainingScopeCount: params.continuationFiles.length,
  } as const;

  if (!params.checkpoint) {
    return {
      ...base,
      status: "fallback",
      reason: "missing-checkpoint",
      fallbackState: "fuller-context",
      missingSignalNames: ["checkpoint.summary"],
      budgetSignalNames,
      cacheSignalNames,
    };
  }

  if (!hasUsableCheckpointSummary(params.checkpoint)) {
    return {
      ...base,
      status: "fallback",
      reason: "malformed-prior-state",
      fallbackState: "fuller-context",
      missingSignalNames: ["checkpoint.summary"],
      budgetSignalNames,
      cacheSignalNames,
    };
  }

  if (!hasCompleteBudgetSignals) {
    return {
      ...base,
      status: "fallback",
      reason: "missing-budget-signal",
      fallbackState: "fuller-context",
      missingSignalNames: ["prompt-budget.included"],
      budgetSignalNames,
      cacheSignalNames,
    };
  }

  if (degradedCacheSignals) {
    return {
      ...base,
      status: "degraded",
      reason: "degraded-cache-signal",
      fallbackState: "partial-context",
      reusedCheckpointCount: 1,
      missingSignalNames: cacheSignalNames.length === 0 ? ["cache.safe-reuse"] : undefined,
      safetySignalNames: budgetSignalNames,
      budgetSignalNames,
      cacheSignalNames: cacheSignalNames.length > 0 ? cacheSignalNames : ["cache.degraded"],
    };
  }

  if (unsafeCacheSignals || !hasCompleteCacheSignals) {
    return {
      ...base,
      status: "fallback",
      reason: "unsafe-cache-state",
      fallbackState: "fuller-context",
      missingSignalNames: cacheSignalNames.length === 0 ? ["cache.safe-reuse"] : undefined,
      budgetSignalNames,
      cacheSignalNames,
    };
  }

  return {
    ...base,
    status: "compacted",
    reason: "safe-delta-reuse",
    fallbackState: "none",
    priorAttemptId: params.priorAttemptId ?? params.checkpoint.reviewOutputKey,
    reusedCheckpointCount: 1,
    safetySignalNames: uniqueSorted([...budgetSignalNames, ...cacheSignalNames, "checkpoint.summary"]),
    budgetSignalNames,
    cacheSignalNames,
  };
}

export function planReviewContinuation(
  params: PlanReviewContinuationParams,
): ReviewContinuationPlanDecision {
  assertNonEmptyString(params.reviewOutputKey, "reviewOutputKey");
  assertValidPositiveTimeoutSeconds(params.timeoutSeconds, "timeoutSeconds");

  const firstPass = params.firstPass;
  if (!firstPass) {
    throw new Error("firstPass must be provided");
  }

  if (firstPass.state === "zero-evidence-failure" || firstPass.zeroEvidenceFailure) {
    return {
      decision: "skip-continuation",
      reason: "zero-evidence-failure",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  if (params.hasPublishedInlineFindings || firstPass.publication.hasPublishedOutput) {
    return {
      decision: "skip-continuation",
      reason: "inline-output-already-published",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  if (params.isChronicTimeout) {
    return {
      decision: "skip-continuation",
      reason: "chronic-timeout",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  if (!isValidCheckpointScope(params.checkpoint)) {
    return {
      decision: "skip-continuation",
      reason: "invalid-checkpoint-scope",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  const totalFiles = params.checkpoint?.totalFiles
    ?? firstPass.remainingScope?.totalFiles
    ?? firstPass.coveredScope?.totalFiles
    ?? params.riskScores.length;
  const filesAlreadyReviewed = params.checkpoint?.filesReviewed ?? [];
  const retryScope = computeRetryScope({
    allFiles: params.riskScores,
    filesAlreadyReviewed,
    totalFiles,
  });

  if (
    (firstPass.remainingScope && firstPass.remainingScope.remainingFiles <= 0)
    || retryScope.filesToReview.length === 0
  ) {
    if (firstPass.remainingScope && firstPass.remainingScope.remainingFiles > 0 && retryScope.filesToReview.length === 0) {
      throw new Error("continuation files cannot be empty when remaining scope exists");
    }

    return {
      decision: "skip-continuation",
      reason: "no-remaining-scope",
      reviewOutputKey: params.reviewOutputKey,
      firstPass,
    };
  }

  const continuationFiles = retryScope.filesToReview.map((file) => file.filePath);
  const retryCoversAllRemaining = retryScope.scopeRatio >= 1;
  const continuationTimeoutSeconds = retryCoversAllRemaining
    ? params.timeoutSeconds
    : Math.max(30, Math.floor(params.timeoutSeconds / 2));
  const timeoutEstimate = params.estimateContinuationTimeout({
    timeoutSeconds: continuationTimeoutSeconds,
    files: continuationFiles,
  });
  const scheduledTimeoutSeconds = Math.max(30, timeoutEstimate.dynamicTimeoutSeconds);

  const continuationCompaction = params.continuationCompaction
    ? buildContinuationCompactionObservation({
        reviewOutputKey: params.reviewOutputKey,
        repo: params.checkpoint?.repo ?? "unknown/repo",
        attemptId: params.continuationCompaction.attemptId,
        priorAttemptId: params.continuationCompaction.priorAttemptId,
        attemptOrdinal: params.continuationCompaction.attemptOrdinal,
        checkpoint: params.checkpoint,
        continuationFiles,
        omittedScopeCount: filesAlreadyReviewed.length,
        promptBudgetOutcomes: params.continuationCompaction.promptBudgetOutcomes,
        cacheTelemetryObservations: params.continuationCompaction.cacheTelemetryObservations,
      })
    : undefined;

  return {
    decision: "schedule-continuation",
    reason: "remaining-scope-available",
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: deriveContinuationReviewOutputKey(params.reviewOutputKey, 1),
    continuationNumber: 1,
    continuationFiles,
    scopeRatio: retryScope.scopeRatio,
    timeoutSeconds: scheduledTimeoutSeconds,
    checkpointEnabled: timeoutEstimate.riskLevel === "medium" || timeoutEstimate.riskLevel === "high",
    timeoutEstimate,
    firstPass,
    checkpoint: params.checkpoint,
    ...(continuationCompaction ? { continuationCompaction } : {}),
  };
}

export function settleReviewContinuation(
  params: SettleReviewContinuationParams,
): ReviewContinuationSettlementDecision {
  assertNonEmptyString(params.reviewOutputKey, "reviewOutputKey");
  assertNonEmptyString(params.continuationReviewOutputKey, "continuationReviewOutputKey");

  if (!params.baseCheckpoint) {
    throw new Error("base checkpoint is required for continuation settlement");
  }

  if (!params.continuationCheckpoint) {
    return {
      decision: "settle-without-update",
      reason: "no-new-results",
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: params.continuationReviewOutputKey,
      cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
    };
  }

  const mergedCheckpoint = mergeCheckpointState({
    baseCheckpoint: params.baseCheckpoint,
    continuationCheckpoint: params.continuationCheckpoint,
  });

  if (params.continuationPublished) {
    return {
      decision: "merge-continuation",
      reason: "inline-results-published",
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: params.continuationReviewOutputKey,
      mergedCheckpoint,
      cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
    };
  }

  if (
    params.continuationCheckpoint.findingCount > 0
    || hasNewReviewedFiles(params.baseCheckpoint, params.continuationCheckpoint)
  ) {
    return {
      decision: "merge-continuation",
      reason: "new-structured-results",
      reviewOutputKey: params.reviewOutputKey,
      continuationReviewOutputKey: params.continuationReviewOutputKey,
      mergedCheckpoint,
      cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
    };
  }

  return {
    decision: "settle-without-update",
    reason: "no-new-results",
    reviewOutputKey: params.reviewOutputKey,
    continuationReviewOutputKey: params.continuationReviewOutputKey,
    cleanupReviewOutputKeys: [params.reviewOutputKey, params.continuationReviewOutputKey],
  };
}
