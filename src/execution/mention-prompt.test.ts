import { describe, test, expect } from "bun:test";
import type { MentionEvent } from "../handlers/mention-types.ts";
import { buildMentionPrompt } from "./mention-prompt.ts";

describe("buildMentionPrompt", () => {
  test("includes conciseness and decision format guidance", () => {
    const mention: MentionEvent = {
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
    };

    const prompt = buildMentionPrompt({
      mention,
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
  });
});
