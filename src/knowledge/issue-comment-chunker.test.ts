import { describe, expect, it } from "bun:test";
import {
  buildIssueEmbeddingText,
  buildCommentEmbeddingText,
  chunkIssueComment,
  isBotComment,
} from "./issue-comment-chunker.ts";

describe("buildIssueEmbeddingText", () => {
  it("returns title only when body is null", () => {
    expect(buildIssueEmbeddingText("Bug: crash on startup", null)).toBe("Bug: crash on startup");
  });

  it("returns title only when body is empty string", () => {
    expect(buildIssueEmbeddingText("Bug: crash on startup", "")).toBe("Bug: crash on startup");
  });

  it("returns title + body separated by double newline", () => {
    const result = buildIssueEmbeddingText("Feature request", "Please add dark mode");
    expect(result).toBe("Feature request\n\nPlease add dark mode");
  });
});

describe("buildCommentEmbeddingText", () => {
  it("prefixes with issue context", () => {
    const result = buildCommentEmbeddingText(42, "Audio stuttering issue", "I reproduced this on Linux.");
    expect(result).toBe("Issue #42: Audio stuttering issue\n\nI reproduced this on Linux.");
  });

  it("includes issue number and title", () => {
    const result = buildCommentEmbeddingText(100, "Bug title", "Comment body");
    expect(result).toContain("Issue #100:");
    expect(result).toContain("Bug title");
  });
});

describe("chunkIssueComment", () => {
  it("returns single chunk for short comments", () => {
    const chunks = chunkIssueComment(1, "Title", "Short comment.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Issue #1: Title\n\nShort comment.");
  });

  it("returns multiple chunks for long comments with overlap", () => {
    // Create a comment that's definitely longer than 20 tokens
    const longBody = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkIssueComment(5, "Title", longBody, { maxTokens: 30, overlap: 5 });

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk should have the issue context prefix
    for (const chunk of chunks) {
      expect(chunk).toStartWith("Issue #5: Title\n\n");
    }
  });

  it("uses default maxTokens of 1024 and overlap of 256", () => {
    // Short enough to fit in one chunk with defaults
    const shortBody = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkIssueComment(1, "Title", shortBody);
    expect(chunks).toHaveLength(1);
  });

  it("handles overlap correctly between chunks", () => {
    // 100 body words, maxTokens 20, overlap 5 (prefix takes ~4 tokens)
    // body budget = 20 - 4 = 16, step = 16 - 5 = 11
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    const longBody = words.join(" ");
    const chunks = chunkIssueComment(1, "T", longBody, { maxTokens: 20, overlap: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should start with the prefix
    for (const chunk of chunks) {
      expect(chunk).toStartWith("Issue #1: T\n\n");
    }
  });
});

describe("isBotComment", () => {
  it("detects known default bots", () => {
    expect(isBotComment("dependabot")).toBe(true);
    expect(isBotComment("renovate")).toBe(true);
    expect(isBotComment("kodiai")).toBe(true);
    expect(isBotComment("github-actions")).toBe(true);
    expect(isBotComment("codecov")).toBe(true);
    expect(isBotComment("stale")).toBe(true);
    expect(isBotComment("kodi-butler")).toBe(true);
  });

  it("detects [bot] suffix logins", () => {
    expect(isBotComment("dependabot[bot]")).toBe(true);
    expect(isBotComment("some-ci[bot]")).toBe(true);
    expect(isBotComment("MyBot[bot]")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isBotComment("Dependabot")).toBe(true);
    expect(isBotComment("RENOVATE")).toBe(true);
    expect(isBotComment("Codecov[BOT]")).toBe(true);
  });

  it("allows human logins", () => {
    expect(isBotComment("octocat")).toBe(false);
    expect(isBotComment("jsmith")).toBe(false);
    expect(isBotComment("developer123")).toBe(false);
  });

  it("accepts custom bot logins set", () => {
    const customBots = new Set(["mybot", "ci-helper"]);
    expect(isBotComment("mybot", customBots)).toBe(true);
    expect(isBotComment("ci-helper", customBots)).toBe(true);
    expect(isBotComment("dependabot", customBots)).toBe(false); // not in custom set
  });
});
