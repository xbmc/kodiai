import { describe, expect, test } from "bun:test";
import type { WebhookEvent } from "../webhook/types.ts";
import { resolveMentionTriggerContext } from "./mention-trigger-context.ts";

function issueCommentEvent(params: {
  body: string;
  author?: string;
  action?: string;
  isPr?: boolean;
}): WebhookEvent {
  return {
    id: "delivery-1",
    name: "issue_comment",
    installationId: 123,
    payload: {
      action: params.action ?? "created",
      repository: {
        name: "repo",
        owner: { login: "owner" },
      },
      issue: {
        number: 42,
        title: "Issue title",
        body: "Issue body",
        ...(params.isPr ? { pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/42" } } : {}),
      },
      comment: {
        id: 777,
        body: params.body,
        created_at: "2026-07-06T00:00:00Z",
        user: { login: params.author ?? "alice" },
      },
    },
  };
}

function reviewBodyEvent(body: string | null): WebhookEvent {
  return {
    id: "delivery-2",
    name: "pull_request_review",
    installationId: 123,
    payload: {
      action: "submitted",
      repository: {
        name: "repo",
        owner: { login: "owner" },
      },
      pull_request: {
        number: 43,
        title: "PR title",
        updated_at: "2026-07-06T00:00:00Z",
        head: {
          ref: "feature",
          repo: { name: "repo", owner: { login: "owner" } },
        },
        base: { ref: "main" },
      },
      review: {
        id: 888,
        body,
        submitted_at: "2026-07-06T00:00:00Z",
        user: { login: "alice" },
      },
    },
  };
}

describe("resolveMentionTriggerContext", () => {
  test("skips webhook actions that cannot create mentions", () => {
    const context = resolveMentionTriggerContext({
      event: issueCommentEvent({ body: "@kodiai hello", action: "edited" }),
      appSlug: "kodiai",
    });

    expect(context).toEqual({ action: "skip", reason: "ignored-action" });
  });

  test("skips review submissions without a body", () => {
    const context = resolveMentionTriggerContext({
      event: reviewBodyEvent(null),
      appSlug: "kodiai",
    });

    expect(context).toEqual({ action: "skip", reason: "empty-review-body" });
  });

  test("skips comments without accepted provisional handles", () => {
    const context = resolveMentionTriggerContext({
      event: issueCommentEvent({ body: "plain comment" }),
      appSlug: "kodiai",
    });

    expect(context).toEqual({ action: "skip", reason: "handle-mismatch" });
  });

  test("skips self-authored bot comments with log context", () => {
    const context = resolveMentionTriggerContext({
      event: issueCommentEvent({ body: "@kodiai hello", author: "kodiai[bot]" }),
      appSlug: "kodiai",
    });

    expect(context).toEqual({
      action: "skip",
      reason: "self-authored",
      logContext: {
        owner: "owner",
        repo: "repo",
        commentAuthor: "kodiai[bot]",
        issueNumber: 42,
        prNumber: undefined,
      },
    });
  });

  test("returns explicit review context and queue key for PR comments", () => {
    const context = resolveMentionTriggerContext({
      event: issueCommentEvent({ body: "@kodiai review this", isPr: true }),
      appSlug: "kodiai",
    });

    expect(context.action).toBe("process");
    if (context.action !== "process") return;
    expect(context.eventAction).toBe("created");
    expect(context.possibleHandles).toEqual(["kodiai", "kodai", "claude"]);
    expect(context.provisionalUserQuestion).toBe("review this");
    expect(context.reviewPrNumber).toBe(42);
    expect(context.isExplicitReviewRequest).toBe(true);
    expect(context.mentionQueueKey).toBe("owner/repo#42");
  });

  test("treats claude alias as a provisional mention handle", () => {
    const context = resolveMentionTriggerContext({
      event: issueCommentEvent({ body: "@claude summarize this" }),
      appSlug: "kodiai",
    });

    expect(context.action).toBe("process");
    if (context.action !== "process") return;
    expect(context.provisionalUserQuestion).toBe("summarize this");
    expect(context.isExplicitReviewRequest).toBe(false);
  });
});
