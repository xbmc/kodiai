import { describe, expect, mock, test } from "bun:test";
import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { ErrorCommentPublicationStatus } from "../lib/errors.ts";
import { publishReviewFailureFallback } from "./review-failure-publication.ts";

describe("publishReviewFailureFallback", () => {
  test("publishes the generic failure fallback and reports created resolution", async () => {
    const postOrUpdateErrorComment = mock(async (
      _octokit: Octokit,
      _target: { owner: string; repo: string; issueNumber: number },
      _body: string,
      _logger: Logger,
    ): Promise<ErrorCommentPublicationStatus> => ({
      ok: true as const,
      value: { resolution: "created", method: "create-comment" },
    }));
    const phaseCalls: string[] = [];

    const result = await publishReviewFailureFallback({
      octokit: {} as never,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      logger: {} as never,
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: phase => phaseCalls.push(phase),
      postOrUpdateErrorComment,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: true,
        resolution: "failure-fallback",
        fallbackDelivery: "error-comment-created",
      },
    });
    expect(phaseCalls).toEqual(["publish"]);
    expect(postOrUpdateErrorComment).toHaveBeenCalledTimes(1);
    expect(postOrUpdateErrorComment.mock.calls[0]![1]).toEqual({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
    });
    expect(postOrUpdateErrorComment.mock.calls[0]![2]).toContain(
      "Kodiai could not publish a trustworthy review result",
    );
  });

  test("reports failed publication without marking output published", async () => {
    const postOrUpdateErrorComment = mock(async (
      _octokit: Octokit,
      _target: { owner: string; repo: string; issueNumber: number },
      _body: string,
      _logger: Logger,
    ): Promise<ErrorCommentPublicationStatus> => ({
      ok: false as const,
      err: new Error("comment failed"),
    }));

    const result = await publishReviewFailureFallback({
      octokit: {} as never,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      logger: {} as never,
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => {},
      postOrUpdateErrorComment,
    });

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        resolution: "failure-fallback-failed",
        fallbackDelivery: "error-comment-failed",
      },
    });
  });

  test("does not publish when visible-output rights were lost", async () => {
    const postOrUpdateErrorComment = mock(async (
      _octokit: Octokit,
      _target: { owner: string; repo: string; issueNumber: number },
      _body: string,
      _logger: Logger,
    ): Promise<ErrorCommentPublicationStatus> => ({
      ok: true as const,
      value: { resolution: "created", method: "create-comment" },
    }));

    const result = await publishReviewFailureFallback({
      octokit: {} as never,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      logger: {} as never,
      canPublishVisibleOutput: () => false,
      setReviewWorkPhase: () => {
        throw new Error("phase should not be marked when publication is gated");
      },
      postOrUpdateErrorComment,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        published: false,
        resolution: "skipped",
        fallbackDelivery: undefined,
      },
    });
    expect(postOrUpdateErrorComment).not.toHaveBeenCalled();
  });
});
