import { describe, expect, test } from "bun:test";
import { resolveMentionRequestContext } from "./mention-request-context.ts";

describe("resolveMentionRequestContext", () => {
  test("returns accepted handles, stripped question, and formatter request for accepted mentions", () => {
    const result = resolveMentionRequestContext({
      appSlug: "kodiai",
      acceptClaudeAlias: true,
      commentBody: "@claude review and format suggestions please",
    });

    expect(result).toMatchObject({
      action: "continue",
      acceptedHandles: ["@kodiai", "@kodai", "@claude"],
      userQuestion: "review and format suggestions please",
      formatterSuggestionRequest: {
        requested: true,
        mode: "review-and-format",
        source: "explicit-mention",
        normalizedRequest: "review and format suggestions please",
      },
    });
  });

  test("skips when the comment does not match configured handles", () => {
    const result = resolveMentionRequestContext({
      appSlug: "kodiai",
      acceptClaudeAlias: false,
      commentBody: "@claude review this",
    });

    expect(result).toEqual({
      action: "skip",
      reason: "handle-mismatch",
      acceptedHandles: ["@kodiai", "@kodai"],
    });
  });

  test("skips when the mention contains no question after stripping handles", () => {
    const result = resolveMentionRequestContext({
      appSlug: "kodiai",
      acceptClaudeAlias: true,
      commentBody: "@kodiai @claude",
    });

    expect(result).toEqual({
      action: "skip",
      reason: "empty-question",
      acceptedHandles: ["@kodiai", "@kodai", "@claude"],
    });
  });
});
