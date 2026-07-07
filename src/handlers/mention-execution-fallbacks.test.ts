import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { err, ok } from "../lib/result.ts";
import { publishMentionExecutionFallbacks } from "./mention-execution-fallbacks.ts";

const logger = {
  warn: mock(() => undefined),
} as unknown as Logger;

describe("publishMentionExecutionFallbacks", () => {
  test("posts silent-success fallback when no output was published", async () => {
    const postMentionReply = mock(async (_body: string) => undefined);

    const state = await publishMentionExecutionFallbacks({
      writeEnabled: false,
      reviewPublishRightsLost: false,
      mentionOutputPublished: false,
      publishResolution: "none",
      publishFallbackDelivery: null,
      result: { conclusion: "success", resultText: "Done" },
      explicitReviewRequest: false,
      hasUnpublishedFindings: false,
      findingLines: [],
      skipReason: undefined,
      routingReason: undefined,
      reviewOutputKey: "review-output-1",
      surface: "issue",
      issueNumber: 123,
      canPublishExplicitReviewOutput: () => true,
      postMentionReply,
      postMentionError: async () => ok("error-comment-created"),
      logger,
    });

    expect(postMentionReply).toHaveBeenCalledTimes(1);
    expect(state.ok).toBe(true);
    if (!state.ok) throw state.err;
    expect(state.value).toEqual({
      mentionOutputPublished: true,
      publishResolution: "success-fallback",
      publishFallbackDelivery: null,
    });
  });

  test("does not post success fallback after explicit review publication fallback already failed", async () => {
    const postMentionReply = mock(async (_body: string) => undefined);

    await publishMentionExecutionFallbacks({
      writeEnabled: false,
      reviewPublishRightsLost: false,
      mentionOutputPublished: false,
      publishResolution: "publish-failure-comment-failed",
      publishFallbackDelivery: "error-comment-failed",
      result: { conclusion: "success", resultText: "Done" },
      explicitReviewRequest: true,
      hasUnpublishedFindings: true,
      findingLines: ["- [major] finding"],
      skipReason: "not-eligible",
      routingReason: undefined,
      reviewOutputKey: "review-output-1",
      surface: "pull_request_review",
      issueNumber: 123,
      canPublishExplicitReviewOutput: () => true,
      postMentionReply,
      postMentionError: async () => ok("error-comment-created"),
      logger,
    });

    expect(postMentionReply).not.toHaveBeenCalled();
  });

  test("updates publication state after error fallback delivery", async () => {
    const state = await publishMentionExecutionFallbacks({
      writeEnabled: false,
      reviewPublishRightsLost: false,
      mentionOutputPublished: false,
      publishResolution: "none",
      publishFallbackDelivery: null,
      result: { conclusion: "error", isTimeout: false, errorMessage: "boom" },
      explicitReviewRequest: false,
      hasUnpublishedFindings: false,
      findingLines: [],
      skipReason: undefined,
      routingReason: undefined,
      reviewOutputKey: "review-output-1",
      surface: "issue",
      issueNumber: 123,
      canPublishExplicitReviewOutput: () => true,
      postMentionReply: async () => undefined,
      postMentionError: async () => ok("error-comment-updated"),
      logger,
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw state.err;
    expect(state.value).toEqual({
      mentionOutputPublished: true,
      publishResolution: "error-fallback",
      publishFallbackDelivery: "error-comment-updated",
    });
  });

  test("updates publication state after failure fallback delivery errors", async () => {
    const state = await publishMentionExecutionFallbacks({
      writeEnabled: false,
      reviewPublishRightsLost: false,
      mentionOutputPublished: false,
      publishResolution: "none",
      publishFallbackDelivery: null,
      result: { conclusion: "failure", stopReason: "max_turns", failureSubtype: undefined },
      explicitReviewRequest: false,
      hasUnpublishedFindings: false,
      findingLines: [],
      skipReason: undefined,
      routingReason: "review-request",
      reviewOutputKey: "review-output-1",
      surface: "issue",
      issueNumber: 123,
      canPublishExplicitReviewOutput: () => true,
      postMentionReply: async () => undefined,
      postMentionError: async () => err(new Error("comment failed")),
      logger,
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw state.err;
    expect(state.value).toEqual({
      mentionOutputPublished: false,
      publishResolution: "turn-limit-fallback-failed",
      publishFallbackDelivery: "error-comment-failed",
    });
  });

  test("skips fallback publication after explicit review publish rights are lost", async () => {
    const postMentionError = mock(async (_body: string) => ok("error-comment-created" as const));

    const state = await publishMentionExecutionFallbacks({
      writeEnabled: false,
      reviewPublishRightsLost: true,
      mentionOutputPublished: false,
      publishResolution: "none",
      publishFallbackDelivery: null,
      result: { conclusion: "error", isTimeout: false, errorMessage: "boom" },
      explicitReviewRequest: true,
      hasUnpublishedFindings: false,
      findingLines: [],
      skipReason: undefined,
      routingReason: undefined,
      reviewOutputKey: "review-output-1",
      surface: "pull_request_review",
      issueNumber: 123,
      canPublishExplicitReviewOutput: () => true,
      postMentionReply: async () => undefined,
      postMentionError,
      logger,
    });

    expect(postMentionError).not.toHaveBeenCalled();
    expect(state.ok).toBe(true);
    if (!state.ok) throw state.err;
    expect(state.value.publishResolution).toBe("none");
  });
});
