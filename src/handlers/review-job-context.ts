import type { JobQueueContext } from "../jobs/types.ts";

export function buildReviewJobQueueContext(params: {
  deliveryId: string;
  eventName: string;
  action: string | undefined;
  reviewFamilyKey: string;
  prNumber: number;
}): JobQueueContext {
  return {
    deliveryId: params.deliveryId,
    eventName: params.eventName,
    action: params.action,
    lane: "review",
    key: params.reviewFamilyKey,
    jobType: "pull-request-review",
    prNumber: params.prNumber,
  };
}

export function buildReviewRetryJobQueueContext(params: {
  retryDeliveryId: string;
  eventName: string;
  reviewFamilyKey: string;
  prNumber: number;
}): JobQueueContext {
  return {
    deliveryId: params.retryDeliveryId,
    eventName: params.eventName,
    action: "review-retry",
    lane: "review",
    key: params.reviewFamilyKey,
    jobType: "pull-request-review-retry",
    prNumber: params.prNumber,
  };
}
