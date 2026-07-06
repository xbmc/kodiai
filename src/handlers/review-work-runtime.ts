import type {
  ReviewWorkAttempt,
  ReviewWorkCoordinator,
  ReviewWorkPhase,
} from "../jobs/review-work-coordinator.ts";

type ReviewWorkOutputGate = (
  attemptId: string,
  outputLabel: string,
  deliveryId: string,
) => boolean;

export type ReviewWorkRuntime = {
  attempt: ReviewWorkAttempt;
  setPhase(phase: ReviewWorkPhase): void;
  setPhaseForAttempt(attemptId: string, phase: ReviewWorkPhase): void;
  createVisibleOutputGate(params: {
    deliveryId: string;
    canPublishReviewWorkOutput: ReviewWorkOutputGate;
  }): (outputLabel: string) => boolean;
  finalize(): void;
};

export function createReviewWorkRuntime(params: {
  attempt: ReviewWorkAttempt;
  coordinator: ReviewWorkCoordinator;
}): ReviewWorkRuntime {
  const { attempt, coordinator } = params;
  let committed = false;
  let finalized = false;

  function setPhaseForAttempt(attemptId: string, phase: ReviewWorkPhase): void {
    if (attemptId === attempt.attemptId) {
      committed = true;
    }
    coordinator.setPhase(attemptId, phase);
  }

  return {
    attempt,
    setPhase(phase) {
      setPhaseForAttempt(attempt.attemptId, phase);
    },
    setPhaseForAttempt,
    createVisibleOutputGate({ deliveryId, canPublishReviewWorkOutput }) {
      return (outputLabel) => canPublishReviewWorkOutput(attempt.attemptId, outputLabel, deliveryId);
    },
    finalize() {
      if (finalized) {
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
