import { describe, expect, mock, test } from "bun:test";
import {
  buildReviewCostWarningBody,
  maybePostReviewCostWarning,
  postReviewCostWarning,
} from "./review-cost-warning.ts";

describe("review cost warning", () => {
  test("formats the public cost-warning body", () => {
    const body = buildReviewCostWarningBody({
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

    const result = await maybePostReviewCostWarning({
      costUsd: 6.123456,
      thresholdUsd: 5,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      getOctokit: async () => octokit,
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => {},
      botHandles: ["kodiai", "claude"],
      logger: { warn: () => {} },
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

  test("returns err Result when publication fails", async () => {
    const failure = new Error("comment failed");
    const createComment = mock(async () => {
      throw failure;
    });

    const result = await postReviewCostWarning({
      getOctokit: async () => ({
        rest: { issues: { createComment } },
      } as any),
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      costUsd: 6.123456,
      thresholdUsd: 5,
      botHandles: ["kodiai", "claude"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBe(failure);
    }
  });

  test("does not publish when the visible-output gate is closed", async () => {
    const createComment = mock(async () => ({ data: { id: 99 } }));

    const result = await maybePostReviewCostWarning({
      costUsd: 6,
      thresholdUsd: 5,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      getOctokit: async () => ({
        rest: { issues: { createComment } },
      } as any),
      canPublishVisibleOutput: () => false,
      setReviewWorkPhase: () => {},
      botHandles: ["kodiai", "claude"],
      logger: { warn: () => {} },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: "skipped", published: false },
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  test("returns failed status when optional review cost warning publication fails", async () => {
    const failure = new Error("comment failed");
    const createComment = mock(async () => {
      throw failure;
    });
    const warn = mock(() => {});

    const result = await maybePostReviewCostWarning({
      costUsd: 6,
      thresholdUsd: 5,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      getOctokit: async () => ({
        rest: { issues: { createComment } },
      } as any),
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => {},
      botHandles: ["kodiai", "claude"],
      logger: { warn },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: "failed", published: false },
    });
    expect(warn).toHaveBeenCalledWith(
      { err: failure },
      "Failed to publish review cost warning comment (non-blocking)",
    );
  });
});
