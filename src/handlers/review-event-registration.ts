import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

const REVIEW_EVENT_NAMES = [
  "pull_request.opened",
  "pull_request.ready_for_review",
  "pull_request.review_requested",
  "pull_request.synchronize",
] as const;

export function registerReviewHandlerEvents(
  eventRouter: EventRouter,
  handleReview: (event: WebhookEvent) => Promise<void>,
): void {
  for (const eventName of REVIEW_EVENT_NAMES) {
    eventRouter.register(eventName, handleReview);
  }
}
