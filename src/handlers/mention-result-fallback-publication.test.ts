import { describe, expect, mock, test } from "bun:test";
import type { MentionEvent } from "./mention-types.ts";
import type { MentionErrorPostResult } from "./mention-publication-state.ts";
import {
  publishMentionErrorFallback,
  publishMentionHandlerFailureError,
  publishMentionSuccessFallback,
} from "./mention-result-fallback-publication.ts";

describe("publishMentionSuccessFallback", () => {
  test("posts a success fallback and returns a successful Result", async () => {
    const postMentionReply = mock(async (_body: string) => undefined);

    const result = await publishMentionSuccessFallback({
      explicitReviewRequest: false,
      hasUnpublishedFindings: false,
      findingLines: [],
      resultText: "Done",
      skipReason: undefined,
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => true,
      postMentionReply,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "success-fallback",
        fallbackDelivery: null,
      },
    });
    expect(postMentionReply).toHaveBeenCalledTimes(1);
  });

  test("returns a successful skipped Result when publish rights are lost", async () => {
    const postMentionReply = mock(async (_body: string) => undefined);

    const result = await publishMentionSuccessFallback({
      explicitReviewRequest: true,
      hasUnpublishedFindings: false,
      findingLines: [],
      resultText: "Done",
      skipReason: undefined,
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => false,
      postMentionReply,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: false,
        resolution: "skipped",
        fallbackDelivery: null,
      },
    });
    expect(postMentionReply).not.toHaveBeenCalled();
  });
});

describe("publishMentionHandlerFailureError", () => {
  function mention(): MentionEvent {
    return {
      surface: "issue_comment",
      issueNumber: 42,
    } as MentionEvent;
  }

  test("posts a handler failure error and returns a successful Result", async () => {
    const postMentionHandlerError = mock(async (params: { errorBody: string }) => {
      expect(params.errorBody).toContain("Kodiai encountered an error");
      expect(params.errorBody).toContain("Kodiai could not complete the request");
    });

    const result = await publishMentionHandlerFailureError({
      githubApp: {} as never,
      installationId: 123,
      mention: mention(),
      possibleHandles: ["kodiai"],
      explicitReviewRequest: true,
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => true,
      logger: {} as never,
      error: new Error("handler exploded"),
      postMentionHandlerError,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "handler-failure-error",
      },
    });
    expect(postMentionHandlerError).toHaveBeenCalledTimes(1);
  });

  test("returns a skipped Result when explicit review publish rights are lost", async () => {
    const postMentionHandlerError = mock(async () => undefined);

    const result = await publishMentionHandlerFailureError({
      githubApp: {} as never,
      installationId: 123,
      mention: mention(),
      possibleHandles: ["kodiai"],
      explicitReviewRequest: true,
      reviewOutputKey: "review-output-key",
      canPublishExplicitReviewOutput: () => false,
      logger: {} as never,
      error: new Error("handler exploded"),
      postMentionHandlerError,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: false,
        resolution: "skipped",
      },
    });
    expect(postMentionHandlerError).not.toHaveBeenCalled();
  });

  test("returns an error Result when handler failure publication fails", async () => {
    const publishError = new Error("comment failed");

    const result = await publishMentionHandlerFailureError({
      githubApp: {} as never,
      installationId: 123,
      mention: mention(),
      possibleHandles: ["kodiai"],
      explicitReviewRequest: false,
      reviewOutputKey: undefined,
      canPublishExplicitReviewOutput: () => true,
      logger: {} as never,
      error: new Error("handler exploded"),
      postMentionHandlerError: mock(async () => {
        throw publishError;
      }),
    });

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        resolution: "handler-failure-error-failed",
        error: publishError,
      },
    });
  });
});

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
