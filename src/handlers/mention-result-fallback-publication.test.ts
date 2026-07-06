import { describe, expect, mock, test } from "bun:test";
import type { MentionErrorPostResult } from "./mention-publication-state.ts";
import { publishMentionErrorFallback } from "./mention-result-fallback-publication.ts";

describe("publishMentionErrorFallback", () => {
  test("posts an execution error fallback and returns a successful Result", async () => {
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> => ({
      ok: true,
      value: "error-comment-created",
    }));

    const result = await publishMentionErrorFallback({
      explicitReviewRequest: true,
      isTimeout: false,
      errorMessage: "boom",
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => true,
      postMentionError,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "error-fallback",
        fallbackDelivery: "error-comment-created",
      },
    });
    expect(postMentionError).toHaveBeenCalledTimes(1);
    expect(postMentionError.mock.calls[0]![0]).toContain("Kodiai encountered an error");
  });

  test("returns an error Result when fallback publication fails", async () => {
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> => ({
      ok: false,
      err: new Error("comment failed"),
    }));

    const result = await publishMentionErrorFallback({
      explicitReviewRequest: true,
      isTimeout: true,
      errorMessage: "timed out",
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => true,
      postMentionError,
    });

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        resolution: "error-comment-failed",
        fallbackDelivery: "error-comment-failed",
      },
    });
  });

  test("returns a successful skipped Result when publish rights are lost", async () => {
    const postMentionError = mock(async (_body: string): Promise<MentionErrorPostResult> => ({
      ok: true,
      value: "error-comment-created",
    }));

    const result = await publishMentionErrorFallback({
      explicitReviewRequest: true,
      isTimeout: false,
      errorMessage: "boom",
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => false,
      postMentionError,
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
