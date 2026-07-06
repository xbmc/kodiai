import { describe, expect, mock, test } from "bun:test";
import {
  buildNoReviewSkipAcknowledgmentBody,
  postNoReviewSkipAcknowledgment,
} from "./review-no-review-skip.ts";

describe("no-review skip acknowledgment", () => {
  test("formats the no-review acknowledgment body", () => {
    expect(buildNoReviewSkipAcknowledgmentBody()).toBe(
      "Review skipped per `[no-review]` in PR title.",
    );
  });

  test("publishes the acknowledgment through the GitHub publication pipeline", async () => {
    const createComment = mock(async (params: unknown) => ({ data: { id: 123, params } }));
    const octokit = {
      rest: {
        issues: {
          createComment,
        },
      },
    } as any;

    await postNoReviewSkipAcknowledgment({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      botHandles: ["kodiai", "claude"],
    });

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 42,
      body: "Review skipped per `[no-review]` in PR title.",
    });
  });
});
