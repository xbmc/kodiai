import { describe, expect, mock, test } from "bun:test";
import { resolveMentionPrDiffContext } from "./mention-pr-diff-context.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo-org",
    repo: "widget",
    issueNumber: 42,
    prNumber: 42,
    commentId: 99,
    commentBody: "@kodiai explain this",
    commentAuthor: "mona",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    headSha: "feature",
    baseRef: "main",
    headRepoOwner: "octo-org",
    headRepoName: "widget",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Improve widget",
    ...overrides,
  };
}

describe("resolveMentionPrDiffContext", () => {
  test("prefetches and logs PR diff context for read-only PR mentions", async () => {
    const debug = mock((_fields: Record<string, unknown>, _message: string) => {});
    const collectDiff = mock(async () => ({
      stat: "src/widget.ts | 2 ++",
      diff: "diff --git a/src/widget.ts b/src/widget.ts\n+const widget = true;\n",
      truncated: false,
      fileCount: 1,
    }));

    const result = await resolveMentionPrDiffContext({
      allowPrDiffContext: true,
      writeEnabled: false,
      mention: makeMention(),
      workspaceDir: "/tmp/workspace",
      logger: { debug } as never,
      collectDiff,
    });

    expect(result?.fileCount).toBe(1);
    expect(collectDiff).toHaveBeenCalledWith(expect.objectContaining({
      workspaceDir: "/tmp/workspace",
      baseRef: "main",
      logContext: expect.objectContaining({
        surface: "pr_comment",
        prNumber: 42,
        baseRef: "main",
      }),
    }));
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "pr_comment",
        prNumber: 42,
        fileCount: 1,
        truncated: false,
      }),
      "Pre-fetched PR diff for mention context",
    );
  });

  test("skips prefetch when diff context is disabled or write mode is active", async () => {
    const collectDiff = mock(async () => {
      throw new Error("should not run");
    });

    expect(await resolveMentionPrDiffContext({
      allowPrDiffContext: false,
      writeEnabled: false,
      mention: makeMention(),
      workspaceDir: "/tmp/workspace",
      logger: { debug: () => undefined } as never,
      collectDiff,
    })).toBeUndefined();

    expect(await resolveMentionPrDiffContext({
      allowPrDiffContext: true,
      writeEnabled: true,
      mention: makeMention(),
      workspaceDir: "/tmp/workspace",
      logger: { debug: () => undefined } as never,
      collectDiff,
    })).toBeUndefined();

    expect(collectDiff).not.toHaveBeenCalled();
  });

  test("fails open when PR diff prefetch throws", async () => {
    const collectDiff = mock(async () => {
      throw new Error("git unavailable");
    });

    const result = await resolveMentionPrDiffContext({
      allowPrDiffContext: true,
      writeEnabled: false,
      mention: makeMention(),
      workspaceDir: "/tmp/workspace",
      logger: { debug: () => undefined } as never,
      collectDiff,
    });

    expect(result).toBeUndefined();
  });
});
