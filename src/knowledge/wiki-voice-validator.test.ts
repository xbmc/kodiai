import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  parseVoiceValidation,
  VOICE_MATCH_THRESHOLD,
  validateVoiceMatch,
  generateWithVoicePreservation,
  checkTemplatePreservation,
  checkHeadingLevels,
  checkFormattingNovelty,
  checkSectionLength,
} from "./wiki-voice-validator.ts";
import type { PageStyleDescription, VoiceAnalyzerOptions } from "./wiki-voice-types.ts";

describe("VOICE_MATCH_THRESHOLD", () => {
  it("is 3.5", () => {
    expect(VOICE_MATCH_THRESHOLD).toBe(3.5);
  });
});

describe("parseVoiceValidation", () => {
  it("extracts all 6 dimension scores from well-formed PASS response", () => {
    const text = `TONE_MATCH: 4
PERSPECTIVE_MATCH: 5
STRUCTURE_MATCH: 4
TERMINOLOGY_MATCH: 4
FORMATTING_MATCH: 5
MARKUP_PRESERVATION: 4
OVERALL: PASS
FEEDBACK: Minor style differences but within acceptable range.`;

    const result = parseVoiceValidation(text);
    expect(result.scores.toneMatch).toBe(4);
    expect(result.scores.perspectiveMatch).toBe(5);
    expect(result.scores.structureMatch).toBe(4);
    expect(result.scores.terminologyMatch).toBe(4);
    expect(result.scores.formattingMatch).toBe(5);
    expect(result.scores.markupPreservation).toBe(4);
    expect(result.overallScore).toBeCloseTo(4.333, 2);
    expect(result.passed).toBe(true);
    expect(result.feedback).toBeNull(); // null when passed
  });

  it("returns passed=false when average score < 3.5", () => {
    const text = `TONE_MATCH: 2
PERSPECTIVE_MATCH: 3
STRUCTURE_MATCH: 2
TERMINOLOGY_MATCH: 3
FORMATTING_MATCH: 2
MARKUP_PRESERVATION: 1
OVERALL: FAIL
FEEDBACK: Tone is too formal, uses passive voice instead of imperative.`;

    const result = parseVoiceValidation(text);
    expect(result.passed).toBe(false);
    expect(result.overallScore).toBeLessThan(3.5);
    expect(result.feedback).toBe(
      "Tone is too formal, uses passive voice instead of imperative.",
    );
  });

  it("extracts FEEDBACK text after FEEDBACK: line", () => {
    const text = `TONE_MATCH: 2
PERSPECTIVE_MATCH: 2
STRUCTURE_MATCH: 2
TERMINOLOGY_MATCH: 2
FORMATTING_MATCH: 2
MARKUP_PRESERVATION: 2
OVERALL: FAIL
FEEDBACK: The generated text uses markdown formatting instead of MediaWiki templates.`;

    const result = parseVoiceValidation(text);
    expect(result.feedback).toBe(
      "The generated text uses markdown formatting instead of MediaWiki templates.",
    );
  });

  it("handles malformed LLM responses gracefully", () => {
    const text = "This response doesn't contain any scores at all.";
    const result = parseVoiceValidation(text);
    expect(result.passed).toBe(false);
    expect(result.overallScore).toBe(0);
    expect(result.feedback).toBe(
      "Voice validation response could not be parsed",
    );
    expect(result.scores.toneMatch).toBe(0);
    expect(result.scores.perspectiveMatch).toBe(0);
  });

  it("handles partial scores (some present, some missing)", () => {
    const text = `TONE_MATCH: 4
PERSPECTIVE_MATCH: 5
OVERALL: PASS`;

    const result = parseVoiceValidation(text);
    // Only 2 of 6 have non-zero values, average = (4+5+0+0+0+0)/6 = 1.5
    expect(result.scores.toneMatch).toBe(4);
    expect(result.scores.perspectiveMatch).toBe(5);
    expect(result.scores.structureMatch).toBe(0);
    expect(result.overallScore).toBeCloseTo(1.5, 1);
    expect(result.passed).toBe(false); // 1.5 < 3.5
  });
});

describe("validateVoiceMatch", () => {
  it("calls generateWithFallback with voice.validate task type", async () => {
    // We test that the function calls taskRouter.resolve with the correct type
    const mockResolve = mock(() => ({
      modelId: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      sdk: "ai" as const,
      fallbackModelId: "claude-sonnet-4-5-20250929",
      fallbackProvider: "anthropic",
    }));

    const styleDescription: PageStyleDescription = {
      pageTitle: "Test Page",
      styleText: "Informal tone, uses second person.",
      formattingElements: ["bullet lists"],
      mediaWikiMarkup: [],
      tokenCount: 100,
      wikiConventions: { categories: [], interwikiLinks: [], navboxes: [], templates: [] },
    };

    const opts = {
      originalSection: "Original content here.",
      generatedSuggestion: "Updated content here.",
      styleDescription,
      taskRouter: { resolve: mockResolve },
      logger: {
        child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
      } as any,
    };

    try {
      await validateVoiceMatch(opts);
    } catch {
      // Expected: generateWithFallback fails without real LLM provider
    }

    expect(mockResolve).toHaveBeenCalledWith("voice.validate");
  });
});

describe("generateWithVoicePreservation", () => {
  function makeOpts(): VoiceAnalyzerOptions {
    return {
      taskRouter: {
        resolve: mock(() => ({
          modelId: "test",
          provider: "anthropic",
          sdk: "ai" as const,
          fallbackModelId: "test",
          fallbackProvider: "anthropic",
        })),
      },
      logger: {
        child: () => ({
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        }),
      } as any,
    };
  }

  const styleDescription: PageStyleDescription = {
    pageTitle: "Test Page",
    styleText: "Informal tone.",
    formattingElements: [],
    mediaWikiMarkup: [],
    tokenCount: 50,
    wikiConventions: { categories: [], interwikiLinks: [], navboxes: [], templates: [] },
  };

  // Note: Full integration tests of generateWithVoicePreservation require
  // mocking generateWithFallback at the module level, which is complex in bun:test.
  // These tests verify the function signature and error handling.

  it("calls generateFn to produce initial suggestion", async () => {
    const generateFn = mock(async () => "Generated suggestion text");
    const buildPromptWithFeedback = mock(async (feedback: string) =>
      `Regenerated with feedback: ${feedback}`,
    );

    try {
      await generateWithVoicePreservation({
        generateFn,
        originalSection: "Original content",
        styleDescription,
        buildPromptWithFeedback,
        ...makeOpts(),
      });
    } catch {
      // Expected: validateVoiceMatch calls generateWithFallback which needs real LLM
    }

    // generateFn should have been called
    expect(generateFn).toHaveBeenCalled();
  });
});

describe("checkTemplatePreservation", () => {
  it("returns passed=true when all templates are preserved", () => {
    const original = "Use {{Note|This is important}} and {{Warning|Be careful}}.";
    const suggestion = "Use {{Note|Updated text}} and {{Warning|Be more careful}}.";
    const result = checkTemplatePreservation(original, suggestion);
    expect(result.passed).toBe(true);
    expect(result.missingTemplates).toEqual([]);
  });

  it("returns passed=false with missing templates listed", () => {
    const original = "Use {{Note|This is important}} and {{Warning|Be careful}}.";
    const suggestion = "Use {{Note|Updated text}} but warning was removed.";
    const result = checkTemplatePreservation(original, suggestion);
    expect(result.passed).toBe(false);
    expect(result.missingTemplates).toContain("{{Warning}}");
  });

  it("ignores template parameter differences", () => {
    const original = "{{Note|old text with details}}";
    const suggestion = "{{Note|completely new text}}";
    const result = checkTemplatePreservation(original, suggestion);
    expect(result.passed).toBe(true);
  });

  it("handles text with no templates", () => {
    const original = "Plain text with no templates.";
    const suggestion = "Updated plain text.";
    const result = checkTemplatePreservation(original, suggestion);
    expect(result.passed).toBe(true);
    expect(result.missingTemplates).toEqual([]);
  });
});

describe("checkHeadingLevels", () => {
  it("returns passed=true when heading levels match", () => {
    const original = "== Overview ==\nContent\n=== Details ===\nMore content";
    const suggestion = "== Overview ==\nUpdated content\n=== Details ===\nUpdated more";
    const result = checkHeadingLevels(original, suggestion);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("returns passed=false when heading levels differ", () => {
    const original = "== Overview ==\nContent";
    const suggestion = "### Overview\nContent";
    const result = checkHeadingLevels(original, suggestion);
    expect(result.passed).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });

  it("handles markdown headings", () => {
    const original = "## Overview\nContent\n### Details\nMore";
    const suggestion = "## Overview\nUpdated\n### Details\nUpdated more";
    const result = checkHeadingLevels(original, suggestion);
    expect(result.passed).toBe(true);
  });
});

describe("checkFormattingNovelty", () => {
  it("detects novel code blocks when original has none", () => {
    const original = "Plain text content.";
    const suggestion = "Content with ```code blocks``` added.";
    const result = checkFormattingNovelty(original, suggestion);
    expect(result.novelElements.length).toBeGreaterThan(0);
    expect(result.novelElements.some(e => /code block/i.test(e))).toBe(true);
  });

  it("detects novel tables when original has none", () => {
    const original = "Plain text content.";
    const suggestion = "Content with\n| Column | Column |\n| --- | --- |";
    const result = checkFormattingNovelty(original, suggestion);
    expect(result.novelElements.some(e => /table/i.test(e))).toBe(true);
  });

  it("returns empty when no novel formatting is added", () => {
    const original = "Text with **bold** and ```code```.";
    const suggestion = "Updated text with **bold** and ```code```.";
    const result = checkFormattingNovelty(original, suggestion);
    expect(result.novelElements).toEqual([]);
  });
});

describe("checkSectionLength", () => {
  it("returns advisory when suggestion exceeds 150% of original", () => {
    const original = "Short content."; // 14 chars
    const suggestion = "This is a much longer version of the content that exceeds the original by more than 150%."; // >21 chars
    const result = checkSectionLength(original, suggestion);
    expect(result.advisory).not.toBeNull();
    expect(result.advisory).toContain("splitting");
  });

  it("returns null advisory when within 150%", () => {
    const original = "Some content here that is reasonable in length.";
    const suggestion = "Some updated content here that is reasonable.";
    const result = checkSectionLength(original, suggestion);
    expect(result.advisory).toBeNull();
  });
});
