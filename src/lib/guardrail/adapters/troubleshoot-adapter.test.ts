import { describe, expect, it } from "bun:test";
import { troubleshootAdapter } from "./troubleshoot-adapter.ts";

describe("troubleshootAdapter", () => {
  it("has surface 'troubleshoot' and minContentThreshold 20", () => {
    expect(troubleshootAdapter.surface).toBe("troubleshoot");
    expect(troubleshootAdapter.minContentThreshold).toBe(20);
  });

  describe("extractClaims", () => {
    it("splits guidance text into sentences", () => {
      const claims = troubleshootAdapter.extractClaims(
        "Check the log files first. The error usually means a timeout. Try restarting the service.",
      );
      expect(claims.length).toBe(3);
    });

    it("returns empty for empty text", () => {
      expect(troubleshootAdapter.extractClaims("")).toEqual([]);
    });
  });

  describe("buildGroundingContext", () => {
    it("includes resolved issues and wiki results", () => {
      const ctx = troubleshootAdapter.buildGroundingContext({
        resolvedIssues: [
          {
            title: "Fix timeout",
            body: "Increased timeout to 30s",
            tailComments: ["Fixed in v2"],
            semanticComments: ["Similar issue with network"],
          },
        ],
        wikiResults: [
          { pageTitle: "Troubleshooting", rawText: "Check network settings" },
        ],
        issueTitle: "Service crashes",
        issueBody: "Keeps crashing on startup",
      });
      expect(ctx.providedContext).toContain("Fix timeout");
      expect(ctx.providedContext).toContain("Increased timeout to 30s");
      expect(ctx.providedContext).toContain("Fixed in v2");
      expect(ctx.providedContext).toContain("Similar issue with network");
      expect(ctx.providedContext).toContain("Check network settings");
      expect(ctx.providedContext).toContain("Service crashes");
      expect(ctx.providedContext).toContain("Keeps crashing on startup");
      expect(ctx.contextSources).toContain("resolved-issues");
      expect(ctx.contextSources).toContain("wiki");
      expect(ctx.contextSources).toContain("issue");
    });

    it("handles null issueBody", () => {
      const ctx = troubleshootAdapter.buildGroundingContext({
        resolvedIssues: [],
        wikiResults: [],
        issueTitle: "Title",
        issueBody: null,
      });
      expect(ctx.providedContext).toContain("Title");
      expect(ctx.providedContext).not.toContain(null as unknown as string);
    });
  });

  describe("reconstructOutput", () => {
    it("preserves bullet points", () => {
      const output = "Try these steps:\n- Check logs first\n- Restart the service\n- Verify config";
      const kept = ["Check logs first", "Verify config"];
      const result = troubleshootAdapter.reconstructOutput(output, kept);
      expect(result).toContain("- Check logs first");
      expect(result).toContain("- Verify config");
      expect(result).not.toContain("Restart the service");
    });

    it("preserves asterisk bullet points", () => {
      const output = "* First step here\n* Second step here";
      const kept = ["First step here"];
      const result = troubleshootAdapter.reconstructOutput(output, kept);
      expect(result).toContain("* First step here");
      expect(result).not.toContain("Second step here");
    });

    it("returns empty string when no claims kept", () => {
      expect(troubleshootAdapter.reconstructOutput("Some text.", [])).toBe("");
    });
  });
});
