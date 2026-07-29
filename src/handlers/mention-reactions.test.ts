import { describe, expect, test } from "bun:test";
import { postMentionEyesReaction } from "./mention-reactions.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent>): MentionEvent {
  return {
    surface: "issue_comment",
    owner: "acme",
    repo: "repo",
    issueNumber: 101,
    prNumber: undefined,
    commentId: 9001,
    commentBody: "@kodiai help",
    commentAuthor: "alice",
    commentCreatedAt: "2026-01-01T00:00:00Z",
    headRef: undefined,
    headSha: undefined,
    baseRef: undefined,
    headRepoOwner: undefined,
    headRepoName: undefined,
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: "issue body",
    issueTitle: "issue title",
    ...overrides,
  };
}

function makeLogger() {
  const warnCalls: unknown[][] = [];
  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => warnCalls.push(args),
    },
  };
}

describe("postMentionEyesReaction", () => {
  test("posts issue-comment reactions for issue and PR conversation mentions", async () => {
    const issueCommentCalls: unknown[] = [];
    const reviewCommentCalls: unknown[] = [];
    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async (params: unknown) => {
            issueCommentCalls.push(params);
            return {};
          },
          createForPullRequestReviewComment: async (params: unknown) => {
            reviewCommentCalls.push(params);
            return {};
          },
        },
      },
    };
    const { logger } = makeLogger();

    await postMentionEyesReaction({
      octokit: octokit as never,
      mention: makeMention({ surface: "pr_comment", prNumber: 55 }),
      logger: logger as never,
    });

    expect(issueCommentCalls).toEqual([
      {
        owner: "acme",
        repo: "repo",
        comment_id: 9001,
        content: "eyes",
      },
    ]);
    expect(reviewCommentCalls).toEqual([]);
  });

  test("posts review-comment reactions for inline review mentions", async () => {
    const issueCommentCalls: unknown[] = [];
    const reviewCommentCalls: unknown[] = [];
    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async (params: unknown) => {
            issueCommentCalls.push(params);
            return {};
          },
          createForPullRequestReviewComment: async (params: unknown) => {
            reviewCommentCalls.push(params);
            return {};
          },
        },
      },
    };
    const { logger } = makeLogger();

    await postMentionEyesReaction({
      octokit: octokit as never,
      mention: makeMention({ surface: "pr_review_comment", prNumber: 55 }),
      logger: logger as never,
    });

    expect(issueCommentCalls).toEqual([]);
    expect(reviewCommentCalls).toEqual([
      {
        owner: "acme",
        repo: "repo",
        comment_id: 9001,
        content: "eyes",
      },
    ]);
  });

  test("skips PR review body mentions because GitHub has no review-body reaction endpoint", async () => {
    const issueCommentCalls: unknown[] = [];
    const reviewCommentCalls: unknown[] = [];
    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async (params: unknown) => {
            issueCommentCalls.push(params);
            return {};
          },
          createForPullRequestReviewComment: async (params: unknown) => {
            reviewCommentCalls.push(params);
            return {};
          },
        },
      },
    };
    const { logger } = makeLogger();

    await postMentionEyesReaction({
      octokit: octokit as never,
      mention: makeMention({ surface: "pr_review_body", prNumber: 55 }),
      logger: logger as never,
    });

    expect(issueCommentCalls).toEqual([]);
    expect(reviewCommentCalls).toEqual([]);
  });

  test("logs and continues when reaction publication fails", async () => {
    const { logger, warnCalls } = makeLogger();
    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => {
            throw new Error("reaction failed");
          },
        },
      },
    };

    await postMentionEyesReaction({
      octokit: octokit as never,
      mention: makeMention({ surface: "issue_comment" }),
      logger: logger as never,
    });

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({ surface: "issue_comment" });
    expect(warnCalls[0]?.[1]).toBe("Failed to add eyes reaction");
  });
});
