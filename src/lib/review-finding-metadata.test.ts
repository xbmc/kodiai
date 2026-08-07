import { describe, expect, it } from "bun:test";
import { parseInlineCommentMetadata } from "./review-finding-metadata.ts";

describe("parseInlineCommentMetadata", () => {
  it("extracts the prose body after the title from a yaml-metadata comment", () => {
    const body = [
      "```yaml",
      "severity: critical",
      "category: correctness",
      "```",
      "**Race condition in job cleanup**",
      "",
      "`m_streaminfo` is assigned without holding the section lock, so a",
      "concurrent reader can observe a torn value.",
      "",
      "<!-- kodiai:inline-output-key:abc123 -->",
    ].join("\n");

    const parsed = parseInlineCommentMetadata(body);

    expect(parsed.severity).toBe("critical");
    expect(parsed.category).toBe("correctness");
    expect(parsed.title).toBe("Race condition in job cleanup");
    expect(parsed.reasoning).toContain("without holding the section lock");
    expect(parsed.reasoning).toContain("torn value");
    // Bookkeeping comments must never leak into the fact-checked text.
    expect(parsed.reasoning).not.toContain("inline-output-key");
  });

  it("extracts the prose body from a [severity] prefixed comment", () => {
    const body = [
      "[MAJOR] Retry settlement drops the review",
      "",
      "The quiet-settlement branch returns published: false without checking",
      "whether anything was ever posted to the PR.",
    ].join("\n");

    const parsed = parseInlineCommentMetadata(body);

    expect(parsed.severity).toBe("major");
    expect(parsed.title).toBe("Retry settlement drops the review");
    expect(parsed.reasoning).toContain("without checking");
  });

  it("returns empty reasoning for a bare title with no prose body", () => {
    expect(parseInlineCommentMetadata("[MINOR] Typo in comment").reasoning).toBe("");
    expect(parseInlineCommentMetadata("").reasoning).toBe("");
  });

  it("strips the review-output-key marker from the reasoning", () => {
    const body = [
      "[CRITICAL] Unbounded fan-out",
      "",
      "Every finding spawns an LLM call with no cap.",
      "",
      "<!-- kodiai:review-output-key:kodiai-review-output:v1:inst-1:o/r:pr-1:head-abc -->",
    ].join("\n");

    const parsed = parseInlineCommentMetadata(body);

    expect(parsed.reasoning).toBe("Every finding spawns an LLM call with no cap.");
  });
});
