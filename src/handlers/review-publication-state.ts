import type { ExecutionResult, ReviewPhaseTiming } from "../execution/types.ts";
import type { Result } from "../lib/result.ts";

export type ReviewErrorCommentDeliveryStatus = Result<{ resolution?: string; method?: string }>;

export type ReviewExecutionOutcomeForPublication = {
  stopReason?: string;
  failureSubtype?: string;
} | undefined;

export function describeReviewErrorCommentDelivery(
  status: ReviewErrorCommentDeliveryStatus,
): string {
  if (!status.ok) return "error-comment-failed";
  return status.value.resolution === "updated" ? "error-comment-updated" : "error-comment-created";
}

export function describeTurnLimitNoticeDelivery(
  status: ReviewErrorCommentDeliveryStatus,
): string {
  if (!status.ok) return "turn-limit-comment-undelivered";
  return status.value.resolution === "updated" ? "turn-limit-comment-updated" : "turn-limit-comment-created";
}

export function isExpectedTurnLimitReviewOutcome(
  result: ReviewExecutionOutcomeForPublication,
): boolean {
  return result?.stopReason === "max_turns" || result?.failureSubtype === "error_max_turns";
}

export function cleanTurnLimitReviewPublishResolution(resolution: string): string {
  return resolution === "turn-limit-fallback-failed"
    ? "turn-limit-fallback-undelivered"
    : resolution;
}

export function buildReviewExecutionCompletedLogFields(params: {
  prNumber: number;
  executorResult: Pick<
    ExecutionResult,
    "conclusion" | "failureSubtype" | "stopReason" | "costUsd" | "numTurns" | "durationMs" | "sessionId"
  >;
  reviewOutputPublished: boolean;
  reviewExecutorPublished: boolean;
  reviewPublishResolution: string;
  reviewPublishFallbackDelivery?: string;
}): Record<string, unknown> {
  const expectedTurnLimitOutcome = isExpectedTurnLimitReviewOutcome(params.executorResult);
  return {
    prNumber: params.prNumber,
    conclusion: expectedTurnLimitOutcome ? "expected_bounded" : params.executorResult.conclusion,
    ...(expectedTurnLimitOutcome
      ? { boundedOutcomeReason: "max_turns" }
      : { failureSubtype: params.executorResult.failureSubtype }),
    published: params.reviewOutputPublished,
    executorPublished: params.reviewExecutorPublished,
    publishResolution: expectedTurnLimitOutcome
      ? cleanTurnLimitReviewPublishResolution(params.reviewPublishResolution)
      : params.reviewPublishResolution,
    publishFallbackDelivery: params.reviewPublishFallbackDelivery,
    stopReason: params.executorResult.stopReason,
    costUsd: params.executorResult.costUsd,
    numTurns: params.executorResult.numTurns,
    durationMs: params.executorResult.durationMs,
    sessionId: params.executorResult.sessionId,
  };
}

export function createReviewExecutionCompletedLogger(params: {
  logger: {
    info(fields: Record<string, unknown>, message?: string): void;
  };
  getState: () => {
    prNumber: number;
    executorResult?: Pick<
      ExecutionResult,
      "conclusion" | "failureSubtype" | "stopReason" | "costUsd" | "numTurns" | "durationMs" | "sessionId"
    >;
    reviewOutputPublished: boolean;
    reviewExecutorPublished: boolean;
    reviewPublishResolution: string;
    reviewPublishFallbackDelivery?: string;
  };
}): () => void {
  let reviewExecutionLogged = false;
  return () => {
    const state = params.getState();
    if (!state.executorResult || reviewExecutionLogged) return;
    reviewExecutionLogged = true;
    params.logger.info(
      buildReviewExecutionCompletedLogFields({
        prNumber: state.prNumber,
        executorResult: state.executorResult,
        reviewOutputPublished: state.reviewOutputPublished,
        reviewExecutorPublished: state.reviewExecutorPublished,
        reviewPublishResolution: state.reviewPublishResolution,
        reviewPublishFallbackDelivery: state.reviewPublishFallbackDelivery,
      }),
      "Review execution completed",
    );
  };
}

export function buildReviewPhaseTimingSummaryLogFields(params: {
  deliveryId: string;
  reviewOutputKey: string;
  installationId: number;
  repo: string;
  prNumber: number;
  executorResult?: Pick<ExecutionResult, "conclusion" | "stopReason" | "failureSubtype">;
  reviewOutputPublished: boolean;
  reviewPublishResolution: string;
  reviewPublishFallbackDelivery?: string;
  totalDurationMs: number;
  phases: ReviewPhaseTiming[];
}): Record<string, unknown> {
  const expectedTurnLimitOutcome = isExpectedTurnLimitReviewOutcome(params.executorResult);
  return {
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    installationId: params.installationId,
    repo: params.repo,
    prNumber: params.prNumber,
    conclusion: expectedTurnLimitOutcome ? "expected_bounded" : params.executorResult?.conclusion,
    ...(expectedTurnLimitOutcome
      ? { boundedOutcomeReason: "max_turns" }
      : {}),
    published: params.executorResult ? params.reviewOutputPublished : undefined,
    publishResolution: params.executorResult
      ? expectedTurnLimitOutcome
        ? cleanTurnLimitReviewPublishResolution(params.reviewPublishResolution)
        : params.reviewPublishResolution
      : undefined,
    publishFallbackDelivery: params.reviewPublishFallbackDelivery,
    totalDurationMs: params.totalDurationMs,
    phases: params.phases,
  };
}

export function buildReviewDetailsPublicationCompletedLogFields(params: {
  baseLog: Record<string, unknown>;
  reviewOutputKey: string;
  deliveryId: string;
  publicationMode: "canonical" | "degraded-fallback";
  surfaceKind: string;
  commentId?: number;
  reviewId?: number;
  doctrineFields?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...params.baseLog,
    gate: "review-details-output",
    gateResult: "completed",
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    reviewDetailsPublished: true,
    publicationMode: params.publicationMode,
    surfaceKind: params.surfaceKind,
    hasCommentId: typeof params.commentId === "number",
    hasReviewId: typeof params.reviewId === "number",
    ...(params.doctrineFields ?? {}),
  };
}

export function buildCanonicalReviewDetailsPublicationCompletedLogFields(params: {
  surface:
    | { kind: "issue_comment"; commentId: number }
    | { kind: "pull_review"; reviewId: number }
    | undefined;
  baseLog: Record<string, unknown>;
  reviewOutputKey: string;
  deliveryId: string;
  publicationMode?: "canonical" | "degraded-fallback";
  doctrineFields?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  if (!params.surface) {
    return undefined;
  }

  return buildReviewDetailsPublicationCompletedLogFields({
    baseLog: params.baseLog,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    publicationMode: params.publicationMode ?? "canonical",
    surfaceKind: params.surface.kind,
    ...(params.surface.kind === "issue_comment"
      ? { commentId: params.surface.commentId }
      : { reviewId: params.surface.reviewId }),
    doctrineFields: params.doctrineFields,
  });
}
