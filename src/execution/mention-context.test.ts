import { describe, test, expect } from "bun:test";
import type { Octokit } from "@octokit/rest";
import type { MentionEvent } from "../handlers/mention-types.ts";
import { buildMentionContext } from "./mention-context.ts";

function makeOctokit(params: {
  comments: Array<{
    id?: number;
    body?: string | null;
    created_at: string;
    updated_at?: string;
    user?: { login?: string | null } | null;
  }>;
  pr?: {
    title: string;
    body?: string | null;
    user?: { login?: string | null } | null;
    head: { ref: string };
    base: { ref: string };
  };
}): Octokit {
  const pr =
    params.pr ??
    ({
      title: "PR title",
      body: "PR body",
      user: { login: "pr-author" },
      head: { ref: "feature" },
      base: { ref: "main" },
    } as const);

  return {
    rest: {
      issues: {
        listComments: async () => ({ data: params.comments }),
      },
      pulls: {
        get: async () => ({ data: pr }),
      },
    },
  } as unknown as Octokit;
}

describe("buildMentionContext", () => {
  test("excludes comments newer than trigger timestamp (TOCTOU)", async () => {
    const trigger = "2025-01-15T12:00:00Z";

    const octokit = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:59:59Z",
          body: "before",
          user: { login: "alice" },
        },
        {
          id: 2,
          created_at: "2025-01-15T12:01:00Z",
          body: "after",
          user: { login: "bob" },
        },
      ],
    });

    const mention: MentionEvent = {
      surface: "issue_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: undefined,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "carol",
      commentCreatedAt: trigger,
      headRef: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
    };

    const ctx = await buildMentionContext(octokit, mention, {
      maxComments: 50,
      maxCommentChars: 500,
    });

    expect(ctx).toContain("before");
    expect(ctx).not.toContain("after");
  });

  test("runs sanitization (HTML comments + invisible unicode removed)", async () => {
    const trigger = "2025-01-15T12:00:00Z";
    const octokit = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:00:00Z",
          body: "hello <!-- hidden -->\u200Bworld",
          user: { login: "alice" },
        },
      ],
    });

    const mention: MentionEvent = {
      surface: "issue_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: undefined,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "carol",
      commentCreatedAt: trigger,
      headRef: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
    };

    const ctx = await buildMentionContext(octokit, mention);
    expect(ctx).not.toContain("<!--");
    expect(ctx).not.toContain("hidden");
    expect(ctx).not.toContain("\u200B");
    expect(ctx).toContain("hello");
    expect(ctx).toContain("world");
  });

  test("truncation and limits are deterministic", async () => {
    const trigger = "2025-01-15T12:00:00Z";
    const octokit = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T09:00:00Z",
          body: "oldest",
          user: { login: "alice" },
        },
        {
          id: 2,
          created_at: "2025-01-15T10:00:00Z",
          body: "x".repeat(100),
          user: { login: "bob" },
        },
        {
          id: 3,
          created_at: "2025-01-15T11:00:00Z",
          body: "y".repeat(100),
          user: { login: "carol" },
        },
      ],
    });

    const mention: MentionEvent = {
      surface: "issue_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: undefined,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "dave",
      commentCreatedAt: trigger,
      headRef: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
    };

    const ctx = await buildMentionContext(octokit, mention, {
      maxComments: 2,
      maxCommentChars: 20,
    });

    // Only most recent 2 comments included.
    expect(ctx).not.toContain("oldest");
    expect(ctx).toContain("### @bob");
    expect(ctx).toContain("### @carol");

    // Bodies are deterministically truncated.
    expect(ctx).toContain("...[truncated]");
  });

  test("includes inline review file/line and diff hunk when available", async () => {
    const trigger = "2025-01-15T12:00:00Z";
    const octokit = makeOctokit({ comments: [] });

    const mention: MentionEvent = {
      surface: "pr_review_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "dave",
      commentCreatedAt: trigger,
      headRef: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: "@@ -1,1 +1,1\n- old\n+ new",
      filePath: "src/index.ts",
      fileLine: 42,
    };

    const ctx = await buildMentionContext(octokit, mention);

    expect(ctx).toContain("## Inline Review Comment Context");
    expect(ctx).toContain("File: src/index.ts");
    expect(ctx).toContain("Line: 42");
    expect(ctx).toContain("```diff");
    expect(ctx).toContain("+ new");
  });
});
