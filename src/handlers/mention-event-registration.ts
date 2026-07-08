import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

export function registerMentionHandlerEvents(
  eventRouter: Pick<EventRouter, "register">,
  handleMention: (event: WebhookEvent) => Promise<void>,
): void {
  eventRouter.register("issue_comment.created", handleMention);
  eventRouter.register("pull_request_review_comment.created", handleMention);
  eventRouter.register("pull_request_review.submitted", handleMention);
}
