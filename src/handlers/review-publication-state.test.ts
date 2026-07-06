import { describe, expect, test } from "bun:test";
import {
  buildReviewExecutionCompletedLogFields,
  buildCanonicalReviewDetailsPublicationCompletedLogFields,
  buildReviewDetailsPublicationCompletedLogFields,
  buildReviewPhaseTimingSummaryLogFields,
  cleanTurnLimitReviewPublishResolution,
  createReviewExecutionCompletedLogger,
  describeReviewErrorCommentDelivery,
  describeTurnLimitNoticeDelivery,
  isExpectedTurnLimitReviewOutcome,
} from "./review-publication-state.ts";

describe("review publication state helpers", () => {
  test("maps error comment delivery from post-or-update status", () => {
    expect(describeReviewErrorCommentDelivery({ ok: false, err: new Error("failed") })).toBe("error-comment-failed");
    expect(describeReviewErrorCommentDelivery({ ok: true, value: { resolution: "updated", method: "update-comment" } })).toBe("error-comment-updated");
    expect(describeReviewErrorCommentDelivery({ ok: true, value: { resolution: "created", method: "create-comment" } })).toBe("error-comment-created");
  });

  test("maps turn-limit fallback delivery from post-or-update status", () => {
    expect(describeTurnLimitNoticeDelivery({ ok: false, err: new Error("failed") })).toBe("turn-limit-comment-undelivered");
    expect(describeTurnLimitNoticeDelivery({ ok: true, value: { resolution: "updated", method: "update-comment" } })).toBe("turn-limit-comment-updated");
    expect(describeTurnLimitNoticeDelivery({ ok: true, value: { resolution: "created", method: "create-comment" } })).toBe("turn-limit-comment-created");
  });

  test("detects max-turns bounded review outcomes", () => {
    expect(isExpectedTurnLimitReviewOutcome({ stopReason: "max_turns" })).toBe(true);
    expect(isExpectedTurnLimitReviewOutcome({ failureSubtype: "error_max_turns" })).toBe(true);
    expect(isExpectedTurnLimitReviewOutcome({ stopReason: "tool_use", failureSubtype: "other" })).toBe(false);
    expect(isExpectedTurnLimitReviewOutcome(undefined)).toBe(false);
  });

  test("normalizes turn-limit fallback failure resolution", () => {
    expect(cleanTurnLimitReviewPublishResolution("turn-limit-fallback-failed"))
      .toBe("turn-limit-fallback-undelivered");
    expect(cleanTurnLimitReviewPublishResolution("failure-fallback")).toBe("failure-fallback");
  });

  test("builds bounded review execution completion log fields", () => {
    expect(buildReviewExecutionCompletedLogFields({
      prNumber: 42,
      executorResult: {
        conclusion: "error",
        failureSubtype: "error_max_turns",
        stopReason: "max_turns",
        costUsd: 1.23,
        numTurns: 10,
        durationMs: 456,
        sessionId: "session-1",
      },
      reviewOutputPublished: true,
      reviewExecutorPublished: false,
      reviewPublishResolution: "turn-limit-fallback-failed",
      reviewPublishFallbackDelivery: "turn-limit-comment-undelivered",
    })).toEqual({
      prNumber: 42,
      conclusion: "expected_bounded",
      boundedOutcomeReason: "max_turns",
      published: true,
      executorPublished: false,
      publishResolution: "turn-limit-fallback-undelivered",
      publishFallbackDelivery: "turn-limit-comment-undelivered",
      stopReason: "max_turns",
      costUsd: 1.23,
      numTurns: 10,
      durationMs: 456,
      sessionId: "session-1",
    });
  });

  test("builds failed review execution completion log fields", () => {
    expect(buildReviewExecutionCompletedLogFields({
      prNumber: 42,
      executorResult: {
        conclusion: "failure",
        failureSubtype: "tool_error",
        stopReason: "tool_use",
        costUsd: undefined,
        numTurns: undefined,
        durationMs: 789,
        sessionId: undefined,
      },
      reviewOutputPublished: false,
      reviewExecutorPublished: true,
      reviewPublishResolution: "failure-fallback",
      reviewPublishFallbackDelivery: undefined,
    })).toEqual({
      prNumber: 42,
      conclusion: "failure",
      failureSubtype: "tool_error",
      published: false,
      executorPublished: true,
      publishResolution: "failure-fallback",
      publishFallbackDelivery: undefined,
      stopReason: "tool_use",
      costUsd: undefined,
      numTurns: undefined,
      durationMs: 789,
      sessionId: undefined,
    });
  });

  test("review execution completion logger skips until executor result is available", () => {
    const entries: Array<{ fields: Record<string, unknown>; message?: string }> = [];
    const logReviewExecutionCompleted = createReviewExecutionCompletedLogger({
      logger: {
        info: (fields, message) => {
          entries.push({ fields, message });
        },
      },
      getState: () => ({
        prNumber: 42,
        executorResult: undefined,
        reviewOutputPublished: false,
        reviewExecutorPublished: false,
        reviewPublishResolution: "none",
        reviewPublishFallbackDelivery: undefined,
      }),
    });

    logReviewExecutionCompleted();

    expect(entries).toEqual([]);
  });

  test("review execution completion logger logs at most once", () => {
    const entries: Array<{ fields: Record<string, unknown>; message?: string }> = [];
    const logReviewExecutionCompleted = createReviewExecutionCompletedLogger({
      logger: {
        info: (fields, message) => {
          entries.push({ fields, message });
        },
      },
      getState: () => ({
        prNumber: 42,
        executorResult: {
          conclusion: "success",
          failureSubtype: undefined,
          stopReason: "end_turn",
          costUsd: 0.42,
          numTurns: 3,
          durationMs: 1234,
          sessionId: "session-1",
        },
        reviewOutputPublished: true,
        reviewExecutorPublished: true,
        reviewPublishResolution: "clean-review-comment",
        reviewPublishFallbackDelivery: undefined,
      }),
    });

    logReviewExecutionCompleted();
    logReviewExecutionCompleted();

    expect(entries).toEqual([{
      fields: {
        prNumber: 42,
        conclusion: "success",
        failureSubtype: undefined,
        published: true,
        executorPublished: true,
        publishResolution: "clean-review-comment",
        publishFallbackDelivery: undefined,
        stopReason: "end_turn",
        costUsd: 0.42,
        numTurns: 3,
        durationMs: 1234,
        sessionId: "session-1",
      },
      message: "Review execution completed",
    }]);
  });

  test("builds bounded review phase timing summary fields", () => {
    const phases = [{
      name: "publication" as const,
      status: "completed" as const,
      durationMs: 25,
    }];

    expect(buildReviewPhaseTimingSummaryLogFields({
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-key",
      installationId: 123,
      repo: "acme/widgets",
      prNumber: 42,
      executorResult: {
        conclusion: "error",
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
      },
      reviewOutputPublished: false,
      reviewPublishResolution: "turn-limit-fallback-failed",
      reviewPublishFallbackDelivery: "turn-limit-comment-undelivered",
      totalDurationMs: 1000,
      phases,
    })).toEqual({
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-key",
      installationId: 123,
      repo: "acme/widgets",
      prNumber: 42,
      conclusion: "expected_bounded",
      boundedOutcomeReason: "max_turns",
      published: false,
      publishResolution: "turn-limit-fallback-undelivered",
      publishFallbackDelivery: "turn-limit-comment-undelivered",
      totalDurationMs: 1000,
      phases,
    });
  });

  test("builds Review Details publication completion log fields", () => {
    expect(buildReviewDetailsPublicationCompletedLogFields({
      baseLog: {
        owner: "acme",
        repo: "widgets",
        prNumber: 42,
      },
      reviewOutputKey: "review-output-key",
      deliveryId: "delivery-1",
      publicationMode: "degraded-fallback",
      surfaceKind: "issue_comment",
      commentId: 123,
      doctrineFields: {
        doctrineStatus: "applied",
        doctrineSource: "config",
      },
    })).toEqual({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      gate: "review-details-output",
      gateResult: "completed",
      reviewOutputKey: "review-output-key",
      deliveryId: "delivery-1",
      reviewDetailsPublished: true,
      publicationMode: "degraded-fallback",
      surfaceKind: "issue_comment",
      hasCommentId: true,
      hasReviewId: false,
      doctrineStatus: "applied",
      doctrineSource: "config",
    });
  });

  test("builds canonical Review Details completion fields from a surface", () => {
    expect(buildCanonicalReviewDetailsPublicationCompletedLogFields({
      surface: undefined,
      baseLog: {},
      reviewOutputKey: "review-output-key",
      deliveryId: "delivery-1",
    })).toBeUndefined();

    expect(buildCanonicalReviewDetailsPublicationCompletedLogFields({
      surface: { kind: "pull_review", reviewId: 987 },
      baseLog: {
        owner: "acme",
        repo: "widgets",
      },
      reviewOutputKey: "review-output-key",
      deliveryId: "delivery-1",
      publicationMode: "canonical",
      doctrineFields: {
        doctrineStatus: "applied",
      },
    })).toEqual({
      owner: "acme",
      repo: "widgets",
      gate: "review-details-output",
      gateResult: "completed",
      reviewOutputKey: "review-output-key",
      deliveryId: "delivery-1",
      reviewDetailsPublished: true,
      publicationMode: "canonical",
      surfaceKind: "pull_review",
      hasCommentId: false,
      hasReviewId: true,
      doctrineStatus: "applied",
    });
  });
});
