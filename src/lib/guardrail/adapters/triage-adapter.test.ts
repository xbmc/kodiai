import { describe, expect, it } from "bun:test";
import { triageAdapter } from "./triage-adapter.ts";

describe("triageAdapter", () => {
  it("has surface 'triage' and minContentThreshold 10", () => {
    expect(triageAdapter.surface).toBe("triage");
    expect(triageAdapter.minContentThreshold).toBe(10);
  });

  describe("extractClaims", () => {
    it("extracts sentences from prose text", () => {
      const claims = triageAdapter.extractClaims(
        "This issue appears to be a bug. The error occurs during startup. It affects the login flow.",
      );
      expect(claims.length).toBe(3);
      expect(claims[0]).toBe("This issue appears to be a bug.");
    });

    it("skips table rows", () => {
      const output =
        "| Category | Value |\n| --- | --- |\n| Type | Bug |\n\nThis appears to be a critical bug in the auth module.";
      const claims = triageAdapter.extractClaims(output);
      // Table rows should be excluded from claims
      const hasTableRow = claims.some((c) => c.includes("|"));
      expect(hasTableRow).toBe(false);
      expect(claims.some((c) => c.includes("critical bug"))).toBe(true);
    });

    it("skips HTML tags like details", () => {
      const output =
        "<details>\n<summary>Info</summary>\nHidden content\n</details>\n\nThe bug causes a crash on startup.";
      const claims = triageAdapter.extractClaims(output);
      const hasHtml = claims.some((c) => c.trim().startsWith("<"));
      expect(hasHtml).toBe(false);
      expect(claims.some((c) => c.includes("crash on startup"))).toBe(true);
    });

    it("returns empty for empty text", () => {
      expect(triageAdapter.extractClaims("")).toEqual([]);
    });
  });

  describe("buildGroundingContext", () => {
    it("includes issue title, body, and label descriptions", () => {
      const ctx = triageAdapter.buildGroundingContext({
        issueTitle: "Login fails on Safari",
        issueBody: "When I try to login on Safari, it shows a blank page.",
        labelDescriptions: ["bug: Something is not working", "browser: Safari-specific issues"],
      });
      expect(ctx.providedContext).toContain("Login fails on Safari");
      expect(ctx.providedContext).toContain(
        "When I try to login on Safari, it shows a blank page.",
      );
      expect(ctx.providedContext).toContain("bug: Something is not working");
      expect(ctx.contextSources).toContain("issue");
      expect(ctx.contextSources).toContain("labels");
    });

    it("handles null body", () => {
      const ctx = triageAdapter.buildGroundingContext({
        issueTitle: "Title only",
        issueBody: null,
      });
      expect(ctx.providedContext).toContain("Title only");
      expect(ctx.providedContext).not.toContain(null as unknown as string);
    });
  });

  describe("reconstructOutput", () => {
    it("preserves table structure unchanged", () => {
      const output =
        "| Category | Value |\n| --- | --- |\n| Type | Bug |\n\nThis is a real bug.";
      const kept = ["This is a real bug."];
      const result = triageAdapter.reconstructOutput(output, kept);
      expect(result).toContain("| Category | Value |");
      expect(result).toContain("| Type | Bug |");
      expect(result).toContain("This is a real bug.");
    });

    it("preserves HTML structure unchanged", () => {
      const output =
        "<details>\n<summary>Details</summary>\nContent\n</details>\n\nKept text here.";
      const kept = ["Kept text here."];
      const result = triageAdapter.reconstructOutput(output, kept);
      expect(result).toContain("<details>");
      expect(result).toContain("Kept text here.");
    });

    it("returns empty string when no claims kept", () => {
      expect(triageAdapter.reconstructOutput("Some text.", [])).toBe("");
    });
  });
});
