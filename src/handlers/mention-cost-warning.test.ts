import { describe, expect, mock, test } from "bun:test";
import {
  buildMentionCostWarningBody,
  maybePostMentionCostWarning,
  postMentionCostWarning,
} from "./mention-cost-warning.ts";

describe("mention cost warning", () => {
  test("formats the public cost-warning body", () => {
    const body = buildMentionCostWarningBody({
      costUsd: 6.123456,
      thresholdUsd: 5,
    });

    expect(body).toContain("This execution cost $6.1235 USD");
    expect(body).toContain("threshold of $5.00 USD");
    expect(body).toContain("telemetry:");
    expect(body).toContain("costWarningUsd: 5.0");
  });

  test("publishes through the GitHub publication pipeline when eligible", async () => {
    const createComment = mock(async (params: unknown) => ({ data: { id: 99, params } }));
    const octokit = {
      rest: {
        issues: {
          createComment,
        },
      },
    } as any;

    const result = await postMentionCostWarning({
      getOctokit: async () => octokit,
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      costUsd: 6.123456,
      thresholdUsd: 5,
      botHandles: ["kodiai"],
    });

    expect(result).toEqual({
      ok: true,
      value: { status: "published", published: true },
    });
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 42,
      body: expect.stringContaining("This execution cost $6.1235 USD"),
    });
  });

  test("returns skipped Result when explicit review publication gate is closed", async () => {
    const createComment = mock(async () => ({ data: { id: 99 } }));

    const result = await maybePostMentionCostWarning({
      costUsd: 6,
      thresholdUsd: 5,
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: 42,
      explicitReviewRequest: true,
      reviewOutputKey: "review-key",
      canPublishExplicitReviewOutput: () => false,
      getOctokit: async () => ({
        rest: { issues: { createComment } },
      } as any),
      botHandles: ["kodiai"],
      logger: { warn: () => {} },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: "skipped", published: false },
    });
    expect(createComment).not.toHaveBeenCalled();
  });
});
