import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  parseVoiceValidation,
  VOICE_MATCH_THRESHOLD,
  validateVoiceMatch,
  generateWithVoicePreservation,
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
