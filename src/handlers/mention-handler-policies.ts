import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

export const FORMATTER_REVIEW_OUTPUT_ACTION = "mention-format-suggestions";

export function resolveMentionAddonReviewDispatcher(params: {
  eventRouter: EventRouter;
  addonReviewDispatcher?: (event: WebhookEvent) => Promise<void>;
}): (event: WebhookEvent) => Promise<void> {
  return params.addonReviewDispatcher
    ?? ((addonEvent: WebhookEvent) => params.eventRouter.dispatch(addonEvent));
}
