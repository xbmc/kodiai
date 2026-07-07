import { describe, expect, test } from "bun:test";
import type { MentionEvent } from "./mention-types.ts";
import { resolveMentionWriteRequestContext } from "./mention-write-request-context.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo",
    repo: "repo",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1001,
    commentBody: "@kodiai apply: fix it",
    commentAuthor: "alice",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "octo",
    headRepoName: "repo",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Fix it",
    ...overrides,
  };
}

describe("resolveMentionWriteRequestContext", () => {
  test("projects explicit apply requests into enabled write output context", () => {
    const context = resolveMentionWriteRequestContext({
      eventName: "issue_comment",
      installationId: 123,
      appSlug: "kodiai",
      mention: makeMention(),
      userQuestion: "apply: fix the parser",
      writeConfigEnabled: true,
    });

    expect(context.isPrSurface).toBe(true);
    expect(context.isIssueThreadComment).toBe(false);
    expect(context.explicitReviewRequest).toBe(false);
    expect(context.writeIntent).toMatchObject({
      writeIntent: true,
      keyword: "apply",
      request: "fix the parser",
    });
    expect(context.isWriteRequest).toBe(true);
    expect(context.isPlanOnly).toBe(false);
    expect(context.writeEnabled).toBe(true);
    expect(context.writeSource).toEqual({ type: "pr", number: 42 });
    expect(context.writeOutputKey).toContain("kodiai-write-output:v1:inst-123:octo/repo:pr-42");
    expect(context.writeBranchName).toContain("kodiai/apply/pr-42-comment-1001");
    expect(context.retryCommand).toBe("@kodiai apply: fix the parser");
  });

  test("detects explicit review requests on PR surfaces without enabling write output", () => {
    const context = resolveMentionWriteRequestContext({
      eventName: "issue_comment",
      installationId: 123,
      appSlug: "kodiai",
      mention: makeMention(),
      userQuestion: "review this please",
      writeConfigEnabled: true,
    });

    expect(context.explicitReviewRequest).toBe(true);
    expect(context.writeIntent.writeIntent).toBe(false);
    expect(context.writeEnabled).toBe(false);
    expect(context.writeOutputKey).toBeUndefined();
    expect(context.writeBranchName).toBeUndefined();
  });

  test("keeps plan-only requests out of write mode while preserving retry context", () => {
    const context = resolveMentionWriteRequestContext({
      eventName: "issue_comment",
      installationId: 123,
      appSlug: "kodiai",
      mention: makeMention({ prNumber: undefined, surface: "issue_comment" }),
      userQuestion: "plan: update the docs",
      writeConfigEnabled: true,
    });

    expect(context.isIssueThreadComment).toBe(true);
    expect(context.isPrSurface).toBe(false);
    expect(context.writeIntent).toMatchObject({
      writeIntent: true,
      keyword: "plan",
      request: "update the docs",
    });
    expect(context.isPlanOnly).toBe(true);
    expect(context.writeEnabled).toBe(false);
    expect(context.writeSource).toEqual({ type: "issue", number: 42 });
    expect(context.writeOutputKey).toBeUndefined();
    expect(context.retryCommand).toBe("@kodiai plan: update the docs");
  });

  test("promotes implementation-looking issue comments to implicit issue write intent", () => {
    const context = resolveMentionWriteRequestContext({
      eventName: "issue_comment",
      installationId: 123,
      appSlug: "kodiai",
      mention: makeMention({ prNumber: undefined, surface: "issue_comment" }),
      userQuestion: "please fix the parser",
      writeConfigEnabled: true,
    });

    expect(context.isIssueThreadComment).toBe(true);
    expect(context.writeIntent).toMatchObject({
      writeIntent: true,
      keyword: "apply",
      request: "please fix the parser",
    });
    expect(context.writeEnabled).toBe(true);
    expect(context.writeSource).toEqual({ type: "issue", number: 42 });
    expect(context.writeOutputKey).toContain("issue-42");
  });
});
