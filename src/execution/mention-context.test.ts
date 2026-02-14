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
  reviewComments?: Array<{
    id: number;
    body?: string | null;
    created_at: string;
    in_reply_to_id?: number;
    user?: { login?: string | null } | null;
  }>;
  parentComment?: {
    id: number;
    body?: string | null;
    created_at: string;
    in_reply_to_id?: number;
    user?: { login?: string | null } | null;
  };
  parentCommentErrorStatus?: number;
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
        getReviewComment: async () => {
          if (params.parentCommentErrorStatus) {
            throw { status: params.parentCommentErrorStatus };
          }
          return {
            data:
              params.parentComment ??
              ({
                id: 999,
                body: "<!-- kodiai:review-output-key:test --> parent",
                created_at: "2025-01-15T10:00:00Z",
                user: { login: "kodiai" },
              } as const),
          };
        },
        listReviewComments: async () => ({ data: params.reviewComments ?? [] }),
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
      inReplyToId: undefined,
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
      inReplyToId: undefined,
    };

    const ctx = await buildMentionContext(octokit, mention);
    expect(ctx).not.toContain("<!--");
    expect(ctx).not.toContain("hidden");
    expect(ctx).not.toContain("\u200B");
    expect(ctx).toContain("hello");
    expect(ctx).toContain("world");
  });

  test("sanitizes and bounds PR title/body context", async () => {
    const trigger = "2025-01-15T12:00:00Z";
    const octokit = makeOctokit({
      comments: [],
      pr: {
        title: "PR title <!-- hidden -->\u200B",
        body: "hello <!-- hidden -->\u200Bworld",
        user: { login: "pr-author" },
        head: { ref: "feature" },
        base: { ref: "main" },
      },
    });

    const mention: MentionEvent = {
      surface: "pr_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "carol",
      commentCreatedAt: trigger,
      headRef: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
    };

    const ctx = await buildMentionContext(octokit, mention, { maxPrBodyChars: 8 });
    expect(ctx).toContain("## Pull Request Context");
    expect(ctx).toContain("Title: PR title");
    expect(ctx).not.toContain("<!--");
    expect(ctx).not.toContain("hidden");
    expect(ctx).not.toContain("\u200B");
    expect(ctx).toContain("...[truncated]");
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
      inReplyToId: undefined,
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
      inReplyToId: undefined,
    };

    const ctx = await buildMentionContext(octokit, mention);

    expect(ctx).toContain("## Inline Review Comment Context");
    expect(ctx).toContain("File: src/index.ts");
    expect(ctx).toContain("Line: 42");
    expect(ctx).toContain("```diff");
    expect(ctx).toContain("+ new");
  });

  test("includes review thread context when inReplyToId is present", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 900,
        body: "<!-- kodiai:review-output-key:abc --> parent finding",
        created_at: "2025-01-15T10:00:00Z",
        user: { login: "kodiai" },
      },
      reviewComments: [
        {
          id: 900,
          body: "<!-- kodiai:review-output-key:abc --> parent finding",
          created_at: "2025-01-15T10:00:00Z",
          user: { login: "kodiai" },
        },
        {
          id: 901,
          body: "Can you explain this?",
          created_at: "2025-01-15T10:05:00Z",
          in_reply_to_id: 900,
          user: { login: "alice" },
        },
        {
          id: 902,
          body: "Triggering mention",
          created_at: "2025-01-15T10:06:00Z",
          in_reply_to_id: 900,
          user: { login: "alice" },
        },
      ],
    });

    const mention: MentionEvent = {
      surface: "pr_review_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 902,
      commentBody: "@kodiai what should I change?",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T10:06:00Z",
      headRef: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: "@@ -1,1 +1,1 @@",
      filePath: "src/index.ts",
      fileLine: 10,
      inReplyToId: 900,
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).toContain("## Review Comment Thread Context");
    expect(ctx).toContain("Can you explain this?");
    expect(ctx).not.toContain("Triggering mention");
  });

  test("includes finding metadata when findingLookup returns data", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 700,
        body: "<!-- kodiai:review-output-key:def --> finding",
        created_at: "2025-01-15T08:00:00Z",
        user: { login: "kodiai" },
      },
      reviewComments: [
        {
          id: 700,
          body: "<!-- kodiai:review-output-key:def --> finding",
          created_at: "2025-01-15T08:00:00Z",
          user: { login: "kodiai" },
        },
      ],
    });

    const mention: MentionEvent = {
      surface: "pr_review_comment",
      owner: "owner",
      repo: "repo",
      issueNumber: 1,
      prNumber: 1,
      commentId: 701,
      commentBody: "@kodiai follow-up",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T08:05:00Z",
      headRef: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 700,
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => ({
        severity: "major",
        category: "correctness",
        filePath: "src/app.ts",
        startLine: 22,
        title: "Handle undefined input",
      }),
    });

    expect(ctx).toContain("Original finding: [MAJOR] correctness");
    expect(ctx).toContain("File: src/app.ts");
    expect(ctx).toContain("Line: 22");
    expect(ctx).toContain("Title: Handle undefined input");
  });

  test("thread context omits finding metadata when lookup returns null", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 710,
        body: "<!-- kodiai:review-output-key:ghi --> finding",
        created_at: "2025-01-15T08:00:00Z",
        user: { login: "kodiai" },
      },
      reviewComments: [
        {
          id: 710,
          body: "<!-- kodiai:review-output-key:ghi --> finding",
          created_at: "2025-01-15T08:00:00Z",
          user: { login: "kodiai" },
        },
        {
          id: 711,
          body: "What does this mean?",
          created_at: "2025-01-15T08:04:00Z",
          in_reply_to_id: 710,
          user: { login: "alice" },
        },
      ],
    });

    const mention: MentionEvent = {
      surface: "pr_review_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 712,
      commentBody: "@kodiai follow-up",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T08:06:00Z",
      headRef: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 710,
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).toContain("## Review Comment Thread Context");
    expect(ctx).toContain("What does this mean?");
    expect(ctx).not.toContain("Original finding:");
  });

  test("skips thread context gracefully when parent review comment is missing", async () => {
    const octokit = makeOctokit({
      comments: [],
      reviewComments: [],
      parentCommentErrorStatus: 404,
    });

    const mention: MentionEvent = {
      surface: "pr_review_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 800,
      commentBody: "@kodiai follow-up",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T08:06:00Z",
      headRef: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 799,
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).not.toContain("## Review Comment Thread Context");
  });
});
