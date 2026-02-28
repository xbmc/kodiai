import { describe, it, expect } from "bun:test";
import {
  buildTroubleshootingSynthesisPrompt,
  formatTroubleshootingComment,
} from "./troubleshooting-agent.ts";
import type { TroubleshootingResult } from "../knowledge/troubleshooting-retrieval.ts";

function makeResult(overrides?: Partial<TroubleshootingResult>): TroubleshootingResult {
  return {
    matches: [
      {
        issueNumber: 100,
        title: "Crash on startup after update",
        body: "The app crashes immediately when launched after updating to v2.0.",
        tailComments: ["Fixed by reverting the config migration in commit abc123."],
        semanticComments: ["I see the same crash on macOS 14."],
        similarity: 0.82,
        totalChars: 300,
      },
      {
        issueNumber: 200,
        title: "Segfault in media scanner",
        body: "Media scanner crashes with SIGSEGV when scanning large libraries.",
        tailComments: [],
        semanticComments: [],
        similarity: 0.71,
        totalChars: 200,
      },
    ],
    wikiResults: [
      {
        chunkText: "Troubleshooting media scanning...",
        rawText: "Full wiki text about troubleshooting media scanning procedures.",
        distance: 0.3,
        pageId: 42,
        pageTitle: "Troubleshooting/Media_Scanner",
        namespace: "main",
        pageUrl: "https://kodi.wiki/view/Troubleshooting/Media_Scanner",
        sectionHeading: null,
        sectionAnchor: null,
        lastModified: null,
        languageTags: [],
      },
    ],
    source: "both",
    ...overrides,
  };
}

describe("buildTroubleshootingSynthesisPrompt", () => {
  it("includes issue title in Current Issue section", () => {
    const prompt = buildTroubleshootingSynthesisPrompt(
      makeResult(),
      "App crashes on startup",
      "After updating to v2.0 the app crashes.",
    );
    expect(prompt).toContain("## Current Issue");
    expect(prompt).toContain("Title: App crashes on startup");
  });

  it("includes match issue numbers and similarity percentages", () => {
    const prompt = buildTroubleshootingSynthesisPrompt(makeResult(), "Test", null);
    expect(prompt).toContain("Issue #100");
    expect(prompt).toContain("82% match");
    expect(prompt).toContain("Issue #200");
    expect(prompt).toContain("71% match");
  });

  it("includes tail comments as Resolution comments", () => {
    const prompt = buildTroubleshootingSynthesisPrompt(makeResult(), "Test", null);
    expect(prompt).toContain("Resolution comments:");
    expect(prompt).toContain("Fixed by reverting the config migration");
  });

  it("includes wiki page titles when present", () => {
    const prompt = buildTroubleshootingSynthesisPrompt(makeResult(), "Test", null);
    expect(prompt).toContain("## Related Wiki Pages");
    expect(prompt).toContain("### Troubleshooting/Media_Scanner");
  });

  it("includes instruction section", () => {
    const prompt = buildTroubleshootingSynthesisPrompt(makeResult(), "Test", null);
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("Do NOT invent solutions");
  });

  it("truncates long body to 1000 chars", () => {
    const longBody = "x".repeat(2000);
    const prompt = buildTroubleshootingSynthesisPrompt(makeResult(), "Test", longBody);
    // Should have at most 1000 x's in the Description line
    const descLine = prompt.split("\n").find((l) => l.startsWith("Description:"))!;
    expect(descLine.length).toBeLessThanOrEqual(1000 + "Description: ".length);
  });
});

describe("formatTroubleshootingComment", () => {
  const marker = "<!-- kodiai:troubleshoot:owner/repo:1:comment-99 -->";

  it("includes Troubleshooting Guidance header", () => {
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "Try rebooting.",
      result: makeResult(),
      marker,
    });
    expect(comment).toContain("## Troubleshooting Guidance");
  });

  it("includes citation table with issue numbers and match percentages", () => {
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "Try rebooting.",
      result: makeResult(),
      marker,
    });
    expect(comment).toContain("| #100 |");
    expect(comment).toContain("| 82% |");
    expect(comment).toContain("| #200 |");
    expect(comment).toContain("| 71% |");
  });

  it("wraps citations in details tag", () => {
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "Try rebooting.",
      result: makeResult(),
      marker,
    });
    expect(comment).toContain("<details>");
    expect(comment).toContain("<summary>Sources</summary>");
    expect(comment).toContain("</details>");
  });

  it("includes provenance disclosure quote", () => {
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "Try rebooting.",
      result: makeResult(),
      marker,
    });
    expect(comment).toContain(
      "> This guidance was synthesized from similar resolved issues.",
    );
  });

  it("includes HTML marker at end", () => {
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "Try rebooting.",
      result: makeResult(),
      marker,
    });
    expect(comment).toContain(marker);
    // Marker should be the last non-empty content
    const lines = comment.split("\n").filter((l) => l.trim() !== "");
    expect(lines[lines.length - 1]).toBe(marker);
  });

  it("handles empty matches (wiki-only result)", () => {
    const wikiOnly = makeResult({ matches: [], source: "wiki" });
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "Check the wiki.",
      result: wikiOnly,
      marker,
    });
    expect(comment).toContain("## Troubleshooting Guidance");
    expect(comment).not.toContain("| Issue |");
    expect(comment).toContain("Wiki: Troubleshooting/Media_Scanner");
    expect(comment).toContain("<details>");
  });

  it("handles empty wiki results (issues-only result)", () => {
    const issuesOnly = makeResult({ wikiResults: [], source: "issues" });
    const comment = formatTroubleshootingComment({
      synthesizedGuidance: "See resolved issues.",
      result: issuesOnly,
      marker,
    });
    expect(comment).toContain("| Issue | Title | Match |");
    expect(comment).not.toContain("Wiki:");
  });
});
