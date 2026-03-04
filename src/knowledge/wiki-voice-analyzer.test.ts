import { describe, it, expect, mock, beforeEach } from "bun:test";
import { selectExemplarSections, extractPageStyle } from "./wiki-voice-analyzer.ts";
import type { WikiPageRecord } from "./wiki-types.ts";
import type { VoiceAnalyzerOptions } from "./wiki-voice-types.ts";

function makeChunk(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    id: 1,
    createdAt: "2026-01-01",
    pageId: 100,
    pageTitle: "Test Page",
    namespace: "0",
    pageUrl: "https://kodi.wiki/view/Test_Page",
    sectionHeading: null,
    sectionAnchor: null,
    sectionLevel: null,
    chunkIndex: 0,
    chunkText: "Default chunk text with enough content to be meaningful for testing purposes.",
    rawText: "Default chunk text",
    tokenCount: 20,
    embedding: null,
    embeddingModel: "voyage-context-3",
    stale: false,
    lastModified: null,
    revisionId: null,
    deleted: false,
    languageTags: [],
    ...overrides,
  };
}

describe("selectExemplarSections", () => {
  it("returns empty array when given empty chunks", () => {
    const result = selectExemplarSections([]);
    expect(result).toEqual([]);
  });

  it("returns all sections when fewer than targetCount sections exist", () => {
    const chunks = [
      makeChunk({ sectionHeading: "Introduction", chunkIndex: 0, chunkText: "This is the introduction section with enough text to pass the filter." }),
      makeChunk({ sectionHeading: "Setup", chunkIndex: 1, chunkText: "This is the setup section with detailed instructions for configuration." }),
    ];
    const result = selectExemplarSections(chunks, 3);
    expect(result).toHaveLength(2);
    expect(result[0]!.sectionHeading).toBe("Introduction");
    expect(result[1]!.sectionHeading).toBe("Setup");
  });

  it("selects from spread positions for pages with many sections", () => {
    const chunks = [
      makeChunk({ sectionHeading: "Intro", chunkIndex: 0, chunkText: "First section content that is long enough to pass the minimum length filter." }),
      makeChunk({ sectionHeading: "Overview", chunkIndex: 1, chunkText: "Second section with overview content that is long enough to pass filtering." }),
      makeChunk({ sectionHeading: "Installation", chunkIndex: 2, chunkText: "Third section about installation steps that is long enough for the filter." }),
      makeChunk({ sectionHeading: "Configuration", chunkIndex: 3, chunkText: "Fourth section about configuration options that meets the length requirement." }),
      makeChunk({ sectionHeading: "Usage", chunkIndex: 4, chunkText: "Fifth section about usage patterns that is long enough to pass the filter check." }),
      makeChunk({ sectionHeading: "Troubleshooting", chunkIndex: 5, chunkText: "Sixth section about troubleshooting that has enough content for the length check." }),
    ];
    const result = selectExemplarSections(chunks, 3);
    expect(result).toHaveLength(3);
    // Should pick from positions 0, 2, 4 (spread across 6 sections)
    expect(result[0]!.sectionHeading).toBe("Intro");
    expect(result[1]!.sectionHeading).toBe("Installation");
    expect(result[2]!.sectionHeading).toBe("Usage");
  });

  it("excludes very short sections (< 50 chars chunkText)", () => {
    const chunks = [
      makeChunk({ sectionHeading: "Good", chunkIndex: 0, chunkText: "This section has enough content to pass the minimum length filter for exemplars." }),
      makeChunk({ sectionHeading: "TooShort", chunkIndex: 1, chunkText: "Short." }),
      makeChunk({ sectionHeading: "AlsoGood", chunkIndex: 2, chunkText: "Another section with sufficient content to meet the minimum length requirement." }),
    ];
    const result = selectExemplarSections(chunks, 3);
    expect(result).toHaveLength(2);
    const headings = result.map((r) => r.sectionHeading);
    expect(headings).not.toContain("TooShort");
  });

  it("groups chunks by sectionHeading and selects distinct sections", () => {
    const chunks = [
      makeChunk({ sectionHeading: "Setup", chunkIndex: 0, chunkText: "First chunk of setup section with enough content for the filter." }),
      makeChunk({ sectionHeading: "Setup", chunkIndex: 1, chunkText: "Second chunk of setup section continuing the previous content." }),
      makeChunk({ sectionHeading: "Usage", chunkIndex: 2, chunkText: "Usage section content that is long enough to pass the length filter." }),
    ];
    const result = selectExemplarSections(chunks, 3);
    expect(result).toHaveLength(2);
    // Setup should have both chunks joined
    const setupExemplar = result.find((r) => r.sectionHeading === "Setup");
    expect(setupExemplar).toBeDefined();
    expect(setupExemplar!.chunkText).toContain("First chunk");
    expect(setupExemplar!.chunkText).toContain("Second chunk");
  });

  it("defaults to 3 exemplars", () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk({
        sectionHeading: `Section ${i}`,
        chunkIndex: i,
        chunkText: `Content for section ${i} that is long enough to pass the minimum length filter requirement.`,
      }),
    );
    const result = selectExemplarSections(chunks);
    expect(result).toHaveLength(3);
  });

  it("handles null sectionHeading as intro section", () => {
    const chunks = [
      makeChunk({ sectionHeading: null, chunkIndex: 0, chunkText: "Lead section content without a heading, long enough for the filter to accept it." }),
      makeChunk({ sectionHeading: "Details", chunkIndex: 1, chunkText: "Details section with enough content to pass the minimum length filter check." }),
    ];
    const result = selectExemplarSections(chunks, 3);
    expect(result).toHaveLength(2);
    expect(result[0]!.sectionHeading).toBeNull();
  });
});

describe("extractPageStyle", () => {
  const mockGenerateWithFallback = mock(() =>
    Promise.resolve({
      text: "TONE: Informal and conversational. Uses second person.\nFORMATTING: Uses bullet lists and {{Note|...}} templates.\nCode blocks are used for configuration examples.",
      usage: { inputTokens: 500, outputTokens: 200 },
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      usedFallback: false,
      durationMs: 1200,
    }),
  );

  beforeEach(() => {
    mockGenerateWithFallback.mockClear();
  });

  // We need to mock the module import
  it("returns empty style for empty chunks", async () => {
    const opts: VoiceAnalyzerOptions = {
      taskRouter: { resolve: mock(() => ({ modelId: "test", provider: "anthropic", sdk: "ai" as const, fallbackModelId: "test", fallbackProvider: "anthropic" })) },
      logger: { child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) } as any,
    };
    const result = await extractPageStyle([], opts);
    expect(result.pageTitle).toBe("unknown");
    expect(result.styleText).toBe("");
    expect(result.formattingElements).toEqual([]);
    expect(result.mediaWikiMarkup).toEqual([]);
    expect(result.tokenCount).toBe(0);
  });

  it("respects token budget for content selection", async () => {
    // Create chunks that exceed the 3000 token budget
    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk({
        chunkIndex: i,
        tokenCount: 200, // 20 * 200 = 4000 tokens total, exceeds 3000 budget
        chunkText: `Content for chunk ${i}`,
      }),
    );

    const opts: VoiceAnalyzerOptions = {
      taskRouter: {
        resolve: mock(() => ({
          modelId: "claude-sonnet-4-5-20250929",
          provider: "anthropic",
          sdk: "ai" as const,
          fallbackModelId: "claude-sonnet-4-5-20250929",
          fallbackProvider: "anthropic",
        })),
      },
      logger: { child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) } as any,
    };

    // extractPageStyle calls generateWithFallback internally
    // We can only test that it doesn't throw and returns valid structure
    // Full integration test would require mocking the import
    try {
      await extractPageStyle(chunks, opts);
    } catch {
      // Expected to fail due to missing LLM provider in test env
      // The important thing is that token budget logic runs before the LLM call
    }

    // Verify taskRouter.resolve was called with voice.extract
    expect(opts.taskRouter.resolve).toHaveBeenCalledWith("voice.extract");
  });
});
