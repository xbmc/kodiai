import type { Logger } from "pino";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import type {
  ContinuationFamilyAuthoritativeOutcome,
  ContinuationFamilyFinalStopReason,
  ContinuationFamilyProjectionStatus,
  KnowledgeStore,
} from "../knowledge/types.ts";

export function extractBaseReviewOutputKey(reviewOutputKey: string): string {
  return reviewOutputKey.replace(/-retry-\d+$/, "");
}

export function parseAttemptOrdinal(attemptId: string): number {
  const match = /(?:^|[^\d])(\d+)$/.exec(attemptId);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

type PersistContinuationFamilyStateParams = {
  authoritativeAttemptId: string;
  authoritativeAttemptOrdinal?: number;
  authoritativeOutcome: ContinuationFamilyAuthoritativeOutcome;
  finalStopReason: ContinuationFamilyFinalStopReason;
  projectionStatus: ContinuationFamilyProjectionStatus;
  supersededByAttemptId?: string | null;
  reviewOutputKey?: string;
};

type ReviewContinuationFamilyStateManagerDeps = {
  logger: Logger;
  baseLog: Record<string, unknown>;
  reviewFamilyKey: string;
  reviewOutputKey: string;
  knowledgeStore?: Pick<KnowledgeStore, "upsertContinuationFamilyState">;
  reviewWorkCoordinator: Pick<ReviewWorkCoordinator, "getSnapshot" | "canPublish">;
};

export type ReviewContinuationFamilyStateManager = {
  persistContinuationFamilyState: (params: PersistContinuationFamilyStateParams) => Promise<void>;
  persistDegradedContinuationFamilyState: (params: Omit<PersistContinuationFamilyStateParams, "projectionStatus">) => Promise<void>;
  settleRetryWithoutCanonicalUpdate: (params: {
    attemptId: string;
    reviewOutputKey?: string;
    deliveryId: string;
    reason: string;
    logMessage: string;
  }) => Promise<void>;
  finalizeContinuationAttempt: (params: {
    attemptId: string;
    fallbackOutcome: ContinuationFamilyAuthoritativeOutcome;
    fallbackStopReason: ContinuationFamilyFinalStopReason;
    reviewOutputKey?: string;
  }) => Promise<void>;
  canPublishReviewWorkOutput: (attemptId: string, outputLabel: string, deliveryId: string) => boolean;
};

export function createReviewContinuationFamilyStateManager(
  deps: ReviewContinuationFamilyStateManagerDeps,
): ReviewContinuationFamilyStateManager {
  async function persistContinuationFamilyState(params: PersistContinuationFamilyStateParams): Promise<void> {
    if (!deps.knowledgeStore?.upsertContinuationFamilyState) {
      return;
    }

    const authoritativeAttemptOrdinal = params.authoritativeAttemptOrdinal
      ?? parseAttemptOrdinal(params.authoritativeAttemptId);
    if (!Number.isFinite(authoritativeAttemptOrdinal) || authoritativeAttemptOrdinal < 1) {
      deps.logger.warn(
        {
          ...deps.baseLog,
          gate: "continuation-family-state",
          gateResult: "skipped",
          reason: "invalid-attempt-ordinal",
          authoritativeAttemptId: params.authoritativeAttemptId,
        },
        "Skipping canonical continuation-family state write because the attempt ordinal was invalid",
      );
      return;
    }

    try {
      await deps.knowledgeStore.upsertContinuationFamilyState({
        familyKey: deps.reviewFamilyKey,
        baseReviewOutputKey: extractBaseReviewOutputKey(params.reviewOutputKey ?? deps.reviewOutputKey),
        authoritativeAttemptId: params.authoritativeAttemptId,
        authoritativeAttemptOrdinal,
        authoritativeOutcome: params.authoritativeOutcome,
        finalStopReason: params.finalStopReason,
        projectionStatus: params.projectionStatus,
        supersededByAttemptId: params.supersededByAttemptId ?? null,
      });
    } catch (err) {
      deps.logger.warn(
        {
          ...deps.baseLog,
          gate: "continuation-family-state",
          gateResult: "degraded",
          authoritativeAttemptId: params.authoritativeAttemptId,
          authoritativeOutcome: params.authoritativeOutcome,
          finalStopReason: params.finalStopReason,
          err,
        },
        "Failed to persist canonical continuation-family state",
      );
    }
  }

  async function persistDegradedContinuationFamilyState(
    params: Omit<PersistContinuationFamilyStateParams, "projectionStatus">,
  ): Promise<void> {
    await persistContinuationFamilyState({
      ...params,
      projectionStatus: "degraded",
    });
  }

  async function settleRetryWithoutCanonicalUpdate(params: {
    attemptId: string;
    reviewOutputKey?: string;
    deliveryId: string;
    reason: string;
    logMessage: string;
  }): Promise<void> {
    deps.logger.warn(
      {
        deliveryId: params.deliveryId,
        prNumber: deps.baseLog.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        reason: params.reason,
      },
      params.logMessage,
    );
    await persistContinuationFamilyState({
      authoritativeAttemptId: params.attemptId,
      authoritativeOutcome: "quiet-settled",
      finalStopReason: "settled-without-update",
      projectionStatus: "canonical",
      reviewOutputKey: params.reviewOutputKey,
    });
  }

  async function finalizeContinuationAttempt(params: {
    attemptId: string;
    fallbackOutcome: ContinuationFamilyAuthoritativeOutcome;
    fallbackStopReason: ContinuationFamilyFinalStopReason;
    reviewOutputKey?: string;
  }): Promise<void> {
    const currentAttempt = deps.reviewWorkCoordinator
      .getSnapshot(deps.reviewFamilyKey)
      ?.attempts.find((attempt) => attempt.attemptId === params.attemptId);
    const supersededByAttemptId = currentAttempt?.supersededByAttemptId ?? null;

    if (supersededByAttemptId) {
      await persistContinuationFamilyState({
        authoritativeAttemptId: supersededByAttemptId,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId,
        reviewOutputKey: params.reviewOutputKey,
      });
      return;
    }

    await persistContinuationFamilyState({
      authoritativeAttemptId: params.attemptId,
      authoritativeOutcome: params.fallbackOutcome,
      finalStopReason: params.fallbackStopReason,
      projectionStatus: "canonical",
      reviewOutputKey: params.reviewOutputKey,
    });
  }

  function canPublishReviewWorkOutput(
    attemptId: string,
    outputLabel: string,
    deliveryId: string,
  ): boolean {
    if (deps.reviewWorkCoordinator.canPublish(attemptId)) {
      return true;
    }

    const currentAttempt = deps.reviewWorkCoordinator
      .getSnapshot(deps.reviewFamilyKey)
      ?.attempts.find((attempt) => attempt.attemptId === attemptId);
    const supersededByAttemptId = currentAttempt?.supersededByAttemptId ?? null;
    if (supersededByAttemptId) {
      void persistContinuationFamilyState({
        authoritativeAttemptId: supersededByAttemptId,
        authoritativeOutcome: "superseded",
        finalStopReason: "superseded-by-newer-attempt",
        projectionStatus: "canonical",
        supersededByAttemptId,
      });
    }
    deps.logger.info(
      {
        ...deps.baseLog,
        deliveryId,
        gate: "review-family-coordinator",
        gateResult: "skipped",
        skipReason: "publish-rights-lost",
        reviewFamilyKey: deps.reviewFamilyKey,
        reviewWorkAttemptId: attemptId,
        supersededByAttemptId,
      },
      `Skipping ${outputLabel} because publish rights were superseded`,
    );
    return false;
  }

  return {
    persistContinuationFamilyState,
    persistDegradedContinuationFamilyState,
    settleRetryWithoutCanonicalUpdate,
    finalizeContinuationAttempt,
    canPublishReviewWorkOutput,
  };
}
