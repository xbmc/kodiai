import {
  buildReviewFamilyKey,
  type ReviewWorkAttempt,
  type ReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";
import { findLatestReviewPredecessor } from "./mention-workspace.ts";
import type { MentionEvent } from "./mention-types.ts";

type MentionReviewWorkClaimLogger = {
  info(fields: Record<string, unknown>, message: string): void;
};

export function claimMentionReviewWorkAttempt(params: {
  coordinator: ReviewWorkCoordinator;
  mention: MentionEvent;
  reviewPrNumber: number | undefined;
  isExplicitReviewRequest: boolean;
  deliveryId: string;
  logger: MentionReviewWorkClaimLogger;
}): ReviewWorkAttempt | undefined {
  const {
    coordinator,
    mention,
    reviewPrNumber,
    isExplicitReviewRequest,
    deliveryId,
    logger,
  } = params;

  if (reviewPrNumber === undefined || !isExplicitReviewRequest) {
    return undefined;
  }

  const attempt = coordinator.claim({
    familyKey: buildReviewFamilyKey(mention.owner, mention.repo, reviewPrNumber),
    source: "explicit-review",
    lane: "interactive-review",
    deliveryId,
    phase: "claimed",
  });
  const predecessor = findLatestReviewPredecessor(
    coordinator.getSnapshot(attempt.familyKey),
    attempt.attemptId,
  );
  if (!predecessor) {
    return attempt;
  }

  logger.info(
    {
      surface: mention.surface,
      owner: mention.owner,
      repo: mention.repo,
      prNumber: reviewPrNumber,
      gate: "review-family-coordinator",
      gateResult: "claimed-with-predecessor",
      reviewFamilyKey: attempt.familyKey,
      reviewWorkAttemptId: attempt.attemptId,
      predecessorAttemptId: predecessor.attemptId,
      predecessorPhase: predecessor.phase,
      predecessorAgeMs: Math.max(
        0,
        attempt.claimedAtMs - predecessor.lastProgressAtMs,
      ),
    },
    "Explicit review claim found a stale predecessor attempt",
  );

  return attempt;
}
