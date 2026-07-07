import { describe, expect, test } from "bun:test";
import { buildMentionJobQueueContext } from "./mention-job-context.ts";

describe("buildMentionJobQueueContext", () => {
  test("uses the interactive-review lane for explicit review mentions", () => {
    expect(buildMentionJobQueueContext({
      deliveryId: "delivery-1",
      eventName: "issue_comment.created",
      action: "created",
      isExplicitReviewRequest: true,
      mentionQueueKey: "acme/repo#12",
      prNumber: 12,
    })).toEqual({
      deliveryId: "delivery-1",
      eventName: "issue_comment.created",
      action: "created",
      lane: "interactive-review",
      key: "acme/repo#12",
      jobType: "mention",
      prNumber: 12,
    });
  });

  test("uses the sync lane for regular mentions", () => {
    expect(buildMentionJobQueueContext({
      deliveryId: "delivery-2",
      eventName: "pull_request_review_comment.created",
      action: "created",
      isExplicitReviewRequest: false,
      mentionQueueKey: "acme/repo#44",
      prNumber: undefined,
    })).toEqual({
      deliveryId: "delivery-2",
      eventName: "pull_request_review_comment.created",
      action: "created",
      lane: "sync",
      key: "acme/repo#44",
      jobType: "mention",
      prNumber: undefined,
    });
  });
});
