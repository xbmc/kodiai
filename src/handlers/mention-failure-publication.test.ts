import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { MentionErrorPostResult } from "./mention-publication-state.ts";
import { publishMentionFailureFallback } from "./mention-failure-publication.ts";

describe("publishMentionFailureFallback", () => {
  test("posts a generic failure fallback and reports publication state", async () => {
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> => ({
      ok: true,
      value: "error-comment-created",
    }));

    const result = await publishMentionFailureFallback({
      explicitReviewRequest: true,
      routingReason: undefined,
      stopReason: "tool_use",
      failureSubtype: "error_during_execution",
      reviewOutputKey: "review-output-key",
      surface: "issue_comment",
      issueNumber: 42,
      canPublishExplicitReviewOutput: () => true,
      postMentionError,
      logger: { warn: mock(() => {}) } as unknown as Logger,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "failure-fallback",
        fallbackDelivery: "error-comment-created",
      },
    });
    expect(postMentionError).toHaveBeenCalledTimes(1);
    expect(postMentionError.mock.calls[0]![0]).toContain(
      "I couldn't publish a trustworthy review result for this request.",
    );
  });

  test("maps exhausted turn budget failures to turn-limit fallback state", async () => {
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> => ({
      ok: false,
      err: new Error("comment failed"),
    }));

    const result = await publishMentionFailureFallback({
      explicitReviewRequest: true,
      routingReason: "tiny-diff",
      stopReason: "tool_use",
      failureSubtype: "error_max_turns",
      reviewOutputKey: "review-output-key",
      surface: "issue_comment",
      issueNumber: 42,
      canPublishExplicitReviewOutput: () => true,
      postMentionError,
      logger: { warn: mock(() => {}) } as unknown as Logger,
    });

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        resolution: "turn-limit-fallback-failed",
        fallbackDelivery: "error-comment-failed",
      },
    });
    expect(postMentionError.mock.calls[0]![0]).toContain("I ran out of steps analyzing this");
  });

  test("skips explicit review fallback publication when publish rights are lost", async () => {
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> => ({
      ok: true,
      value: "error-comment-created",
    }));

    const result = await publishMentionFailureFallback({
      explicitReviewRequest: true,
      routingReason: undefined,
      stopReason: "tool_use",
      failureSubtype: "error_during_execution",
      reviewOutputKey: "review-output-key",
      surface: "issue_comment",
      issueNumber: 42,
      canPublishExplicitReviewOutput: () => false,
      postMentionError,
      logger: { warn: mock(() => {}) } as unknown as Logger,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: false,
        resolution: "skipped",
        fallbackDelivery: null,
      },
    });
    expect(postMentionError).not.toHaveBeenCalled();
  });
});
