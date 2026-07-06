import { describe, expect, test } from "bun:test";
import { postReviewRequestedEyesReaction } from "./review-reactions.ts";

function makeLogger() {
  const warnCalls: unknown[][] = [];
  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => warnCalls.push(args),
    },
  };
}

describe("postReviewRequestedEyesReaction", () => {
  test("posts an eyes reaction to the pull request issue for review-requested events", async () => {
    const reactionCalls: unknown[] = [];
    const octokit = {
      rest: {
        reactions: {
          createForIssue: async (params: unknown) => {
            reactionCalls.push(params);
            return {};
          },
        },
      },
    };
    const { logger, warnCalls } = makeLogger();

    await postReviewRequestedEyesReaction({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      logger: logger as never,
    });

    expect(reactionCalls).toEqual([
      {
        owner: "acme",
        repo: "repo",
        issue_number: 42,
        content: "eyes",
      },
    ]);
    expect(warnCalls).toEqual([]);
  });

  test("logs and continues when the eyes reaction fails", async () => {
    const { logger, warnCalls } = makeLogger();
    const err = new Error("reaction failed");
    const octokit = {
      rest: {
        reactions: {
          createForIssue: async () => {
            throw err;
          },
        },
      },
    };

    await postReviewRequestedEyesReaction({
      octokit: octokit as never,
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      logger: logger as never,
    });

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({ err, prNumber: 42 });
    expect(warnCalls[0]?.[1]).toBe("Failed to add eyes reaction to PR");
  });
});
