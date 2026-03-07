import { describe, expect, it } from "bun:test";
import { slackAdapter } from "./slack-adapter.ts";

describe("slackAdapter", () => {
  it("has surface 'slack' and minContentThreshold 5", () => {
    expect(slackAdapter.surface).toBe("slack");
    expect(slackAdapter.minContentThreshold).toBe(5);
  });

  describe("extractClaims", () => {
    it("splits answer text into sentences", () => {
      const claims = slackAdapter.extractClaims(
        "The function uses a map. It processes each item. Returns the result.",
      );
      expect(claims.length).toBe(3);
    });

    it("returns empty array for empty text", () => {
      expect(slackAdapter.extractClaims("")).toEqual([]);
    });
  });

  describe("buildGroundingContext", () => {
    it("includes retrieval results and repo context", () => {
      const ctx = slackAdapter.buildGroundingContext({
        userMessage: "How does auth work?",
        retrievalResults: ["Auth uses JWT tokens"],
        repoContext: ["src/auth.ts: export function login()"],
      });
      expect(ctx.providedContext).toContain("Auth uses JWT tokens");
      expect(ctx.providedContext).toContain("src/auth.ts: export function login()");
      expect(ctx.providedContext).toContain("How does auth work?");
      expect(ctx.contextSources).toContain("retrieval");
      expect(ctx.contextSources).toContain("repo-code");
      expect(ctx.contextSources).toContain("user-message");
    });

    it("works with minimal input (just userMessage)", () => {
      const ctx = slackAdapter.buildGroundingContext({
        userMessage: "What does this do?",
      });
      expect(ctx.providedContext).toContain("What does this do?");
      expect(ctx.contextSources).toContain("user-message");
    });
  });

  describe("reconstructOutput", () => {
    it("joins kept sentences with spaces", () => {
      const result = slackAdapter.reconstructOutput(
        "First sentence. Second sentence. Third sentence.",
        ["First sentence.", "Third sentence."],
      );
      expect(result).toBe("First sentence. Third sentence.");
    });

    it("trims whitespace", () => {
      const result = slackAdapter.reconstructOutput("  Text.  ", ["Text."]);
      expect(result).toBe("Text.");
    });

    it("returns empty string when no claims kept", () => {
      expect(slackAdapter.reconstructOutput("Some text.", [])).toBe("");
    });
  });
});
