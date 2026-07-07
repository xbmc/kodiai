import { describe, expect, mock, test } from "bun:test";
import { publishBoundedFirstPassReview } from "./review-partial-publication.ts";

describe("partial review publication", () => {
  test("publishes bounded first-pass review through the GitHub publication pipeline", async () => {
    const createComment = mock(async (params: unknown) => ({ data: { id: 321, params } }));
    const octokit = {
      rest: {
        issues: { createComment },
      },
    } as any;
    const phaseCalls: string[] = [];

    const commentId = await publishBoundedFirstPassReview({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      body: "Partial review for @claude.",
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: phase => phaseCalls.push(phase),
    });

    expect(commentId).toEqual({
      ok: true,
      value: {
        published: true,
        commentId: 321,
      },
    });
    expect(phaseCalls).toEqual(["publish"]);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 42,
      body: "Partial review for claude.",
    });
  });

  test("does not publish when visible-output rights were lost", async () => {
    const createComment = mock(async () => ({ data: { id: 321 } }));
    const octokit = {
      rest: {
        issues: { createComment },
      },
    } as any;

    const commentId = await publishBoundedFirstPassReview({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      body: "Partial review",
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => false,
      setReviewWorkPhase: () => {
        throw new Error("phase should not be marked when publication is gated");
      },
    });

    expect(commentId).toEqual({
      ok: true,
      value: {
        published: false,
        commentId: undefined,
      },
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  test("returns an error Result when bounded first-pass publication fails", async () => {
    const publishError = new Error("comment failed");
    const createComment = mock(async () => {
      throw publishError;
    });
    const octokit = {
      rest: {
        issues: { createComment },
      },
    } as any;

    const result = await publishBoundedFirstPassReview({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      body: "Partial review",
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: mock((_phase: "publish") => {}),
    });

    expect(result).toEqual({
      ok: false,
      err: {
        published: false,
        error: publishError,
      },
    });
  });
});
