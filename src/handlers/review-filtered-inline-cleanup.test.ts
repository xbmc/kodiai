import { describe, expect, mock, test } from "bun:test";
import { removeFilteredInlineCommentsForSuccessfulReview } from "./review-filtered-inline-cleanup.ts";

describe("removeFilteredInlineCommentsForSuccessfulReview", () => {
  test("skips cleanup when review output did not succeed", async () => {
    const removeFilteredInlineComments = mock(async () => ({ ok: true as const, value: { deletedCommentIds: [] } }));

    await removeFilteredInlineCommentsForSuccessfulReview({
      reviewOutputSucceeded: false,
      filteredInlineFindings: [{ commentId: 1 }],
      removeFilteredInlineComments,
      octokit: {} as never,
      owner: "octo",
      repo: "repo",
      logger: {} as never,
      baseLog: {},
    });

    expect(removeFilteredInlineComments).not.toHaveBeenCalled();
  });

  test("skips cleanup when no filtered inline findings exist", async () => {
    const removeFilteredInlineComments = mock(async () => ({ ok: true as const, value: { deletedCommentIds: [] } }));

    await removeFilteredInlineCommentsForSuccessfulReview({
      reviewOutputSucceeded: true,
      filteredInlineFindings: [],
      removeFilteredInlineComments,
      octokit: {} as never,
      owner: "octo",
      repo: "repo",
      logger: {} as never,
      baseLog: {},
    });

    expect(removeFilteredInlineComments).not.toHaveBeenCalled();
  });

  test("removes filtered inline comments after successful review output", async () => {
    const removeFilteredInlineComments = mock(async () => ({ ok: true as const, value: { deletedCommentIds: [10] } }));
    const filteredInlineFindings = [{ commentId: 10 }];

    await removeFilteredInlineCommentsForSuccessfulReview({
      reviewOutputSucceeded: true,
      filteredInlineFindings,
      removeFilteredInlineComments,
      octokit: {} as never,
      owner: "octo",
      repo: "repo",
      logger: {} as never,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(removeFilteredInlineComments).toHaveBeenCalledWith({
      octokit: {},
      owner: "octo",
      repo: "repo",
      findings: filteredInlineFindings,
      logger: {},
      baseLog: { deliveryId: "delivery-1" },
    });
  });
});
