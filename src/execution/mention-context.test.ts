import { describe, test, expect } from "bun:test";
import type { Octokit } from "@octokit/rest";
import type { MentionEvent } from "../handlers/mention-types.ts";
import {
  buildMentionContext,
  buildMentionContextDetails,
  buildMentionContextFingerprint,
  type MentionContextAdmissionPolicy,
} from "./mention-context.ts";

function makeOctokit(params: {
  comments: Array<{
    id?: number;
    body?: string | null;
    created_at: string;
    updated_at?: string;
    user?: { login?: string | null } | null;
  }>;
  commentPages?: Array<Array<{
    id?: number;
    body?: string | null;
    created_at: string;
    updated_at?: string;
    user?: { login?: string | null } | null;
  }>>;
  pr?: {
    title: string;
    body?: string | null;
    updated_at?: string;
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
  reviewCommentPages?: Array<Array<{
    id: number;
    body?: string | null;
    created_at: string;
    in_reply_to_id?: number;
    user?: { login?: string | null } | null;
  }>>;
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
        listComments: async (request: { page?: number; per_page?: number } = {}) => {
          if (params.commentPages) {
            const page = request.page ?? 1;
            const pageCount = params.commentPages.length;
            return {
              data: params.commentPages[page - 1] ?? [],
              headers:
                pageCount > 1
                  ? {
                      link: `<https://api.github.test/repos/o/r/issues/1/comments?page=${pageCount}&per_page=${request.per_page ?? 100}>; rel="last"`,
                    }
                  : {},
            };
          }
          return { data: params.comments, headers: {} };
        },
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
        listReviewComments: async (request: { page?: number } = {}) => {
          if (params.reviewCommentPages) {
            const page = request.page ?? 1;
            return { data: params.reviewCommentPages[page - 1] ?? [] };
          }
          return { data: params.reviewComments ?? [] };
        },
      },
    },
  } as unknown as Octokit;
}

function minimalAdmissionPolicy(): MentionContextAdmissionPolicy {
  return {
    includeConversationHistory: false,
    includePrMetadata: false,
    includeReviewThread: false,
    includeInlineReviewContext: true,
  };
}

describe("buildMentionContext", () => {
  test("returns fine-grained prompt-section metrics for admitted mention context", async () => {
    const octokit = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:00:00Z",
          body: "hello world",
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
      commentCreatedAt: "2025-01-15T12:00:00Z",
      headRef: undefined,
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const result = await buildMentionContextDetails(octokit, mention, {
      admissionPolicy: {
        includeConversationHistory: true,
        includePrMetadata: false,
        includeReviewThread: false,
        includeInlineReviewContext: false,
      },
    });

    expect(result.text).toContain("## Conversation History");
    expect(result.sections.map((section) => section.sectionName)).toEqual([
      "mention-conversation-history",
    ]);
    expect(result.sections[0]?.charCount).toBe(result.text.length);
    expect(result.sections[0]?.estimatedTokens).toBe(Math.ceil(result.text.length / 4));
  });

  test("default conversational policy omits heavy sections instead of relying on truncation alone", async () => {
    const octokit = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:00:00Z",
          body: "hello world",
          user: { login: "alice" },
        },
      ],
      pr: {
        title: "PR title",
        body: "PR body",
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
      commentCreatedAt: "2025-01-15T12:00:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const result = await buildMentionContextDetails(octokit, mention, {
      admissionPolicy: minimalAdmissionPolicy(),
    });

    expect(result.text).toBe("");
    expect(result.sections).toEqual([]);
  });

  test("explicit review policy keeps conversation, PR metadata, and review thread as separate sections", async () => {
    const octokit = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:00:00Z",
          body: "conversation turn",
          user: { login: "alice" },
        },
      ],
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
          body: "please explain this",
          created_at: "2025-01-15T10:05:00Z",
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
      commentBody: "@kodiai review this",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T10:06:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: "@@ -1,1 +1,1\n- old\n+ new",
      filePath: "src/index.ts",
      fileLine: 10,
      inReplyToId: 900,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const result = await buildMentionContextDetails(octokit, mention, {
      admissionPolicy: {
        includeConversationHistory: true,
        includePrMetadata: true,
        includeReviewThread: true,
        includeInlineReviewContext: true,
      },
      findingLookup: () => null,
    });

    expect(result.sections.map((section) => section.sectionName)).toEqual([
      "mention-conversation-history",
      "mention-pr-metadata",
      "mention-inline-review-context",
      "mention-review-thread-context",
    ]);
    expect(result.text).toContain("## Conversation History");
    expect(result.text).toContain("## Pull Request Context");
    expect(result.text).toContain("## Inline Review Comment Context");
    expect(result.text).toContain("## Review Comment Thread Context");
  });

  test("error paths fail open to empty/minimal mention context", async () => {
    const octokit = {
      rest: {
        issues: {
          listComments: async () => {
            throw new Error("GitHub unavailable");
          },
        },
        pulls: {
          get: async () => ({
            data: {
              title: "PR title",
              body: "PR body",
              user: { login: "pr-author" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          getReviewComment: async () => {
            throw new Error("unused");
          },
          listReviewComments: async () => ({ data: [] }),
        },
      },
    } as unknown as Octokit;

    const mention: MentionEvent = {
      surface: "issue_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: undefined,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "carol",
      commentCreatedAt: "2025-01-15T12:00:00Z",
      headRef: undefined,
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const result = await buildMentionContextDetails(octokit, mention, {
      admissionPolicy: {
        includeConversationHistory: true,
        includePrMetadata: true,
        includeReviewThread: false,
        includeInlineReviewContext: false,
      },
    });

    expect(result.text).toBe("");
    expect(result.sections).toEqual([]);
  });

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
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
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
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
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
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
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
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
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

  test("uses the last issue-comment pages for recent context when GitHub returns oldest-first pages", async () => {
    const trigger = "2025-01-15T12:00:00Z";
    const octokit = makeOctokit({
      comments: [],
      commentPages: [
        [
          {
            id: 1,
            created_at: "2025-01-15T08:00:00Z",
            body: "ancient page one",
            user: { login: "alice" },
          },
        ],
        [
          {
            id: 2,
            created_at: "2025-01-15T09:00:00Z",
            body: "middle page two",
            user: { login: "bob" },
          },
        ],
        [
          {
            id: 3,
            created_at: "2025-01-15T10:00:00Z",
            body: "recent page three",
            user: { login: "carol" },
          },
          {
            id: 4,
            created_at: "2025-01-15T11:00:00Z",
            body: "latest page three",
            user: { login: "dave" },
          },
        ],
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
      commentAuthor: "erin",
      commentCreatedAt: trigger,
      headRef: undefined,
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      maxComments: 2,
      maxCommentChars: 500,
      maxApiPages: 2,
    });

    expect(ctx).not.toContain("ancient page one");
    expect(ctx).not.toContain("middle page two");
    expect(ctx).toContain("recent page three");
    expect(ctx).toContain("latest page three");
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
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: "@@ -1,1 +1,1\n- old\n+ new",
      filePath: "src/index.ts",
      fileLine: 42,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
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
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: "@@ -1,1 +1,1 @@",
      filePath: "src/index.ts",
      fileLine: 10,
      inReplyToId: 900,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).toContain("## Review Comment Thread Context");
    expect(ctx).toContain("Can you explain this?");
    expect(ctx).not.toContain("Triggering mention");
  });

  test("finds review thread comments after the first PR review-comment page", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 950,
        body: "<!-- kodiai:review-output-key:paged --> parent finding",
        created_at: "2025-01-15T10:00:00Z",
        user: { login: "kodiai" },
      },
      reviewCommentPages: [
        Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          body: `unrelated page one ${index + 1}`,
          created_at: `2025-01-15T09:${String(index % 60).padStart(2, "0")}:00Z`,
          user: { login: "reviewer" },
        })),
        [
          {
            id: 950,
            body: "<!-- kodiai:review-output-key:paged --> parent finding",
            created_at: "2025-01-15T10:00:00Z",
            user: { login: "kodiai" },
          },
          {
            id: 951,
            body: "This reply is only on page two",
            created_at: "2025-01-15T10:05:00Z",
            in_reply_to_id: 950,
            user: { login: "alice" },
          },
          {
            id: 952,
            body: "Triggering mention",
            created_at: "2025-01-15T10:06:00Z",
            in_reply_to_id: 950,
            user: { login: "alice" },
          },
        ],
      ],
    });

    const mention: MentionEvent = {
      surface: "pr_review_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 952,
      commentBody: "@kodiai what should I change?",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T10:06:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: "@@ -1,1 +1,1 @@",
      filePath: "src/index.ts",
      fileLine: 10,
      inReplyToId: 950,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).toContain("## Review Comment Thread Context");
    expect(ctx).toContain("parent finding");
    expect(ctx).toContain("This reply is only on page two");
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
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 700,
      issueBody: "test issue body",
      issueTitle: "test issue title",
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
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 710,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).toContain("## Review Comment Thread Context");
    expect(ctx).toContain("What does this mean?");
    expect(ctx).not.toContain("Original finding:");
    expect(ctx).not.toContain("File:");
    expect(ctx).not.toContain("Line:");
  });

  test("thread context stays available when finding lookup throws", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 720,
        body: "<!-- kodiai:review-output-key:jkl --> finding",
        created_at: "2025-01-15T08:00:00Z",
        user: { login: "kodiai" },
      },
      reviewComments: [
        {
          id: 720,
          body: "<!-- kodiai:review-output-key:jkl --> finding",
          created_at: "2025-01-15T08:00:00Z",
          user: { login: "kodiai" },
        },
        {
          id: 721,
          body: "Can you break this down?",
          created_at: "2025-01-15T08:04:00Z",
          in_reply_to_id: 720,
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
      commentId: 722,
      commentBody: "@kodiai follow-up",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T08:06:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 720,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => {
        throw new Error("lookup unavailable");
      },
    });

    expect(ctx).toContain("## Review Comment Thread Context");
    expect(ctx).toContain("Can you break this down?");
    expect(ctx).not.toContain("Original finding:");
    expect(ctx).not.toContain("File:");
    expect(ctx).not.toContain("Line:");
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
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 799,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      findingLookup: () => null,
    });

    expect(ctx).not.toContain("## Review Comment Thread Context");
  });

  test("truncates older thread turns to 200 chars while keeping recent turns full", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 900,
        body: "ROOT-" + "r".repeat(260),
        created_at: "2025-01-15T10:00:00Z",
        user: { login: "kodiai" },
      },
      reviewComments: [
        {
          id: 900,
          body: "ROOT-" + "r".repeat(260),
          created_at: "2025-01-15T10:00:00Z",
          user: { login: "kodiai" },
        },
        {
          id: 901,
          body: "OLD-" + "o".repeat(260),
          created_at: "2025-01-15T10:01:00Z",
          in_reply_to_id: 900,
          user: { login: "alice" },
        },
        {
          id: 902,
          body: "MID-" + "m".repeat(260),
          created_at: "2025-01-15T10:02:00Z",
          in_reply_to_id: 900,
          user: { login: "alice" },
        },
        {
          id: 903,
          body: "NEW-1-" + "n".repeat(260),
          created_at: "2025-01-15T10:03:00Z",
          in_reply_to_id: 900,
          user: { login: "alice" },
        },
        {
          id: 904,
          body: "NEW-2-" + "p".repeat(260),
          created_at: "2025-01-15T10:04:00Z",
          in_reply_to_id: 900,
          user: { login: "alice" },
        },
        {
          id: 905,
          body: "trigger",
          created_at: "2025-01-15T10:05:00Z",
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
      commentId: 905,
      commentBody: "@kodiai follow-up",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T10:05:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 900,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      maxCommentChars: 500,
      findingLookup: () => null,
    });

    const truncatedCount = (ctx.match(/\.\.\.\[truncated\]/g) ?? []).length;
    expect(truncatedCount).toBe(2);
    expect(ctx).toContain("Older review thread turns were truncated to 200 characters");
  });

  test("fingerprint changes when admitted PR metadata or policy knobs change", async () => {
    const mention: MentionEvent = {
      surface: "pr_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: 1,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "carol",
      commentCreatedAt: "2025-01-15T12:00:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const octokitA = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:00:00Z",
          updated_at: "2025-01-15T11:01:00Z",
          body: "hello world",
          user: { login: "alice" },
        },
      ],
      pr: {
        title: "PR title",
        body: "original body",
        updated_at: "2025-01-15T11:30:00Z",
        user: { login: "pr-author" },
        head: { ref: "feature" },
        base: { ref: "main" },
      },
    });
    const octokitB = makeOctokit({
      comments: [
        {
          id: 1,
          created_at: "2025-01-15T11:00:00Z",
          updated_at: "2025-01-15T11:01:00Z",
          body: "hello world",
          user: { login: "alice" },
        },
      ],
      pr: {
        title: "PR title",
        body: "changed body",
        updated_at: "2025-01-15T11:31:00Z",
        user: { login: "pr-author" },
        head: { ref: "feature" },
        base: { ref: "main" },
      },
    });

    const basePolicy: MentionContextAdmissionPolicy = {
      includeConversationHistory: true,
      includePrMetadata: true,
      includeReviewThread: false,
      includeInlineReviewContext: false,
    };

    const base = await buildMentionContextFingerprint(octokitA, mention, {
      admissionPolicy: basePolicy,
      maxThreadChars: 200,
    });
    const changedPr = await buildMentionContextFingerprint(octokitB, mention, {
      admissionPolicy: basePolicy,
      maxThreadChars: 200,
    });
    const changedPolicy = await buildMentionContextFingerprint(octokitA, mention, {
      admissionPolicy: {
        ...basePolicy,
        includeConversationHistory: false,
      },
      maxThreadChars: 200,
    });

    expect(base.status).toBe("complete");
    expect(changedPr.status).toBe("complete");
    expect(changedPolicy.status).toBe("complete");
    expect(base.fingerprint).not.toBeNull();
    expect(base.fingerprint).not.toBe(changedPr.fingerprint);
    expect(base.fingerprint).not.toBe(changedPolicy.fingerprint);
  });

  test("fingerprint fails open when admitted comment identity is incomplete", async () => {
    const mention: MentionEvent = {
      surface: "issue_comment",
      owner: "o",
      repo: "r",
      issueNumber: 1,
      prNumber: undefined,
      commentId: 123,
      commentBody: "@kodiai question",
      commentAuthor: "carol",
      commentCreatedAt: "2025-01-15T12:00:00Z",
      headRef: undefined,
      headSha: undefined,
      baseRef: undefined,
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: undefined,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const octokit = makeOctokit({
      comments: [
        {
          created_at: "2025-01-15T11:00:00Z",
          updated_at: "2025-01-15T11:01:00Z",
          body: "missing id should bypass cache",
          user: { login: "alice" },
        },
      ],
    });

    const result = await buildMentionContextFingerprint(octokit, mention, {
      admissionPolicy: {
        includeConversationHistory: true,
        includePrMetadata: false,
        includeReviewThread: false,
        includeInlineReviewContext: false,
      },
    });

    expect(result.status).toBe("incomplete");
    expect(result.fingerprint).toBeNull();
    expect(result.missingSignals).toContain("conversation-comment-identity");
  });

  test("uses maxThreadChars budget for review thread context", async () => {
    const octokit = makeOctokit({
      comments: [],
      parentComment: {
        id: 910,
        body: "ROOT-" + "x".repeat(400),
        created_at: "2025-01-15T10:00:00Z",
        user: { login: "kodiai" },
      },
      reviewComments: [
        {
          id: 910,
          body: "ROOT-" + "x".repeat(400),
          created_at: "2025-01-15T10:00:00Z",
          user: { login: "kodiai" },
        },
        {
          id: 911,
          body: "OLD-" + "y".repeat(400),
          created_at: "2025-01-15T10:01:00Z",
          in_reply_to_id: 910,
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
      commentId: 912,
      commentBody: "@kodiai follow-up",
      commentAuthor: "alice",
      commentCreatedAt: "2025-01-15T10:02:00Z",
      headRef: "feature",
      headSha: "feature",
      baseRef: "main",
      headRepoOwner: undefined,
      headRepoName: undefined,
      diffHunk: undefined,
      filePath: undefined,
      fileLine: undefined,
      inReplyToId: 910,
      issueBody: "test issue body",
      issueTitle: "test issue title",
    };

    const ctx = await buildMentionContext(octokit, mention, {
      maxCommentChars: 500,
      maxThreadChars: 250,
      findingLookup: () => null,
    });

    expect(ctx).toContain("Review thread context truncated due to 250 character cap.");
  });
});
