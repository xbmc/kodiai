import type {
  ReviewWorkAttempt,
  ReviewWorkCoordinator,
  ReviewWorkPhase,
} from "../jobs/review-work-coordinator.ts";
import type { MentionEvent } from "./mention-types.ts";

type ReviewWorkLogger = {
  info(fields: unknown, message?: string): void;
};

export type MentionReviewWorkRuntime = {
  attempt: ReviewWorkAttempt | undefined;
  readonly reviewPublishRightsLost: boolean;
  setPhase(phase: ReviewWorkPhase): void;
  canPublishExplicitReviewOutput(outputLabel: string, reviewOutputKey?: string): boolean;
  finalize(): void;
};

export function usesCanonicalExplicitReviewHandle(params: {
  attempt: ReviewWorkAttempt | undefined;
  appSlug: string;
  commentBody: string;
}): boolean {
  if (!params.attempt) {
    return false;
  }

  const commentBodyLower = params.commentBody.toLowerCase();
  return commentBodyLower.includes(`@${params.appSlug.toLowerCase()}`)
    || commentBodyLower.includes("@kodai");
}

export function createMentionReviewWorkRuntime(params: {
  attempt: ReviewWorkAttempt | undefined;
  coordinator: ReviewWorkCoordinator;
  mention: MentionEvent;
  logger: ReviewWorkLogger;
}): MentionReviewWorkRuntime {
  const { attempt, coordinator, mention, logger } = params;
  let committed = false;
  let finalized = false;
  let publishRightsLost = false;

  return {
    attempt,
    get reviewPublishRightsLost() {
      return publishRightsLost;
    },
    setPhase(phase) {
      if (!attempt) {
        return;
      }
      committed = true;
      coordinator.setPhase(attempt.attemptId, phase);
    },
    canPublishExplicitReviewOutput(outputLabel, reviewOutputKey) {
      if (!attempt) {
        return true;
      }
      if (coordinator.canPublish(attempt.attemptId)) {
        return true;
      }

      publishRightsLost = true;
      const currentAttempt = coordinator
        .getSnapshot(attempt.familyKey)
        ?.attempts.find((candidateAttempt) => candidateAttempt.attemptId === attempt.attemptId);
      logger.info(
        {
          surface: mention.surface,
          owner: mention.owner,
          repo: mention.repo,
          prNumber: mention.prNumber,
          gate: "review-family-coordinator",
          gateResult: "skipped",
          skipReason: "publish-rights-lost",
          reviewOutputKey: reviewOutputKey ?? null,
          reviewFamilyKey: attempt.familyKey,
          reviewWorkAttemptId: attempt.attemptId,
          supersededByAttemptId: currentAttempt?.supersededByAttemptId ?? null,
        },
        `Skipping ${outputLabel} because publish rights were superseded`,
      );
      return false;
    },
    finalize() {
      if (!attempt || finalized) {
        return;
      }

      finalized = true;
      if (committed) {
        coordinator.complete(attempt.attemptId);
        return;
      }

      coordinator.release(attempt.attemptId);
    },
  };
}
