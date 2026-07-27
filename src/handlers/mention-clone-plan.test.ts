import { describe, expect, mock, test } from "bun:test";
import type { MentionEvent } from "./mention-types.ts";
import { resolveMentionClonePlan } from "./mention-clone-plan.ts";

function mention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "issue_comment",
    owner: "xbmc",
    repo: "kodiai",
    issueNumber: 42,
    prNumber: undefined,
    commentId: 1001,
    commentBody: "@kodiai help",
    commentAuthor: "keith",
    commentCreatedAt: "2026-07-06T00:00:00Z",
    headRef: undefined,
    headSha: undefined,
    baseRef: undefined,
    headRepoOwner: undefined,
    headRepoName: undefined,
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Issue title",
    ...overrides,
  };
}

describe("resolveMentionClonePlan", () => {
  test("uses the repository default branch for issue mentions", async () => {
    const result = await resolveMentionClonePlan({
      mention: mention(),
      payload: { repository: { default_branch: "Omega" } },
      octokit: { rest: { pulls: { get: mock() } } } as any,
    });

    expect(result).toEqual({
      cloneOwner: "xbmc",
      cloneRepo: "kodiai",
      cloneRef: "Omega",
      cloneDepth: 1,
      usesPrRef: false,
      workspaceStrategy: "direct-branch-clone",
    });
  });

  test("hydrates missing PR refs and clones the base ref for PR issue comments", async () => {
    const prMention = mention({
      surface: "pr_comment",
      prNumber: 77,
      issueNumber: 77,
    });
    const pullsGet = mock(async () => ({
      data: {
        head: { ref: "feature-branch", sha: "feature-branch-sha", repo: { owner: { login: "contributor" }, name: "kodiai-fork" } },
        base: { ref: "main" },
      },
    }));

    const result = await resolveMentionClonePlan({
      mention: prMention,
      payload: {},
      octokit: { rest: { pulls: { get: pullsGet } } } as any,
    });

    expect(pullsGet).toHaveBeenCalledWith({
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 77,
    });
    expect(prMention).toMatchObject({
      headRef: "feature-branch",
      headSha: "feature-branch-sha",
      baseRef: "main",
      headRepoOwner: "contributor",
      headRepoName: "kodiai-fork",
    });
    expect(result).toEqual({
      cloneOwner: "xbmc",
      cloneRepo: "kodiai",
      cloneRef: "main",
      cloneDepth: 50,
      usesPrRef: true,
      workspaceStrategy: "base-clone+pull-ref-fetch",
    });
  });
});
