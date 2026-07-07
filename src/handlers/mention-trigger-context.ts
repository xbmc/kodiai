import type {
  IssueCommentCreatedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { WebhookEvent } from "../webhook/types.ts";
import { detectFormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";
import {
  isReviewRequest,
} from "./mention-request-classification.ts";
import {
  type MentionEvent,
  normalizeIssueComment,
  normalizeReviewBody,
  normalizeReviewComment,
  stripMention,
} from "./mention-types.ts";
import { buildMentionQueueKey } from "./mention-workspace.ts";

type MentionTriggerSkipReason =
  | "unsupported-event"
  | "ignored-action"
  | "empty-review-body"
  | "handle-mismatch"
  | "self-authored";

export type MentionTriggerContext =
  | {
      action: "skip";
      reason: MentionTriggerSkipReason;
      logContext?: {
        owner: string;
        repo: string;
        commentAuthor: string;
        issueNumber: number;
        prNumber: number | undefined;
      };
    }
  | {
      action: "process";
      eventAction: string | undefined;
      mention: MentionEvent;
      possibleHandles: string[];
      provisionalUserQuestion: string;
      reviewPrNumber: number | undefined;
      isExplicitReviewRequest: boolean;
      mentionQueueKey: string;
    };

function normalizeMentionEvent(event: WebhookEvent): {
  eventAction: string | undefined;
  mention?: MentionEvent;
  skipReason?: MentionTriggerSkipReason;
} {
  const eventAction = (event.payload as Record<string, unknown>).action as string | undefined;

  if (event.name === "issue_comment") {
    if (eventAction !== "created") return { eventAction, skipReason: "ignored-action" };
    return {
      eventAction,
      mention: normalizeIssueComment(event.payload as unknown as IssueCommentCreatedEvent),
    };
  }

  if (event.name === "pull_request_review_comment") {
    if (eventAction !== "created") return { eventAction, skipReason: "ignored-action" };
    return {
      eventAction,
      mention: normalizeReviewComment(event.payload as unknown as PullRequestReviewCommentCreatedEvent),
    };
  }

  if (event.name === "pull_request_review") {
    if (eventAction !== "submitted") return { eventAction, skipReason: "ignored-action" };
    const payload = event.payload as unknown as PullRequestReviewSubmittedEvent;
    if (!payload.review.body) return { eventAction, skipReason: "empty-review-body" };
    return {
      eventAction,
      mention: normalizeReviewBody(payload),
    };
  }

  return { eventAction, skipReason: "unsupported-event" };
}

export function resolveMentionTriggerContext(params: {
  event: WebhookEvent;
  appSlug: string;
}): MentionTriggerContext {
  const possibleHandles = [params.appSlug, "kodai", "claude"];
  const normalized = normalizeMentionEvent(params.event);
  if (!normalized.mention) {
    return { action: "skip", reason: normalized.skipReason ?? "unsupported-event" };
  }

  const mention = normalized.mention;
  const bodyLower = mention.commentBody.toLowerCase();
  const appHandle = `@${params.appSlug.toLowerCase()}`;
  if (!bodyLower.includes(appHandle) && !bodyLower.includes("@kodai") && !bodyLower.includes("@claude")) {
    return { action: "skip", reason: "handle-mismatch" };
  }

  const normalizedCommentAuthor = mention.commentAuthor.toLowerCase();
  if (
    normalizedCommentAuthor === params.appSlug.toLowerCase()
    || normalizedCommentAuthor.endsWith("[bot]")
  ) {
    return {
      action: "skip",
      reason: "self-authored",
      logContext: {
        owner: mention.owner,
        repo: mention.repo,
        commentAuthor: mention.commentAuthor,
        issueNumber: mention.issueNumber,
        prNumber: mention.prNumber,
      },
    };
  }

  const provisionalUserQuestion = stripMention(mention.commentBody, possibleHandles);
  const provisionalFormatterSuggestionRequest = detectFormatterSuggestionRequest(provisionalUserQuestion);
  const reviewPrNumber = mention.prNumber;
  const isExplicitReviewRequest =
    reviewPrNumber !== undefined
    && (
      isReviewRequest(provisionalUserQuestion)
      || provisionalFormatterSuggestionRequest?.mode === "review-and-format"
    );

  return {
    action: "process",
    eventAction: normalized.eventAction,
    mention,
    possibleHandles,
    provisionalUserQuestion,
    reviewPrNumber,
    isExplicitReviewRequest,
    mentionQueueKey: buildMentionQueueKey(
      mention.owner,
      mention.repo,
      reviewPrNumber ?? mention.issueNumber,
    ),
  };
}

export function logSkippedMentionTriggerContext(params: {
  triggerContext: MentionTriggerContext;
  logger: {
    debug: (bindings: unknown, message: string) => void;
  };
}): void {
  if (params.triggerContext.action !== "skip") return;
  if (params.triggerContext.reason !== "self-authored") return;

  params.logger.debug(
    params.triggerContext.logContext,
    "Skipping mention from self (comment-author defense)",
  );
}
