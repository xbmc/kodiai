import { describe, expect, test } from "bun:test";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "./review-work-coordinator.ts";

const ACTIVE_PHASE = "executor-dispatch" as const;

describe("createReviewWorkCoordinator", () => {
  test("newer pending explicit claim does not suppress an older active automatic review", () => {
    let nowMs = 1_000;
    const coordinator = createReviewWorkCoordinator({
      nowFn: () => nowMs++,
    });
    const familyKey = buildReviewFamilyKey("Acme", "Repo", 42);

    const automaticAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1",
      phase: "claimed",
    });
    coordinator.setPhase(automaticAttempt.attemptId, ACTIVE_PHASE);

    const explicitAttempt = coordinator.claim({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-2",
      phase: "claimed",
    });

    expect(coordinator.canPublish(automaticAttempt.attemptId)).toBeTrue();
    expect(coordinator.canPublish(explicitAttempt.attemptId)).toBeFalse();

    const snapshot = coordinator.getSnapshot(familyKey);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.familyKey).toBe(familyKey);
    expect(snapshot?.attempts).toHaveLength(2);

    const storedAutomaticAttempt = snapshot?.attempts.find((attempt) => attempt.attemptId === automaticAttempt.attemptId);
    const storedExplicitAttempt = snapshot?.attempts.find((attempt) => attempt.attemptId === explicitAttempt.attemptId);

    expect(storedAutomaticAttempt).toMatchObject({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1",
      phase: ACTIVE_PHASE,
    });
    expect(storedAutomaticAttempt?.supersededByAttemptId).toBeUndefined();
    expect(storedExplicitAttempt).toMatchObject({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-2",
      phase: "claimed",
    });
    expect(storedExplicitAttempt?.supersededByAttemptId).toBeUndefined();
  });

  test("newer explicit review stays authoritative after it starts and completes before the older automatic review", () => {
    let nowMs = 4_000;
    const coordinator = createReviewWorkCoordinator({
      nowFn: () => ++nowMs,
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 6);

    const automaticAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1",
      phase: "claimed",
    });
    const explicitAttempt = coordinator.claim({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-2",
      phase: "claimed",
    });

    coordinator.setPhase(explicitAttempt.attemptId, ACTIVE_PHASE);
    coordinator.complete(explicitAttempt.attemptId);
    coordinator.setPhase(automaticAttempt.attemptId, ACTIVE_PHASE);

    expect(coordinator.canPublish(automaticAttempt.attemptId)).toBeFalse();
    expect(coordinator.canPublish(explicitAttempt.attemptId)).toBeFalse();

    expect(coordinator.getSnapshot(familyKey)?.attempts).toEqual([
      expect.objectContaining({
        attemptId: automaticAttempt.attemptId,
        familyKey,
        source: "automatic-review",
        phase: ACTIVE_PHASE,
        supersededByAttemptId: explicitAttempt.attemptId,
      }),
    ]);
  });

  test("getSnapshot returns a stale copy while setPhase updates live attempt progress", () => {
    let nowMs = 5_000;
    const coordinator = createReviewWorkCoordinator({
      nowFn: () => ++nowMs,
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 7);

    const attempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-1",
      phase: "claimed",
    });

    const staleSnapshot = coordinator.getSnapshot(familyKey);
    expect(staleSnapshot).not.toBeNull();
    const staleAttempt = staleSnapshot?.attempts[0];
    expect(staleAttempt?.phase).toBe("claimed");

    coordinator.setPhase(attempt.attemptId, ACTIVE_PHASE);

    const freshSnapshot = coordinator.getSnapshot(familyKey);
    const freshAttempt = freshSnapshot?.attempts[0];

    expect(staleAttempt?.phase).toBe("claimed");
    expect(freshAttempt?.phase).toBe(ACTIVE_PHASE);
    expect(freshAttempt?.lastProgressAtMs).toBeGreaterThan(staleAttempt?.lastProgressAtMs ?? 0);
  });

  test("releasing an abandoned middle claim keeps a later retry pending until the retry actually starts", () => {
    let nowMs = 6_500;
    const coordinator = createReviewWorkCoordinator({
      nowFn: () => ++nowMs,
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 8);

    const automaticAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1",
      phase: "claimed",
    });
    coordinator.setPhase(automaticAttempt.attemptId, ACTIVE_PHASE);

    const abandonedExplicitAttempt = coordinator.claim({
      familyKey,
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-explicit-2",
      phase: "claimed",
    });
    const retryAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1-retry-1",
      phase: "claimed",
    });

    coordinator.release(abandonedExplicitAttempt.attemptId);

    expect(coordinator.canPublish(automaticAttempt.attemptId)).toBeTrue();
    expect(coordinator.canPublish(retryAttempt.attemptId)).toBeFalse();
    const storedAutomaticAttemptBeforeRetry = coordinator
      .getSnapshot(familyKey)
      ?.attempts.find((attempt) => attempt.attemptId === automaticAttempt.attemptId);
    expect(storedAutomaticAttemptBeforeRetry?.supersededByAttemptId).toBeUndefined();

    coordinator.setPhase(retryAttempt.attemptId, ACTIVE_PHASE);

    expect(coordinator.canPublish(automaticAttempt.attemptId)).toBeFalse();
    expect(coordinator.canPublish(retryAttempt.attemptId)).toBeTrue();
    const storedAutomaticAttempt = coordinator
      .getSnapshot(familyKey)
      ?.attempts.find((attempt) => attempt.attemptId === automaticAttempt.attemptId);
    expect(storedAutomaticAttempt?.supersededByAttemptId).toBe(retryAttempt.attemptId);
  });

  test("a queued retry only becomes publishable after it actually starts running", () => {
    let nowMs = 7_500;
    const coordinator = createReviewWorkCoordinator({
      nowFn: () => ++nowMs,
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 88);

    const automaticAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1",
      phase: "claimed",
    });
    coordinator.setPhase(automaticAttempt.attemptId, ACTIVE_PHASE);

    const retryAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-1-retry-1",
      phase: "claimed",
    });

    coordinator.complete(automaticAttempt.attemptId);

    expect(coordinator.canPublish(automaticAttempt.attemptId)).toBeFalse();
    expect(coordinator.canPublish(retryAttempt.attemptId)).toBeFalse();
    expect(coordinator.getSnapshot(familyKey)?.attempts).toEqual([
      expect.objectContaining({
        attemptId: retryAttempt.attemptId,
        phase: "claimed",
      }),
    ]);

    coordinator.setPhase(retryAttempt.attemptId, ACTIVE_PHASE);

    expect(coordinator.canPublish(retryAttempt.attemptId)).toBeTrue();
  });

  test("completing the latest attempt clears the family snapshot", () => {
    let nowMs = 8_500;
    const coordinator = createReviewWorkCoordinator({
      nowFn: () => ++nowMs,
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 89);

    const attempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-2",
      phase: "claimed",
    });
    coordinator.setPhase(attempt.attemptId, ACTIVE_PHASE);

    coordinator.complete(attempt.attemptId);

    expect(coordinator.canPublish(attempt.attemptId)).toBeFalse();
    expect(coordinator.getSnapshot(familyKey)).toBeNull();
  });
});
