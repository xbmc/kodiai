import { describe, expect, test } from "bun:test";
import { detectFormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";

describe("detectFormatterSuggestionRequest", () => {
  test.each([
    "format suggestions",
    "formatting suggestions",
    "suggest formatting fixes",
    "suggest formatting changes",
  ])("detects format-only phrase '%s'", (phrase) => {
    expect(detectFormatterSuggestionRequest(phrase)).toEqual({
      requested: true,
      mode: "format-only",
      source: "explicit-mention",
      normalizedRequest: phrase,
    });
  });

  test.each([
    "review & format suggestions",
    "review and format suggestions",
    "review + format suggestions",
    "review with format suggestions",
  ])("detects combined review-and-format phrase '%s'", (phrase) => {
    expect(detectFormatterSuggestionRequest(phrase)).toEqual({
      requested: true,
      mode: "review-and-format",
      source: "explicit-mention",
      normalizedRequest: phrase,
    });
  });

  test.each([
    "please review & format suggestions",
    "please review and format suggestions",
    "can you please review + format suggestions",
    "can you please review with format suggestions",
  ])("keeps polite combined phrase '%s' in review-and-format mode", (phrase) => {
    expect(detectFormatterSuggestionRequest(phrase)).toEqual({
      requested: true,
      mode: "review-and-format",
      source: "explicit-mention",
      normalizedRequest: phrase,
    });
  });

  test.each([
    "",
    "   \t\n  ",
    "review this PR",
    "please do a full review",
    "format this PR",
    "please format this PR",
    "can you please format this PR",
  ])("does not detect non-suggestion wording '%s'", (phrase) => {
    expect(detectFormatterSuggestionRequest(phrase)).toBeUndefined();
  });

  test("normalizes surrounding whitespace, punctuation, and case", () => {
    expect(detectFormatterSuggestionRequest("  PLEASE   REVIEW & FORMAT   SUGGESTIONS! ")).toEqual({
      requested: true,
      mode: "review-and-format",
      source: "explicit-mention",
      normalizedRequest: "please review & format suggestions",
    });
  });
});
