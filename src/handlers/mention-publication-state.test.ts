import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  buildCombinedReviewAndFormatMentionLogFields,
  buildCombinedReviewAndFormatThrownMentionLogFields,
  buildFormatOnlyMentionLogFields,
  buildMentionExecutionCompletedLogFields,
  createMentionExecutionCompletedLogger,
  mentionErrorDeliveryFromResult,
  recordMentionWriteRateLimitSuccess,
  resolveMentionExecutionPublicationState,
  type MentionPublishResolution,
} from "./mention-publication-state.ts";

describe("buildFormatOnlyMentionLogFields", () => {
  test("reports format-only formatter completion fields", () => {
    const fields = buildFormatOnlyMentionLogFields({
      mention: {
        surface: "issue_comment",
        owner: "xbmc",
        repo: "kodiai",
        issueNumber: 42,
        prNumber: 43,
      },
      deliveryId: "delivery-format",
      formatterResult: {
        status: "posted",
        commandStatus: "success",
        publisherStatus: "published",
        suggestions: 4,
        skipped: 1,
        capped: 2,
        posted: 3,
        publisherSkipped: 1,
        publisherFailed: false,
        partialFailure: false,
        reviewOutputKey: "formatter-output-key",
      },
      visibleReplyPosted: true,
      visibleReplyFailed: false,
    });

    expect(fields).toEqual({
      surface: "issue_comment",
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: 43,
      deliveryId: "delivery-format",
      reviewOutputKey: "formatter-output-key",
      reviewOutputAction: "mention-format-suggestions",
      formatterSuggestionRequest: true,
      formatterMode: "format-only",
      formatterStatus: "posted",
      commandStatus: "success",
      publisherStatus: "published",
      suggestions: 4,
      skipped: 1,
      capped: 2,
      posted: 3,
      publisherSkipped: 1,
      publisherFailed: false,
      partialFailure: false,
      visibleReplyPosted: true,
      visibleReplyFailed: false,
    });
  });
});

describe("buildCombinedReviewAndFormatMentionLogFields", () => {
  test("reports ordinary combined review-and-format partial failures", () => {
    const fields = buildCombinedReviewAndFormatMentionLogFields({
      mention: {
        surface: "issue_comment",
        owner: "xbmc",
        repo: "kodiai",
        issueNumber: 42,
        prNumber: 43,
      },
      deliveryId: "delivery-1",
      result: {
        conclusion: "error",
        stopReason: "tool_error",
        failureSubtype: "error_during_execution",
      },
      publishResolution: "error-comment-failed",
      publishFailureCategory: "api_error",
      publishFallbackDelivery: "error-comment-failed",
      formatterResult: {
        status: "failed",
        commandStatus: "failed",
        publisherStatus: undefined,
        suggestions: 2,
        skipped: 1,
        capped: 0,
        posted: 0,
        publisherSkipped: 0,
        publisherFailed: true,
        partialFailure: true,
        reviewOutputKey: "formatter-output-key",
      },
      visibleReplyPosted: false,
      visibleReplyFailed: true,
    });

    expect(fields).toEqual({
      surface: "issue_comment",
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: 43,
      deliveryId: "delivery-1",
      reviewOutputKey: "formatter-output-key",
      reviewOutputAction: "mention-format-suggestions",
      formatterSuggestionRequest: true,
      formatterMode: "review-and-format",
      reviewConclusion: "error",
      publishResolution: "error-comment-failed",
      publishFailureCategory: "api_error",
      publishFallbackDelivery: "error-comment-failed",
      formatterStatus: "failed",
      commandStatus: "failed",
      publisherStatus: undefined,
      suggestions: 2,
      skipped: 1,
      capped: 0,
      posted: 0,
      publisherSkipped: 0,
      publisherFailed: true,
      formatterPartialFailure: true,
      formatterVisibleReplyPosted: false,
      formatterVisibleReplyFailed: true,
      combinedPartialFailure: true,
    });
  });

  test("normalizes expected bounded review failures when formatting succeeds cleanly", () => {
    const fields = buildCombinedReviewAndFormatMentionLogFields({
      mention: {
        surface: "pull_request_review",
        owner: "xbmc",
        repo: "kodiai",
        issueNumber: 44,
        prNumber: 44,
      },
      deliveryId: "delivery-2",
      result: {
        conclusion: "failure",
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
      },
      publishResolution: "turn-limit-fallback-failed",
      publishFailureCategory: "timeout",
      publishFallbackDelivery: "error-comment-failed",
      formatterResult: {
        status: "posted",
        commandStatus: "success",
        publisherStatus: "published",
        suggestions: 1,
        skipped: 0,
        capped: 0,
        posted: 1,
        publisherSkipped: 0,
        publisherFailed: false,
        partialFailure: false,
        reviewOutputKey: "formatter-output-key",
      },
      visibleReplyPosted: true,
      visibleReplyFailed: false,
    });

    expect(fields).toMatchObject({
      reviewConclusion: "expected_bounded",
      boundedOutcomeReason: "max_turns",
      publishResolution: "turn-limit-fallback-undelivered",
      publishFallbackDelivery: "turn-limit-comment-undelivered",
      formatterStatus: "posted",
      formatterVisibleReplyPosted: true,
      combinedOutcome: "expected_bounded",
    });
    expect(fields).not.toHaveProperty("publishFailureCategory");
    expect(fields).not.toHaveProperty("publisherFailed");
    expect(fields).not.toHaveProperty("formatterPartialFailure");
    expect(fields).not.toHaveProperty("formatterVisibleReplyFailed");
    expect(fields).not.toHaveProperty("combinedPartialFailure");
  });
});

describe("buildCombinedReviewAndFormatThrownMentionLogFields", () => {
  test("reports formatter completion after the review executor throws", () => {
    const fields = buildCombinedReviewAndFormatThrownMentionLogFields({
      mention: {
        surface: "issue_comment",
        owner: "xbmc",
        repo: "kodiai",
        issueNumber: 42,
        prNumber: 43,
      },
      deliveryId: "delivery-throw",
      formatterResult: {
        status: "blocked",
        commandStatus: "failed",
        publisherStatus: "skipped",
        suggestions: 3,
        skipped: 2,
        capped: 1,
        posted: 0,
        publisherSkipped: 1,
        publisherFailed: true,
        partialFailure: true,
        reviewOutputKey: "formatter-output-key",
      },
      visibleReplyPosted: true,
      visibleReplyFailed: false,
    });

    expect(fields).toEqual({
      surface: "issue_comment",
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: 43,
      deliveryId: "delivery-throw",
      reviewOutputKey: "formatter-output-key",
      reviewOutputAction: "mention-format-suggestions",
      formatterSuggestionRequest: true,
      formatterMode: "review-and-format",
      reviewConclusion: "threw",
      formatterStatus: "blocked",
      commandStatus: "failed",
      publisherStatus: "skipped",
      suggestions: 3,
      skipped: 2,
      capped: 1,
      posted: 0,
      publisherSkipped: 1,
      publisherFailed: true,
      formatterPartialFailure: true,
      formatterVisibleReplyPosted: true,
      formatterVisibleReplyFailed: false,
      combinedPartialFailure: true,
    });
  });
});

describe("buildMentionExecutionCompletedLogFields", () => {
  test("reports ordinary mention failures with failure subtype and error category", () => {
    const fields = buildMentionExecutionCompletedLogFields({
      surface: "issue_comment",
      issueNumber: 42,
      result: {
        conclusion: "error",
        published: false,
        costUsd: 0.12,
        numTurns: 3,
        durationMs: 4000,
        sessionId: "session-1",
        stopReason: "tool_error",
        usedRepoInspectionTools: true,
        toolUseNames: ["read_file"],
      },
      mentionFailureSubtype: "usage_limit",
      mentionExecutionErrorCategory: "usage_limit",
      mentionOutputPublished: false,
      publishResolution: "error-fallback",
      publishFailureCategory: "usage_limit",
      publishFallbackDelivery: "error-comment-created",
      writeEnabled: false,
      mentionDerivedContextCacheStatus: "miss",
      mentionDerivedContextCacheReason: "fingerprint-changed",
      explicitReviewRequest: true,
      reviewOutputKey: "review-output-key",
    });

    expect(fields).toEqual({
      surface: "issue_comment",
      issueNumber: 42,
      conclusion: "error",
      failureSubtype: "usage_limit",
      published: false,
      executorPublished: false,
      publishResolution: "error-fallback",
      publishFailureCategory: "usage_limit",
      publishFallbackDelivery: "error-comment-created",
      writeEnabled: false,
      costUsd: 0.12,
      numTurns: 3,
      durationMs: 4000,
      sessionId: "session-1",
      stopReason: "tool_error",
      errorCategory: "usage_limit",
      usedRepoInspectionTools: true,
      toolUseNames: ["read_file"],
      mentionDerivedContextCacheStatus: "miss",
      mentionDerivedContextCacheReason: "fingerprint-changed",
      explicitReviewRequest: true,
      taskType: "review.full",
      lane: "interactive-review",
      reviewOutputKey: "review-output-key",
    });
  });

  test("normalizes expected max-turn outcomes without surfacing failure diagnostics", () => {
    const publishResolution: MentionPublishResolution = "turn-limit-fallback-failed";

    const fields = buildMentionExecutionCompletedLogFields({
      surface: "pr_review_comment",
      issueNumber: 77,
      result: {
        conclusion: "failure",
        published: false,
        stopReason: "max_turns",
      },
      mentionFailureSubtype: "error_max_turns",
      mentionExecutionErrorCategory: "timeout",
      mentionOutputPublished: false,
      publishResolution,
      publishFailureCategory: "timeout",
      publishFallbackDelivery: "error-comment-failed",
      writeEnabled: true,
      mentionDerivedContextCacheStatus: "hit",
      explicitReviewRequest: false,
    });

    expect(fields).toMatchObject({
      surface: "pr_review_comment",
      issueNumber: 77,
      conclusion: "expected_bounded",
      boundedOutcomeReason: "max_turns",
      publishResolution: "turn-limit-fallback-undelivered",
      publishFallbackDelivery: "turn-limit-comment-undelivered",
      writeEnabled: true,
      mentionDerivedContextCacheStatus: "hit",
      usedRepoInspectionTools: false,
      toolUseNames: [],
    });
    expect(fields).not.toHaveProperty("failureSubtype");
    expect(fields).not.toHaveProperty("publishFailureCategory");
    expect(fields).not.toHaveProperty("errorCategory");
  });
});

describe("resolveMentionExecutionPublicationState", () => {
  test("uses executor publication state when no explicit review publication ran", () => {
    const state = resolveMentionExecutionPublicationState({
      result: {
        conclusion: "success",
        published: true,
      },
      explicitReviewPublication: null,
      reviewPublishRightsLost: false,
    });

    expect(state).toEqual({
      mentionOutputPublished: true,
      publishResolution: "executor",
      publishFailureCategory: null,
      publishFallbackDelivery: null,
      mentionExecutionErrorCategory: undefined,
      mentionFailureSubtype: undefined,
      shouldDeferCompletionLog: false,
    });
  });

  test("projects explicit review publication failure into final mention publication state", () => {
    const state = resolveMentionExecutionPublicationState({
      result: {
        conclusion: "success",
        published: false,
      },
      explicitReviewPublication: {
        outputPublished: false,
        resolution: "publish-failure-fallback",
        failureCategory: "api_error",
        fallbackDelivery: "error-comment-created",
      },
      reviewPublishRightsLost: false,
    });

    expect(state).toEqual({
      mentionOutputPublished: false,
      publishResolution: "publish-failure-fallback",
      publishFailureCategory: "api_error",
      publishFallbackDelivery: "error-comment-created",
      mentionExecutionErrorCategory: undefined,
      mentionFailureSubtype: undefined,
      shouldDeferCompletionLog: false,
    });
  });

  test("defers completion logging for unpublished failures while publish rights remain current", () => {
    const state = resolveMentionExecutionPublicationState({
      result: {
        conclusion: "failure",
        published: false,
        errorMessage: "Claude AI usage limit reached",
      },
      explicitReviewPublication: null,
      reviewPublishRightsLost: false,
    });

    expect(state.mentionOutputPublished).toBe(false);
    expect(state.publishResolution).toBe("none");
    expect(state.mentionFailureSubtype).toBe("usage_limit");
    expect(state.shouldDeferCompletionLog).toBe(true);
  });

  test("does not defer completion logging after review publish rights are lost", () => {
    const state = resolveMentionExecutionPublicationState({
      result: {
        conclusion: "error",
        published: false,
        errorMessage: "request timed out",
        isTimeout: true,
      },
      explicitReviewPublication: null,
      reviewPublishRightsLost: true,
    });

    expect(state.mentionExecutionErrorCategory).toBe("timeout");
    expect(state.shouldDeferCompletionLog).toBe(false);
  });
});

describe("createMentionExecutionCompletedLogger", () => {
  test("logs mention completion from the latest state snapshot", () => {
    const entries: Array<{ fields: Record<string, unknown>; message?: string }> = [];
    const logMentionExecutionCompleted = createMentionExecutionCompletedLogger({
      logger: {
        info: (fields, message) => {
          entries.push({ fields, message });
        },
      },
      getState: () => ({
        surface: "issue_comment",
        issueNumber: 42,
        result: {
          conclusion: "success",
          published: true,
          costUsd: 0.12,
          numTurns: 3,
          durationMs: 4000,
          sessionId: "session-1",
          usedRepoInspectionTools: true,
          toolUseNames: ["read_file"],
        },
        mentionFailureSubtype: undefined,
        mentionExecutionErrorCategory: undefined,
        mentionOutputPublished: true,
        publishResolution: "executor",
        publishFailureCategory: null,
        publishFallbackDelivery: null,
        writeEnabled: false,
        mentionDerivedContextCacheStatus: "hit",
        mentionDerivedContextCacheReason: null,
        explicitReviewRequest: false,
        reviewOutputKey: undefined,
      }),
    });

    logMentionExecutionCompleted();

    expect(entries).toEqual([{
      fields: {
        surface: "issue_comment",
        issueNumber: 42,
        conclusion: "success",
        failureSubtype: undefined,
        published: true,
        executorPublished: true,
        publishResolution: "executor",
        publishFailureCategory: null,
        publishFallbackDelivery: null,
        writeEnabled: false,
        costUsd: 0.12,
        numTurns: 3,
        durationMs: 4000,
        sessionId: "session-1",
        stopReason: undefined,
        errorCategory: undefined,
        usedRepoInspectionTools: true,
        toolUseNames: ["read_file"],
        mentionDerivedContextCacheStatus: "hit",
      },
      message: "Mention execution completed",
    }]);
  });
});

describe("recordMentionWriteRateLimitSuccess", () => {
  test("records successful writes under the installation-scoped repo key", () => {
    const recordedKeys: string[] = [];

    recordMentionWriteRateLimitSuccess({
      store: {
        getLastWriteAt: () => undefined,
        recordWrite: (key) => {
          recordedKeys.push(key);
        },
      },
      installationId: 123,
      owner: "xbmc",
      repo: "kodiai",
    });

    expect(recordedKeys).toEqual(["123:xbmc/kodiai"]);
  });
});

describe("MentionErrorPostResult", () => {
  test("uses the shared Result adapter shape with a delivery accessor", () => {
    const source = readFileSync(new URL("./mention-publication-state.ts", import.meta.url), "utf8");

    expect(source).toContain("Result<MentionErrorDelivery");
    expect(source).not.toContain("posted: boolean");
    expect(mentionErrorDeliveryFromResult({ ok: true, value: "review-thread-reply" })).toBe("review-thread-reply");
    expect(mentionErrorDeliveryFromResult({ ok: false, err: new Error("failed") })).toBe("error-comment-failed");
  });
});
