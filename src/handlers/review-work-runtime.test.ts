import { describe, expect, test } from "bun:test";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
  type ReviewWorkAttempt,
  type ReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import { createReviewWorkRuntime } from "./review-work-runtime.ts";

function claimAttempt(coordinator: ReviewWorkCoordinator, deliveryId = "delivery-1"): ReviewWorkAttempt {
  return coordinator.claim({
    familyKey: buildReviewFamilyKey("Acme", "Widgets", 7),
    source: "automatic-review",
    lane: "review",
    deliveryId,
    phase: "claimed",
  });
}

describe("review work runtime", () => {
  test("releases an uncommitted primary review attempt on finalize", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const runtime = createReviewWorkRuntime({
      attempt,
      coordinator,
    });

    runtime.finalize();

    expect(coordinator.getSnapshot(attempt.familyKey)).toBeNull();
  });

  test("completes a committed primary review attempt on finalize", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const runtime = createReviewWorkRuntime({
      attempt,
      coordinator,
    });

    runtime.setPhase("prompt-build");
    runtime.finalize();

    expect(coordinator.getSnapshot(attempt.familyKey)).toBeNull();
  });

  test("supports destructured phase methods from the runtime", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const runtime = createReviewWorkRuntime({
      attempt,
      coordinator,
    });
    const { setPhase } = runtime;

    setPhase("prompt-build");
    runtime.finalize();

    expect(coordinator.getSnapshot(attempt.familyKey)).toBeNull();
  });

  test("does not commit the primary attempt when only a retry attempt advances", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const retryAttempt = claimAttempt(coordinator, "delivery-retry");
    const runtime = createReviewWorkRuntime({
      attempt,
      coordinator,
    });

    runtime.setPhaseForAttempt(retryAttempt.attemptId, "prompt-build");
    runtime.finalize();

    const snapshot = coordinator.getSnapshot(attempt.familyKey);
    expect(snapshot?.attempts.map((candidate) => candidate.attemptId)).toEqual([retryAttempt.attemptId]);
  });

  test("delegates visible-output publish checks with the primary attempt and delivery id", () => {
    const coordinator = createReviewWorkCoordinator();
    const attempt = claimAttempt(coordinator);
    const calls: Array<{ attemptId: string; outputLabel: string; deliveryId: string }> = [];
    const runtime = createReviewWorkRuntime({
      attempt,
      coordinator,
    });
    const canPublishVisibleOutput = runtime.createVisibleOutputGate({
      deliveryId: "delivery-1",
      canPublishReviewWorkOutput(attemptId, outputLabel, deliveryId) {
        calls.push({ attemptId, outputLabel, deliveryId });
        return outputLabel === "visible output";
      },
    });

    expect(canPublishVisibleOutput("visible output")).toBe(true);
    expect(calls).toEqual([{
      attemptId: attempt.attemptId,
      outputLabel: "visible output",
      deliveryId: "delivery-1",
    }]);
  });
});
