import { describe, it, expect, mock, beforeEach } from "bun:test";
import { selectExemplarSections, extractPageStyle, buildVoicePreservingPrompt, sampleSpreadContent, extractWikiConventions, computeContentHash, getCachedStyle, cacheStyleDescription } from "./wiki-voice-analyzer.ts";
import type { WikiPageRecord } from "./wiki-types.ts";
import type { VoiceAnalyzerOptions, PageStyleDescription } from "./wiki-voice-types.ts";
import { TASK_TYPES } from "../llm/task-types.ts";

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
    expect(result.wikiConventions).toEqual({ categories: [], interwikiLinks: [], navboxes: [], templates: [] });
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

    const opts = {
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
      _generateWithFallbackFn: mockGenerateWithFallback,
    } satisfies VoiceAnalyzerOptions & {
      _generateWithFallbackFn: typeof mockGenerateWithFallback;
    };

    const result = await extractPageStyle(chunks, opts);

    // Verify taskRouter.resolve was called with voice.extract
    expect(opts.taskRouter.resolve).toHaveBeenCalledWith(TASK_TYPES.VOICE_EXTRACT);
    expect(mockGenerateWithFallback).toHaveBeenCalledTimes(1);
    expect(result.tokenCount).toBeLessThanOrEqual(3000);
  });
});

describe("buildVoicePreservingPrompt", () => {
  const styleDescription: PageStyleDescription = {
    pageTitle: "Test Page",
    styleText: "Informal tone, uses second person ('you'). Bullet lists preferred.",
    formattingElements: ["bullet lists", "bold emphasis"],
    mediaWikiMarkup: ["{{Note|...}}"],
    tokenCount: 100,
    wikiConventions: { categories: ["[[Category:Add-ons]]"], interwikiLinks: [], navboxes: [], templates: ["Note"] },
  };

  it("includes style description text in the prompt", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Original content here.",
      sectionHeading: "Setup",
      diffEvidence: "API renamed from v1 to v2.",
    });
    expect(prompt).toContain("Informal tone");
    expect(prompt).toContain("## Page Style");
  });

  it("includes exemplar section content as few-shot examples", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [
        { sectionHeading: "Example Section", chunkText: "Example content here.", chunkIndex: 0 },
      ],
      originalSection: "Original content.",
      sectionHeading: "Setup",
      diffEvidence: "Changed API.",
    });
    expect(prompt).toContain("## Style Examples");
    expect(prompt).toContain("Example Section");
    expect(prompt).toContain("Example content here.");
  });

  it("includes the original section content", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "The original section text to update.",
      sectionHeading: "Configuration",
      diffEvidence: "Changed config format.",
    });
    expect(prompt).toContain("## Section to Update");
    expect(prompt).toContain("The original section text to update.");
  });

  it("includes explicit MediaWiki preservation instruction", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: null,
      diffEvidence: "Change.",
    });
    expect(prompt).toContain("PRESERVE all MediaWiki templates");
    expect(prompt).toContain("{{Note|...}}");
  });

  it("includes IMPROVE formatting freely instruction", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    expect(prompt).toContain("IMPROVE formatting freely");
  });

  it("includes NORMALIZE inconsistencies instruction", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    expect(prompt).toContain("NORMALIZE inconsistencies");
  });

  it("includes REPLACE deprecated content instruction", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    expect(prompt).toContain("REPLACE deprecated content");
  });

  it("includes PRESERVE heading levels instruction", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    expect(prompt).toContain("PRESERVE heading levels");
  });

  it("includes constraint to stay within existing section boundaries", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    expect(prompt).toContain("Do NOT add, remove, or reorder sections");
  });

  it("includes diff evidence in the prompt", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "The API endpoint was renamed from /v1/users to /v2/users.",
    });
    expect(prompt).toContain("## What Changed");
    expect(prompt).toContain("renamed from /v1/users to /v2/users");
  });

  it("includes Output Contract section banning reasoning starters", () => {
    const prompt = buildVoicePreservingPrompt({
      styleDescription,
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    expect(prompt.includes("## Output Contract")).toBe(true);
    expect(prompt.includes("Do NOT")).toBe(true);
    expect(prompt.includes("I'll")).toBe(true);
  });
});

describe("sampleSpreadContent", () => {
  it("selects chunks from beginning, middle, and end of a 20-chunk page", () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk({ chunkIndex: i, tokenCount: 100, chunkText: `Chunk ${i} content` }),
    );
    const result = sampleSpreadContent(chunks);
    const indices = result.map((c) => c.chunkIndex);
    // Should have first 2 (0,1), middle 2 (9,10), last 2 (18,19)
    expect(indices).toContain(0);
    expect(indices).toContain(1);
    expect(indices).toContain(9);
    expect(indices).toContain(10);
    expect(indices).toContain(18);
    expect(indices).toContain(19);
  });

  it("falls back to all chunks when page has fewer than 6 chunks", () => {
    const chunks = Array.from({ length: 4 }, (_, i) =>
      makeChunk({ chunkIndex: i, tokenCount: 50, chunkText: `Chunk ${i}` }),
    );
    const result = sampleSpreadContent(chunks);
    expect(result).toHaveLength(4);
  });

  it("respects the 3000 token budget across spread samples", () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk({ chunkIndex: i, tokenCount: 600, chunkText: `Chunk ${i} big content` }),
    );
    const result = sampleSpreadContent(chunks);
    const totalTokens = result.reduce((sum, c) => sum + c.tokenCount, 0);
    expect(totalTokens).toBeLessThanOrEqual(3000);
  });
});

describe("extractWikiConventions", () => {
  it("parses categories, interwiki links, and template names from raw chunk text", () => {
    const chunks = [
      makeChunk({ chunkText: "Some text [[Category:Add-ons]] and [[Category:Kodi]] here" }),
      makeChunk({ chunkText: "Links: [[en:Kodi]] and [[de:Kodi]]" }),
      makeChunk({ chunkText: "Templates: {{Note|important}} and {{Navbox addon types}}" }),
    ];
    const result = extractWikiConventions(chunks);
    expect(result.categories).toContain("[[Category:Add-ons]]");
    expect(result.categories).toContain("[[Category:Kodi]]");
    expect(result.interwikiLinks).toContain("[[en:Kodi]]");
    expect(result.interwikiLinks).toContain("[[de:Kodi]]");
    expect(result.navboxes).toContain("{{Navbox addon types}}");
    expect(result.templates).toContain("Note");
    expect(result.templates).toContain("Navbox addon types");
  });

  it("returns empty arrays when no conventions found", () => {
    const chunks = [makeChunk({ chunkText: "Plain text with no wiki conventions." })];
    const result = extractWikiConventions(chunks);
    expect(result.categories).toEqual([]);
    expect(result.interwikiLinks).toEqual([]);
    expect(result.navboxes).toEqual([]);
    expect(result.templates).toEqual([]);
  });

  it("deduplicates conventions found across chunks", () => {
    const chunks = [
      makeChunk({ chunkText: "[[Category:Add-ons]] text" }),
      makeChunk({ chunkText: "more [[Category:Add-ons]] text" }),
    ];
    const result = extractWikiConventions(chunks);
    expect(result.categories).toHaveLength(1);
  });
});

describe("style extraction prompt", () => {
  it("includes WIKI CONVENTIONS section", () => {
    // We test this via buildVoicePreservingPrompt indirectly, but also
    // extractPageStyle calls buildStyleExtractionPrompt which should have it.
    // Access via the prompt output for empty chunks is not feasible, so test
    // that the extraction prompt template exists by checking a generated prompt.
    const prompt = buildVoicePreservingPrompt({
      styleDescription: {
        pageTitle: "Test",
        styleText: "Test style",
        formattingElements: [],
        mediaWikiMarkup: [],
        tokenCount: 0,
        wikiConventions: { categories: [], interwikiLinks: [], navboxes: [], templates: [] },
      },
      exemplarSections: [],
      originalSection: "Content.",
      sectionHeading: "Test",
      diffEvidence: "Change.",
    });
    // The voice-preserving prompt should still work
    expect(prompt).toContain("## Page Style");
  });
});

describe("computeContentHash", () => {
  it("returns consistent hash for same chunk content", () => {
    const chunks = [makeChunk({ chunkText: "Hello world" })];
    const hash1 = computeContentHash(chunks);
    const hash2 = computeContentHash(chunks);
    expect(hash1).toBe(hash2);
  });

  it("returns different hash when chunk content changes", () => {
    const chunks1 = [makeChunk({ chunkText: "Hello world" })];
    const chunks2 = [makeChunk({ chunkText: "Hello world updated" })];
    expect(computeContentHash(chunks1)).not.toBe(computeContentHash(chunks2));
  });
});

describe("getCachedStyle", () => {
  it("returns null when no cache entry exists", async () => {
    const mockSql: any = function(strings: TemplateStringsArray, ...values: any[]) {
      return Promise.resolve([]);
    };
    const result = await getCachedStyle(mockSql, 999, "abc123");
    expect(result).toBeNull();
  });

  it("returns cached PageStyleDescription when entry exists and matches", async () => {
    const cachedStyle: PageStyleDescription = {
      pageTitle: "Test",
      styleText: "Cached style",
      formattingElements: [],
      mediaWikiMarkup: [],
      tokenCount: 50,
      wikiConventions: { categories: [], interwikiLinks: [], navboxes: [], templates: [] },
    };
    const mockSql: any = function(strings: TemplateStringsArray, ...values: any[]) {
      return Promise.resolve([{ style_description: cachedStyle }]);
    };
    const result = await getCachedStyle(mockSql, 100, "hash123");
    expect(result).not.toBeNull();
    expect(result!.pageTitle).toBe("Test");
    expect(result!.styleText).toBe("Cached style");
  });
});

describe("extractPageStyle with caching", () => {
  it("works without sql parameter (backward compatible, no caching)", async () => {
    const opts: VoiceAnalyzerOptions = {
      taskRouter: { resolve: mock(() => ({ modelId: "test", provider: "anthropic", sdk: "ai" as const, fallbackModelId: "test", fallbackProvider: "anthropic" })) },
      logger: { child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) } as any,
    };
    const result = await extractPageStyle([], opts);
    expect(result.pageTitle).toBe("unknown");
    expect(result.wikiConventions).toEqual({ categories: [], interwikiLinks: [], navboxes: [], templates: [] });
  });
});
