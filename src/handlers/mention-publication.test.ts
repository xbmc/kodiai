import { describe, expect, mock, test } from "bun:test";
import { publishExplicitMentionReviewApproval } from "./mention-publication.ts";

describe("mention publication", () => {
  test("publishes explicit review approval as a pull review when auto-approve is enabled", async () => {
    const createReview = mock(async (params: unknown) => ({ data: { id: 42, params } }));
    const createComment = mock(async () => ({ data: { id: 99 } }));
    const octokit = {
      rest: {
        pulls: { createReview },
        issues: { createComment },
      },
    } as any;

    const resolution = await publishExplicitMentionReviewApproval({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      body: "No findings for @claude.",
      autoApprove: true,
      botHandles: ["kodiai", "claude", "kodai"],
    });

    expect(resolution).toBe("approval-bridge");
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createComment).not.toHaveBeenCalled();
    expect(createReview.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 42,
      event: "APPROVE",
      body: "No findings for claude.",
    });
  });

  test("publishes explicit review approval as an issue comment when auto-approve is disabled", async () => {
    const createReview = mock(async () => ({ data: { id: 42 } }));
    const createComment = mock(async (params: unknown) => ({ data: { id: 99, params } }));
    const octokit = {
      rest: {
        pulls: { createReview },
        issues: { createComment },
      },
    } as any;

    const resolution = await publishExplicitMentionReviewApproval({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      body: "No findings for @claude.",
      autoApprove: false,
      botHandles: ["kodiai", "claude", "kodai"],
    });

    expect(resolution).toBe("comment-approval");
    expect(createReview).not.toHaveBeenCalled();
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 42,
      body: "No findings for claude.",
    });
  });
});
