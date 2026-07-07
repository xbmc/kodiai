import type {
  ReviewWorkAttempt,
  ReviewWorkCoordinator,
  ReviewWorkPhase,
} from "../jobs/review-work-coordinator.ts";
import { claimMentionReviewWorkAttempt } from "./mention-review-work-claim.ts";
import {
  createMentionReviewWorkRuntime,
  type MentionReviewWorkRuntime,
  usesCanonicalExplicitReviewHandle,
} from "./mention-review-work-runtime.ts";
import type { MentionEvent } from "./mention-types.ts";

type MentionReviewWorkSessionLogger = {
  info(fields: Record<string, unknown>, message: string): void;
};

export type MentionReviewWorkSession = {
  runtime: MentionReviewWorkRuntime;
  reviewWorkAttempt: ReviewWorkAttempt | undefined;
  explicitReviewUsesCanonicalHandle: boolean;
  setReviewWorkPhase(phase: ReviewWorkPhase): void;
  canPublishExplicitReviewOutput(outputLabel: string, reviewOutputKey?: string): boolean;
};

export function createMentionReviewWorkSession(params: {
  coordinator: ReviewWorkCoordinator;
  mention: MentionEvent;
  reviewPrNumber: number | undefined;
  isExplicitReviewRequest: boolean;
  deliveryId: string;
  appSlug: string;
  logger: MentionReviewWorkSessionLogger;
}): MentionReviewWorkSession {
  const reviewWorkAttempt = claimMentionReviewWorkAttempt({
    coordinator: params.coordinator,
    mention: params.mention,
    reviewPrNumber: params.reviewPrNumber,
    isExplicitReviewRequest: params.isExplicitReviewRequest,
    deliveryId: params.deliveryId,
    logger: params.logger,
  });
  const runtime = createMentionReviewWorkRuntime({
    attempt: reviewWorkAttempt,
    coordinator: params.coordinator,
    mention: params.mention,
    logger: params.logger,
  });

  return {
    runtime,
    reviewWorkAttempt,
    explicitReviewUsesCanonicalHandle: usesCanonicalExplicitReviewHandle({
      attempt: reviewWorkAttempt,
      appSlug: params.appSlug,
      commentBody: params.mention.commentBody,
    }),
    setReviewWorkPhase: runtime.setPhase,
    canPublishExplicitReviewOutput: runtime.canPublishExplicitReviewOutput,
  };
}
