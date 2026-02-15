import { describe, test, expect } from "bun:test";
import type { MentionEvent } from "../handlers/mention-types.ts";
import { buildMentionPrompt } from "./mention-prompt.ts";

function baseMention(): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "xbmc",
    repo: "kodiai",
    issueNumber: 3,
    prNumber: 3,
    commentId: 123,
    commentBody: "@kodiai please review",
    commentAuthor: "alice",
    commentCreatedAt: "2026-02-10T00:00:00Z",
    headRef: "test",
    baseRef: "main",
    headRepoOwner: "xbmc",
    headRepoName: "kodiai",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
  };
}

describe("buildMentionPrompt", () => {
  test("includes conciseness and decision format guidance", () => {
    const prompt = buildMentionPrompt({
      mention: baseMention(),
      mentionContext: "",
      userQuestion: "Please review and approve if clean.",
      customInstructions: undefined,
    });

    expect(prompt).toContain("Concise by default");
    expect(prompt).toContain('Do NOT include sections like "What Changed"');
    expect(prompt).toContain("Decision: APPROVE | NOT APPROVED");
    expect(prompt).toContain("Issues:");
    expect(prompt).toContain("Issues: none");
    expect(prompt).toContain("path/to/file.ts");
    expect(prompt).toContain("Prefix first line with: 'Plan only:'");
    expect(prompt).toContain("Do NOT claim any edits were made");
  });

  test("default (no outputLanguage) does NOT include language instruction", () => {
    const prompt = buildMentionPrompt({
      mention: baseMention(),
      mentionContext: "",
      userQuestion: "Explain this function.",
    });
    expect(prompt).not.toContain("Write your response in");
  });

  test("outputLanguage 'en' does NOT include language instruction", () => {
    const prompt = buildMentionPrompt({
      mention: baseMention(),
      mentionContext: "",
      userQuestion: "Explain this function.",
      outputLanguage: "en",
    });
    expect(prompt).not.toContain("Write your response in");
  });

  test("outputLanguage 'ja' includes localization instruction", () => {
    const prompt = buildMentionPrompt({
      mention: baseMention(),
      mentionContext: "",
      userQuestion: "Explain this function.",
      outputLanguage: "ja",
    });
    expect(prompt).toContain("Write your response in ja");
    expect(prompt).toContain("Keep code identifiers, snippets, file paths, and technical terms in their original form.");
  });

  test("outputLanguage 'Spanish' includes localization instruction", () => {
    const prompt = buildMentionPrompt({
      mention: baseMention(),
      mentionContext: "",
      userQuestion: "Explain this function.",
      outputLanguage: "Spanish",
    });
    expect(prompt).toContain("Write your response in Spanish");
  });

  test("includes finding-specific preamble when finding context is provided", () => {
    const prompt = buildMentionPrompt({
      mention: baseMention(),
      mentionContext: "",
      userQuestion: "How do I fix this?",
      findingContext: {
        severity: "major",
        category: "correctness",
        filePath: "src/handler.ts",
        startLine: 42,
        title: "Handle null check",
      },
    });

    expect(prompt).toContain("This is a follow-up to a review finding:");
    expect(prompt).toContain("- Finding: [MAJOR] correctness");
    expect(prompt).toContain("- File: src/handler.ts (line 42)");
    expect(prompt).toContain("- Title: Handle null check");
  });
});
