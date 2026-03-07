import { describe, expect, it } from "bun:test";
import { wikiAdapter } from "./wiki-adapter.ts";

describe("wikiAdapter", () => {
  it("has surface 'wiki' and minContentThreshold 10", () => {
    expect(wikiAdapter.surface).toBe("wiki");
    expect(wikiAdapter.minContentThreshold).toBe(10);
  });

  describe("extractClaims", () => {
    it("splits suggestion text into sentences", () => {
      const claims = wikiAdapter.extractClaims(
        "PR #123 adds a new auth endpoint. The endpoint validates JWT tokens. It returns user profile data.",
      );
      expect(claims.length).toBe(3);
    });

    it("returns empty for empty text", () => {
      expect(wikiAdapter.extractClaims("")).toEqual([]);
    });
  });

  describe("buildGroundingContext", () => {
    it("includes patch diffs with PR numbers and wiki page content", () => {
      const ctx = wikiAdapter.buildGroundingContext({
        patchDiffs: [
          {
            prNumber: 123,
            prTitle: "Add auth endpoint",
            patch: "@@ -1,3 +1,5 @@\n+export function auth() {\n+  return true;\n+}",
          },
        ],
        wikiPageContent: "= Authentication =\nThis page describes auth.",
        wikiPageTitle: "Authentication",
      });
      expect(ctx.providedContext.some((c) => c.includes("PR #123"))).toBe(true);
      expect(ctx.providedContext.some((c) => c.includes("auth()"))).toBe(true);
      expect(ctx.providedContext).toContain(
        "= Authentication =\nThis page describes auth.",
      );
      expect(ctx.contextSources).toContain("pr-patches");
      expect(ctx.contextSources).toContain("wiki-page");
    });

    it("includes multiple patches", () => {
      const ctx = wikiAdapter.buildGroundingContext({
        patchDiffs: [
          { prNumber: 1, prTitle: "First", patch: "+line1" },
          { prNumber: 2, prTitle: "Second", patch: "+line2" },
        ],
        wikiPageContent: "Page content",
        wikiPageTitle: "Page",
      });
      expect(ctx.providedContext.filter((c) => c.includes("PR #")).length).toBe(2);
    });
  });

  describe("reconstructOutput", () => {
    it("preserves {{template}} markers always", () => {
      const output =
        "This is a suggestion. {{TEMPLATE_MARKER}} should stay. Removed claim here.";
      const kept = ["This is a suggestion."];
      const result = wikiAdapter.reconstructOutput(output, kept);
      expect(result).toContain("This is a suggestion.");
      expect(result).toContain("{{TEMPLATE_MARKER}} should stay.");
      expect(result).not.toContain("Removed claim here.");
    });

    it("preserves heading structure", () => {
      const output = "== Section ==\n\nKept content here.\n\n== Empty Section ==\n\nRemoved.";
      const kept = ["Kept content here."];
      const result = wikiAdapter.reconstructOutput(output, kept);
      expect(result).toContain("== Section ==");
      expect(result).toContain("Kept content here.");
    });

    it("returns empty string when no claims kept and no templates", () => {
      expect(wikiAdapter.reconstructOutput("Some text.", [])).toBe("");
    });

    it("keeps template-containing sentences even when not in keptClaims", () => {
      const output = "Normal sentence. Contains {{infobox}} template data.";
      const kept: string[] = [];
      const result = wikiAdapter.reconstructOutput(output, kept);
      expect(result).toContain("{{infobox}}");
    });
  });
});
