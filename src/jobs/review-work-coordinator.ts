export type ReviewWorkSource = "automatic-review" | "explicit-review";
export type ReviewWorkLane = "review" | "interactive-review";
export type ReviewWorkPhase =
  | "claimed"
  | "workspace-create"
  | "load-config"
  | "incremental-diff"
  | "prompt-build"
  | "executor-dispatch"
  | "publish";

export type ReviewWorkAttempt = {
  attemptId: string;
  familyKey: string;
  source: ReviewWorkSource;
  lane: ReviewWorkLane;
  deliveryId: string;
  phase: ReviewWorkPhase;
  claimedAtMs: number;
  lastProgressAtMs: number;
  supersededByAttemptId?: string;
};

export type ReviewWorkClaim = {
  familyKey: string;
  source: ReviewWorkSource;
  lane: ReviewWorkLane;
  deliveryId: string;
  phase: ReviewWorkPhase;
};

export type ReviewWorkSnapshot = {
  familyKey: string;
  attempts: ReviewWorkAttempt[];
};

type InternalReviewWorkAttempt = ReviewWorkAttempt & {
  lifecycle: "pending" | "active";
  claimOrdinal: number;
};

type ReviewWorkFamilyState = {
  attemptIds: string[];
  nextClaimOrdinal: number;
  latestAuthoritativeClaimOrdinal: number;
  latestAuthoritativeAttemptId?: string;
};

export type ReviewWorkCoordinator = {
  claim(claim: ReviewWorkClaim): ReviewWorkAttempt;
  canPublish(attemptId: string): boolean;
  setPhase(attemptId: string, phase: ReviewWorkPhase): ReviewWorkAttempt | null;
  getSnapshot(familyKey: string): ReviewWorkSnapshot | null;
  release(attemptId: string): void;
  complete(attemptId: string): void;
};

function cloneAttempt(attempt: InternalReviewWorkAttempt, supersededByAttemptId?: string): ReviewWorkAttempt {
  return {
    attemptId: attempt.attemptId,
    familyKey: attempt.familyKey,
    source: attempt.source,
    lane: attempt.lane,
    deliveryId: attempt.deliveryId,
    phase: attempt.phase,
    claimedAtMs: attempt.claimedAtMs,
    lastProgressAtMs: attempt.lastProgressAtMs,
    ...(supersededByAttemptId ? { supersededByAttemptId } : {}),
  };
}

export function buildReviewFamilyKey(owner: string, repo: string, prNumber: number): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}#${prNumber}`;
}

export function createReviewWorkCoordinator(options?: {
  nowFn?: () => number;
}): ReviewWorkCoordinator {
  const nowFn = options?.nowFn ?? (() => Date.now());
  const attemptsById = new Map<string, InternalReviewWorkAttempt>();
  const familyStatesByKey = new Map<string, ReviewWorkFamilyState>();
  let nextAttemptId = 1;

  function getOrCreateFamilyState(familyKey: string): ReviewWorkFamilyState {
    const existingFamilyState = familyStatesByKey.get(familyKey);
    if (existingFamilyState) {
      return existingFamilyState;
    }

    const nextFamilyState: ReviewWorkFamilyState = {
      attemptIds: [],
      nextClaimOrdinal: 1,
      latestAuthoritativeClaimOrdinal: 0,
    };
    familyStatesByKey.set(familyKey, nextFamilyState);
    return nextFamilyState;
  }

  function getFamilyAttempts(familyKey: string): InternalReviewWorkAttempt[] {
    const familyState = familyStatesByKey.get(familyKey);
    if (!familyState) {
      return [];
    }

    return familyState.attemptIds
      .map((attemptId) => attemptsById.get(attemptId))
      .filter((attempt): attempt is InternalReviewWorkAttempt => attempt !== undefined);
  }

  function getSupersedingAttemptId(attempt: InternalReviewWorkAttempt): string | undefined {
    const familyState = familyStatesByKey.get(attempt.familyKey);
    if (!familyState) {
      return undefined;
    }

    if (familyState.latestAuthoritativeClaimOrdinal <= attempt.claimOrdinal) {
      return undefined;
    }

    return familyState.latestAuthoritativeAttemptId;
  }

  function clearFamily(familyKey: string): void {
    const familyState = familyStatesByKey.get(familyKey);
    if (!familyState) {
      return;
    }

    for (const attemptId of familyState.attemptIds) {
      attemptsById.delete(attemptId);
    }
    familyStatesByKey.delete(familyKey);
  }

  function removeAttemptFromFamily(attempt: InternalReviewWorkAttempt): void {
    attemptsById.delete(attempt.attemptId);
    const familyState = familyStatesByKey.get(attempt.familyKey);
    if (!familyState) {
      return;
    }

    familyState.attemptIds = familyState.attemptIds.filter(
      (existingAttemptId) => existingAttemptId !== attempt.attemptId,
    );

    if (familyState.attemptIds.length === 0) {
      clearFamily(attempt.familyKey);
    }
  }

  function promoteAttemptToAuthoritative(attempt: InternalReviewWorkAttempt): void {
    const familyState = familyStatesByKey.get(attempt.familyKey);
    if (!familyState || attempt.lifecycle === "active") {
      return;
    }

    attempt.lifecycle = "active";
    if (attempt.claimOrdinal > familyState.latestAuthoritativeClaimOrdinal) {
      familyState.latestAuthoritativeClaimOrdinal = attempt.claimOrdinal;
      familyState.latestAuthoritativeAttemptId = attempt.attemptId;
    }
  }

  return {
    claim(claim) {
      const claimedAtMs = nowFn();
      const attemptId = `review-work-${nextAttemptId++}`;
      const familyState = getOrCreateFamilyState(claim.familyKey);
      const claimOrdinal = familyState.nextClaimOrdinal++;
      const attempt: InternalReviewWorkAttempt = {
        attemptId,
        familyKey: claim.familyKey,
        source: claim.source,
        lane: claim.lane,
        deliveryId: claim.deliveryId,
        phase: claim.phase,
        claimedAtMs,
        lastProgressAtMs: claimedAtMs,
        lifecycle: claim.phase === "claimed" ? "pending" : "active",
        claimOrdinal,
      };

      attemptsById.set(attemptId, attempt);
      familyState.attemptIds.push(attemptId);
      if (attempt.lifecycle === "active" && claimOrdinal > familyState.latestAuthoritativeClaimOrdinal) {
        familyState.latestAuthoritativeClaimOrdinal = claimOrdinal;
        familyState.latestAuthoritativeAttemptId = attemptId;
      }

      return cloneAttempt(attempt, getSupersedingAttemptId(attempt));
    },

    canPublish(attemptId) {
      const attempt = attemptsById.get(attemptId);
      if (!attempt || attempt.lifecycle !== "active") {
        return false;
      }

      const familyState = familyStatesByKey.get(attempt.familyKey);
      return familyState !== undefined && familyState.latestAuthoritativeClaimOrdinal === attempt.claimOrdinal;
    },

    setPhase(attemptId, phase) {
      const attempt = attemptsById.get(attemptId);
      if (!attempt) {
        return null;
      }

      attempt.phase = phase;
      attempt.lastProgressAtMs = nowFn();
      if (phase !== "claimed") {
        promoteAttemptToAuthoritative(attempt);
      }

      return cloneAttempt(attempt, getSupersedingAttemptId(attempt));
    },

    getSnapshot(familyKey) {
      const attempts = getFamilyAttempts(familyKey)
        .map((attempt) => cloneAttempt(attempt, getSupersedingAttemptId(attempt)));

      if (attempts.length === 0) {
        return null;
      }

      return {
        familyKey,
        attempts,
      };
    },

    release(attemptId) {
      const attempt = attemptsById.get(attemptId);
      if (!attempt) {
        return;
      }

      removeAttemptFromFamily(attempt);
    },

    complete(attemptId) {
      const attempt = attemptsById.get(attemptId);
      if (!attempt || attempt.lifecycle !== "active") {
        return;
      }

      removeAttemptFromFamily(attempt);
    },
  };
}
