import { describe, test, expect } from "bun:test";
import {
  chunkReviewThread,
  countTokens,
  generateThreadId,
} from "./review-comment-chunker.ts";
import type { ReviewCommentInput } from "./review-comment-types.ts";

function makeInput(overrides: Partial<ReviewCommentInput> = {}): ReviewCommentInput {
  return {
    repo: "xbmc/xbmc",
    owner: "xbmc",
    prNumber: 42,
    prTitle: "Fix crash on startup",
    commentGithubId: 1000,
    inReplyToId: null,
    filePath: "src/main.cpp",
    startLine: 10,
    endLine: 15,
    diffHunk: "@@ -10,5 +10,8 @@",
    authorLogin: "alice",
    authorAssociation: "MEMBER",
    body: "This looks good but needs a null check.",
    githubCreatedAt: new Date("2025-01-15T10:00:00Z"),
    githubUpdatedAt: null,
    originalPosition: 42,
    reviewId: null,
    ...overrides,
  };
}

describe("countTokens", () => {
  test("counts whitespace-separated tokens", () => {
    expect(countTokens("hello world")).toBe(2);
    expect(countTokens("one two three four")).toBe(4);
    expect(countTokens("  leading   trailing  ")).toBe(2);
    expect(countTokens("")).toBe(0);
  });
});

describe("generateThreadId", () => {
  test("file-level comment uses filePath and originalPosition", () => {
    const comment = makeInput({ filePath: "src/main.cpp", originalPosition: 42 });
    expect(generateThreadId(comment)).toBe("xbmc/xbmc:42:src/main.cpp:42");
  });

  test("PR-level comment uses reviewId", () => {
    const comment = makeInput({
      filePath: null,
      originalPosition: null,
      reviewId: 999,
    });
    expect(generateThreadId(comment)).toBe("xbmc/xbmc:42:general:999");
  });

  test("fallback uses commentGithubId", () => {
    const comment = makeInput({
      filePath: null,
      originalPosition: null,
      reviewId: null,
      commentGithubId: 5555,
    });
    expect(generateThreadId(comment)).toBe("xbmc/xbmc:42:general:5555");
  });
});

describe("chunkReviewThread", () => {
  test("single short comment produces one chunk", () => {
    const thread = [makeInput()];
    const chunks = chunkReviewThread(thread);

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.repo).toBe("xbmc/xbmc");
    expect(chunks[0]!.owner).toBe("xbmc");
    expect(chunks[0]!.prNumber).toBe(42);
    expect(chunks[0]!.filePath).toBe("src/main.cpp");
    expect(chunks[0]!.authorLogin).toBe("alice");
    expect(chunks[0]!.chunkText).toContain("@alice");
    expect(chunks[0]!.chunkText).toContain("null check");
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
  });

  test("thread of 3 short comments concatenated into one chunk", () => {
    const thread = [
      makeInput({ commentGithubId: 1, body: "First comment" }),
      makeInput({
        commentGithubId: 2,
        authorLogin: "bob",
        body: "Reply from bob",
        inReplyToId: 1,
        githubCreatedAt: new Date("2025-01-15T10:01:00Z"),
      }),
      makeInput({
        commentGithubId: 3,
        authorLogin: "alice",
        body: "Thanks bob",
        inReplyToId: 1,
        githubCreatedAt: new Date("2025-01-15T10:02:00Z"),
      }),
    ];

    const chunks = chunkReviewThread(thread);

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).toContain("@alice");
    expect(chunks[0]!.chunkText).toContain("@bob");
    expect(chunks[0]!.chunkText).toContain("First comment");
    expect(chunks[0]!.chunkText).toContain("Reply from bob");
    expect(chunks[0]!.chunkText).toContain("Thanks bob");
  });

  test("long thread (>1024 tokens) produces multiple overlapping chunks", () => {
    // Create a comment body with ~1500 tokens
    const longBody = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(" ");
    const thread = [makeInput({ body: longBody })];

    const chunks = chunkReviewThread(thread);

    expect(chunks.length).toBeGreaterThan(1);
    // Check chunk indexes are sequential
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
    // Each chunk should be at most 1024 tokens
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1024);
    }
    // All metadata should come from root
    for (const chunk of chunks) {
      expect(chunk.repo).toBe("xbmc/xbmc");
      expect(chunk.threadId).toContain("xbmc/xbmc:42:");
    }
  });

  test("bot comments are filtered out", () => {
    const thread = [
      makeInput({ commentGithubId: 1, authorLogin: "alice", body: "Human comment" }),
      makeInput({
        commentGithubId: 2,
        authorLogin: "dependabot[bot]",
        body: "Bot comment",
        inReplyToId: 1,
        githubCreatedAt: new Date("2025-01-15T10:01:00Z"),
      }),
      makeInput({
        commentGithubId: 3,
        authorLogin: "kodiai",
        body: "Another bot comment",
        inReplyToId: 1,
        githubCreatedAt: new Date("2025-01-15T10:02:00Z"),
      }),
    ];

    const chunks = chunkReviewThread(thread);

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).toContain("Human comment");
    expect(chunks[0]!.chunkText).not.toContain("Bot comment");
    expect(chunks[0]!.chunkText).not.toContain("Another bot comment");
  });

  test("thread with only bot comments produces zero chunks", () => {
    const thread = [
      makeInput({ commentGithubId: 1, authorLogin: "dependabot[bot]", body: "Bot only" }),
      makeInput({
        commentGithubId: 2,
        authorLogin: "renovate",
        body: "Another bot",
        githubCreatedAt: new Date("2025-01-15T10:01:00Z"),
      }),
    ];

    const chunks = chunkReviewThread(thread);
    expect(chunks.length).toBe(0);
  });

  test("empty thread produces zero chunks", () => {
    const chunks = chunkReviewThread([]);
    expect(chunks.length).toBe(0);
  });

  test("thread ID generation for file-level vs PR-level comments", () => {
    const fileLevel = [
      makeInput({ filePath: "src/app.ts", originalPosition: 100 }),
    ];
    const prLevel = [
      makeInput({ filePath: null, originalPosition: null, reviewId: 777 }),
    ];

    const fileChunks = chunkReviewThread(fileLevel);
    const prChunks = chunkReviewThread(prLevel);

    expect(fileChunks[0]!.threadId).toBe("xbmc/xbmc:42:src/app.ts:100");
    expect(prChunks[0]!.threadId).toBe("xbmc/xbmc:42:general:777");
  });

  test("custom bot logins are respected", () => {
    const thread = [
      makeInput({ commentGithubId: 1, authorLogin: "my-custom-bot", body: "Custom bot" }),
      makeInput({
        commentGithubId: 2,
        authorLogin: "alice",
        body: "Human",
        githubCreatedAt: new Date("2025-01-15T10:01:00Z"),
      }),
    ];

    const customBots = new Set(["my-custom-bot"]);
    const chunks = chunkReviewThread(thread, { botLogins: customBots });

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkText).not.toContain("Custom bot");
    expect(chunks[0]!.chunkText).toContain("Human");
  });

  test("overlap produces shared content between adjacent chunks", () => {
    // Create content that is exactly 1500 words (after the header)
    const words = Array.from({ length: 1500 }, (_, i) => `token${i}`);
    const thread = [makeInput({ body: words.join(" ") })];

    const chunks = chunkReviewThread(thread, {
      windowSize: 1024,
      overlapSize: 256,
    });

    expect(chunks.length).toBeGreaterThan(1);

    // The second chunk should contain some words from the end of the first chunk
    if (chunks.length >= 2) {
      const chunk0Words = chunks[0]!.chunkText.split(/\s+/);
      const chunk1Words = chunks[1]!.chunkText.split(/\s+/);

      // The last 256 words of chunk0 should overlap with the first 256 of chunk1
      const endOfChunk0 = chunk0Words.slice(-256);
      const startOfChunk1 = chunk1Words.slice(0, 256);

      // They should share content
      const shared = endOfChunk0.filter((w) => startOfChunk1.includes(w));
      expect(shared.length).toBeGreaterThan(0);
    }
  });
});
