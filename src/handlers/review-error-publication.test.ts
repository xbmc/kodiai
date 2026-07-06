import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { err as resultErr, ok as resultOk } from "../lib/result.ts";
import type { ErrorCommentPublicationStatus } from "../lib/errors.ts";
import {
  publishReviewExecutionErrorFallback,
  publishReviewHandlerFailureError,
} from "./review-error-publication.ts";

function baseParams(
  overrides: Partial<Parameters<typeof publishReviewExecutionErrorFallback>[0]> = {},
) {
  return {
    octokit: {} as never,
    owner: "octo-org",
    repo: "widget",
    prNumber: 42,
    exhaustedTurnBudget: false,
    retryScheduled: false,
    category: "api_error" as const,
    errorMessage: "GitHub rejected the request",
    totalTimeoutSeconds: 600,
    complexityInfo: "risk=low",
    timeoutEstimate: null,
    logger: { warn: mock(() => {}) } as unknown as Logger,
    canPublishVisibleOutput: mock(() => true),
    setReviewWorkPhase: mock((_phase: "publish") => {}),
    postOrUpdateErrorComment: mock(async (): Promise<ErrorCommentPublicationStatus> =>
      resultOk({ resolution: "created", method: "create-comment" })
    ),
    ...overrides,
  };
}

describe("publishReviewExecutionErrorFallback", () => {
  test("publishes a normal execution error fallback and maps delivery", async () => {
    const postOrUpdateErrorComment = mock(async (
      _octokit: unknown,
      _target: unknown,
      body: string,
    ): Promise<ErrorCommentPublicationStatus> => {
      expect(body).toContain("Kodiai encountered an API error");
      return resultOk({ resolution: "updated", method: "update-comment" });
    });
    const params = baseParams({ postOrUpdateErrorComment });

    const result = await publishReviewExecutionErrorFallback(params);

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "error-fallback",
        fallbackDelivery: "error-comment-updated",
      },
    });
    expect(params.setReviewWorkPhase).toHaveBeenCalledWith("publish");
  });

  test("publishes a turn-limit notice with turn-limit delivery names", async () => {
    const postOrUpdateErrorComment = mock(async (
      _octokit: unknown,
      _target: unknown,
      body: string,
    ): Promise<ErrorCommentPublicationStatus> => {
      expect(body).toContain("ran out of steps");
      expect(body).toContain("reduced-scope retry has been scheduled");
      return resultOk({ resolution: "created", method: "create-comment" });
    });

    const result = await publishReviewExecutionErrorFallback(baseParams({
      exhaustedTurnBudget: true,
      retryScheduled: true,
      postOrUpdateErrorComment,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "turn-limit-fallback",
        fallbackDelivery: "turn-limit-comment-created",
      },
    });
  });

  test("reports failed turn-limit notice delivery without marking output published", async () => {
    const result = await publishReviewExecutionErrorFallback(baseParams({
      exhaustedTurnBudget: true,
      postOrUpdateErrorComment: mock(async (): Promise<ErrorCommentPublicationStatus> =>
        resultErr(new Error("comment failed"))
      ),
    }));

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        resolution: "turn-limit-fallback-undelivered",
        fallbackDelivery: "turn-limit-comment-undelivered",
      },
    });
  });

  test("skips publication when visible output rights are unavailable", async () => {
    const postOrUpdateErrorComment = mock(async (): Promise<ErrorCommentPublicationStatus> =>
      resultOk({ resolution: "created", method: "create-comment" })
    );
    const setReviewWorkPhase = mock((_phase: "publish") => {});

    const result = await publishReviewExecutionErrorFallback(baseParams({
      canPublishVisibleOutput: mock(() => false),
      setReviewWorkPhase,
      postOrUpdateErrorComment,
    }));

    expect(result).toEqual({
      ok: true,
      value: {
        published: false,
        resolution: "skipped",
        fallbackDelivery: undefined,
      },
    });
    expect(setReviewWorkPhase).not.toHaveBeenCalled();
    expect(postOrUpdateErrorComment).not.toHaveBeenCalled();
  });
});

describe("publishReviewHandlerFailureError", () => {
  test("posts a handler failure error comment and returns publication phase detail", async () => {
    const postOrUpdateErrorComment = mock(async (
      _octokit: unknown,
      target: unknown,
      body: string,
    ): Promise<ErrorCommentPublicationStatus> => {
      expect(target).toEqual({ owner: "octo-org", repo: "widget", issueNumber: 42 });
      expect(body).toContain("Kodiai could not complete the request");
      return resultOk({ resolution: "created", method: "create-comment" });
    });
    const setReviewWorkPhase = mock((_phase: "publish") => {});

    const result = await publishReviewHandlerFailureError({
      octokit: {} as never,
      owner: "octo-org",
      repo: "widget",
      prNumber: 42,
      error: new Error("handler exploded"),
      logger: { warn: mock(() => {}) } as unknown as Logger,
      canPublishVisibleOutput: mock(() => true),
      setReviewWorkPhase,
      postOrUpdateErrorComment,
    });

    expect(result).toEqual({
      phaseDetail: "posted error comment after handler failure",
    });
    expect(setReviewWorkPhase).toHaveBeenCalledWith("publish");
    expect(postOrUpdateErrorComment).toHaveBeenCalledTimes(1);
  });

  test("skips handler failure publication when publish rights are unavailable", async () => {
    const postOrUpdateErrorComment = mock(async (): Promise<ErrorCommentPublicationStatus> =>
      resultOk({ resolution: "created", method: "create-comment" })
    );
    const setReviewWorkPhase = mock((_phase: "publish") => {});

    const result = await publishReviewHandlerFailureError({
      octokit: {} as never,
      owner: "octo-org",
      repo: "widget",
      prNumber: 42,
      error: new Error("handler exploded"),
      logger: { warn: mock(() => {}) } as unknown as Logger,
      canPublishVisibleOutput: mock(() => false),
      setReviewWorkPhase,
      postOrUpdateErrorComment,
    });

    expect(result).toEqual({
      phaseDetail: "suppressed error comment after handler failure because publish rights were lost",
    });
    expect(setReviewWorkPhase).not.toHaveBeenCalled();
    expect(postOrUpdateErrorComment).not.toHaveBeenCalled();
  });
});
