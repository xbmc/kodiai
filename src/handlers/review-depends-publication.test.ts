import { describe, expect, mock, test } from "bun:test";
import { publishDependsReviewOutput } from "./review-depends-publication.ts";

describe("depends review publication", () => {
  test("publishes summary and inline comments through the GitHub publication pipeline", async () => {
    const createComment = mock(async (params: unknown) => ({ data: { id: 100, params } }));
    const createReview = mock(async (params: unknown) => ({ data: { id: 101, params } }));
    const octokit = {
      rest: {
        issues: { createComment },
        pulls: { createReview },
      },
    } as any;
    const phaseCalls: string[] = [];

    const result = await publishDependsReviewOutput({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      summaryBody: "Depends review for @claude.",
      inlineComments: [
        { path: "depends/common/libfoo/libfoo.txt", line: 12, body: "Check @claude." },
      ],
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: phase => phaseCalls.push(phase),
    });

    expect(result).toEqual({
      publishedSummary: true,
      publishedInlineComments: true,
    });
    expect(phaseCalls).toEqual(["publish", "publish"]);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 42,
      body: "Depends review for claude.",
    });
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createReview.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 42,
      event: "COMMENT",
      comments: [
        { path: "depends/common/libfoo/libfoo.txt", line: 12, body: "Check claude." },
      ],
    });
  });

  test("skips each publication surface when the visible-output gate is closed", async () => {
    const createComment = mock(async () => ({ data: { id: 100 } }));
    const createReview = mock(async () => ({ data: { id: 101 } }));
    const octokit = {
      rest: {
        issues: { createComment },
        pulls: { createReview },
      },
    } as any;

    const result = await publishDependsReviewOutput({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      summaryBody: "Depends review",
      inlineComments: [
        { path: "depends/common/libfoo/libfoo.txt", line: 12, body: "Check this." },
      ],
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => false,
      setReviewWorkPhase: () => {
        throw new Error("phase should not be marked when publication is gated");
      },
    });

    expect(result).toEqual({
      publishedSummary: false,
      publishedInlineComments: false,
    });
    expect(createComment).not.toHaveBeenCalled();
    expect(createReview).not.toHaveBeenCalled();
  });
});
