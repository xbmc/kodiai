import { describe, expect, test } from "bun:test";
import { TASK_TYPES } from "../llm/task-types.ts";
import { resolveMentionExecutorPlan } from "./mention-executor-plan.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo-org",
    repo: "widget",
    issueNumber: 42,
    prNumber: 42,
    commentId: 99,
    commentBody: "@kodiai review this PR",
    commentAuthor: "mona",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "head-sha",
    baseRef: "main",
    headRepoOwner: "octo-org",
    headRepoName: "widget",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Improve widget",
    ...overrides,
  };
}

describe("resolveMentionExecutorPlan", () => {
  test("builds explicit review executor routing and review output key", () => {
    const plan = resolveMentionExecutorPlan({
      mention: makeMention(),
      installationId: 123,
      deliveryId: "delivery-1",
      eventName: "issue_comment",
      eventAction: "created",
      explicitReviewRequest: true,
      explicitReviewTaskType: TASK_TYPES.REVIEW_SMALL_DIFF,
      explicitReviewMaxTurnsOverride: 44,
      formatterSuggestionMode: "review-and-format",
      writeEnabled: false,
      hasPrDiffContext: true,
      userQuestion: "review this PR",
    });

    expect(plan).toEqual({
      reviewOutputKey: "kodiai-review-output:v1:inst-123:octo-org/widget:pr-42:action-mention-review:delivery-delivery-1:head-head-sha",
      maxTurnsOverride: 44,
      taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
      eventType: "issue_comment.created",
      triggerBody: "review this PR",
      isCombinedFormatterSuggestionRequest: true,
      enableInlineTools: true,
      enableCandidateFindingTool: true,
    });
  });

  test("caps read-only PR mention turns based on available PR diff context", () => {
    const withPrDiff = resolveMentionExecutorPlan({
      mention: makeMention({ commentBody: "@kodiai summarize" }),
      installationId: 123,
      deliveryId: "delivery-1",
      eventName: "issue_comment",
      eventAction: "created",
      explicitReviewRequest: false,
      explicitReviewTaskType: TASK_TYPES.REVIEW_FULL,
      explicitReviewMaxTurnsOverride: undefined,
      formatterSuggestionMode: undefined,
      writeEnabled: false,
      hasPrDiffContext: true,
      userQuestion: "summarize",
    });
    const withoutPrDiff = resolveMentionExecutorPlan({
      mention: makeMention({ commentBody: "@kodiai summarize" }),
      installationId: 123,
      deliveryId: "delivery-1",
      eventName: "issue_comment",
      eventAction: "created",
      explicitReviewRequest: false,
      explicitReviewTaskType: TASK_TYPES.REVIEW_FULL,
      explicitReviewMaxTurnsOverride: undefined,
      formatterSuggestionMode: undefined,
      writeEnabled: false,
      hasPrDiffContext: false,
      userQuestion: "summarize",
    });

    expect(withPrDiff.maxTurnsOverride).toBe(12);
    expect(withoutPrDiff.maxTurnsOverride).toBe(20);
    expect(withPrDiff.reviewOutputKey).toBeUndefined();
    expect(withPrDiff.taskType).toBe("mention.response");
    expect(withPrDiff.triggerBody).toBe("@kodiai summarize");
  });

  test("leaves write-mode and issue mentions on default turn budget", () => {
    const writePrMention = resolveMentionExecutorPlan({
      mention: makeMention(),
      installationId: 123,
      deliveryId: "delivery-1",
      eventName: "issue_comment",
      eventAction: "created",
      explicitReviewRequest: false,
      explicitReviewTaskType: TASK_TYPES.REVIEW_FULL,
      explicitReviewMaxTurnsOverride: undefined,
      formatterSuggestionMode: undefined,
      writeEnabled: true,
      hasPrDiffContext: true,
      userQuestion: "apply fix",
    });
    const issueMention = resolveMentionExecutorPlan({
      mention: makeMention({
        surface: "issue_comment",
        issueNumber: 7,
        prNumber: undefined,
        commentBody: "@kodiai investigate",
      }),
      installationId: 123,
      deliveryId: "delivery-1",
      eventName: "issue_comment",
      eventAction: undefined,
      explicitReviewRequest: false,
      explicitReviewTaskType: TASK_TYPES.REVIEW_FULL,
      explicitReviewMaxTurnsOverride: undefined,
      formatterSuggestionMode: undefined,
      writeEnabled: false,
      hasPrDiffContext: false,
      userQuestion: "investigate",
    });

    expect(writePrMention.maxTurnsOverride).toBeUndefined();
    expect(issueMention.maxTurnsOverride).toBeUndefined();
    expect(issueMention.eventType).toBe("issue_comment");
  });
});
