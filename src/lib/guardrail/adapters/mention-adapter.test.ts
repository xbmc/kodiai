import { describe, expect, it } from "bun:test";
import { mentionAdapter } from "./mention-adapter.ts";

describe("mentionAdapter", () => {
  it("has surface 'mention' and minContentThreshold 15", () => {
    expect(mentionAdapter.surface).toBe("mention");
    expect(mentionAdapter.minContentThreshold).toBe(15);
  });

  describe("extractClaims", () => {
    it("splits markdown response into sentences", () => {
      const output = "This is the first claim. The second claim follows. A third one here.";
      const claims = mentionAdapter.extractClaims(output);
      expect(claims.length).toBe(3);
      expect(claims[0]).toBe("This is the first claim.");
    });

    it("returns empty array for empty string", () => {
      expect(mentionAdapter.extractClaims("")).toEqual([]);
    });

    it("preserves code blocks as single claims", () => {
      const output = "Here is some text.\n```ts\nconst x = 1;\nconst y = 2;\n```\nMore text here.";
      const claims = mentionAdapter.extractClaims(output);
      // Code block content should not be split into sentences
      const hasCodeBlock = claims.some((c) => c.includes("```"));
      expect(hasCodeBlock).toBe(true);
    });
  });

  describe("buildGroundingContext", () => {
    it("includes issue body and PR description in providedContext", () => {
      const ctx = mentionAdapter.buildGroundingContext({
        issueBody: "Issue description here",
        prDescription: "PR description text",
      });
      expect(ctx.providedContext).toContain("Issue description here");
      expect(ctx.providedContext).toContain("PR description text");
      expect(ctx.contextSources).toContain("issue");
      expect(ctx.contextSources).toContain("pr-description");
    });

    it("includes conversation history and retrieval results", () => {
      const ctx = mentionAdapter.buildGroundingContext({
        conversationHistory: ["comment 1", "comment 2"],
        retrievalResults: ["result 1"],
      });
      expect(ctx.providedContext).toContain("comment 1");
      expect(ctx.providedContext).toContain("comment 2");
      expect(ctx.providedContext).toContain("result 1");
    });

    it("parses diffPatches into diffContext", () => {
      const ctx = mentionAdapter.buildGroundingContext({
        diffPatches: ["@@ -1,3 +1,3 @@\n-old line\n+new line\n context"],
      });
      expect(ctx.diffContext).toBeDefined();
      expect(ctx.diffContext!.addedLines).toContain("new line");
      expect(ctx.diffContext!.removedLines).toContain("old line");
    });

    it("returns empty context for empty input", () => {
      const ctx = mentionAdapter.buildGroundingContext({});
      expect(ctx.providedContext).toEqual([]);
      expect(ctx.contextSources).toEqual([]);
    });
  });

  describe("reconstructOutput", () => {
    it("joins kept claims into text", () => {
      const result = mentionAdapter.reconstructOutput(
        "First claim. Second claim. Third claim.",
        ["First claim.", "Third claim."],
      );
      expect(result).toContain("First claim.");
      expect(result).toContain("Third claim.");
      expect(result).not.toContain("Second claim.");
    });

    it("removes orphaned markdown headings", () => {
      const output = "## Section 1\n\nGood content here.\n\n## Section 2\n\nRemoved content.\n\n## Section 3\n\nMore good content.";
      const kept = ["Good content here.", "More good content."];
      const result = mentionAdapter.reconstructOutput(output, kept);
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 3");
      // Section 2 should be removed (orphaned -- no kept claims)
      expect(result).not.toContain("## Section 2");
    });

    it("preserves code blocks unchanged", () => {
      const output = "Some text.\n\n```ts\nconst x = 1;\n```\n\nMore text.";
      const kept = ["Some text.", "More text."];
      const result = mentionAdapter.reconstructOutput(output, kept);
      expect(result).toContain("```ts\nconst x = 1;\n```");
    });

    it("returns empty string when no claims kept", () => {
      const result = mentionAdapter.reconstructOutput("Some text.", []);
      expect(result).toBe("");
    });
  });
});
