import type { JobQueueContext } from "../jobs/types.ts";

export function buildMentionJobQueueContext(params: {
  deliveryId: string;
  eventName: string;
  action: string | undefined;
  isExplicitReviewRequest: boolean;
  mentionQueueKey: string;
  prNumber: number | undefined;
}): JobQueueContext {
  return {
    deliveryId: params.deliveryId,
    eventName: params.eventName,
    action: params.action,
    lane: params.isExplicitReviewRequest ? "interactive-review" : "sync",
    key: params.mentionQueueKey,
    jobType: "mention",
    prNumber: params.prNumber,
  };
}
