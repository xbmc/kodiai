import { describe, it, expect } from "bun:test";
import {
  matchPatchesToSection,
  buildGroundedSectionPrompt,
  parseGeneratedSuggestion,
  checkGrounding,
} from "./wiki-update-generator.ts";
import type { WikiPageRecord } from "./wiki-types.ts";
import type { PREvidence } from "./wiki-staleness-types.ts";

// ── Test helpers ───────────────────────────────────────────────────────

function makeChunk(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    id: 1,
    createdAt: "2024-01-01",
    pageId: 100,
    pageTitle: "Audio Pipeline",
    namespace: "Main",
    pageUrl: "https://kodi.wiki/Audio_Pipeline",
    sectionHeading: null,
    sectionAnchor: null,
    sectionLevel: null,
    chunkIndex: 0,
    chunkText: "The audio pipeline handles playback routing.",
    rawText: "The audio pipeline handles playback routing.",
    tokenCount: 10,
    embedding: null,
    embeddingModel: null,
    stale: false,
    lastModified: null,
    revisionId: null,
    deleted: false,
    languageTags: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<PREvidence> = {}): PREvidence {
  return {
    id: 1,
    prNumber: 27901,
    prTitle: "Switch audio pipeline to PipeWire",
    prDescription: "Replace PulseAudio with PipeWire",
    prAuthor: "developer",
    mergedAt: new Date("2024-06-15"),
    filePath: "xbmc/cores/AudioEngine/Sinks/AESinkPipeWire.cpp",
    patch: "@@ -1,10 +1,15 @@\n-#include \"AESinkPulseAudio.h\"\n+#include \"AESinkPipeWire.h\"\n+\n+void CAESinkPipeWire::Initialize()\n+{\n+  // PipeWire initialization\n+}",
    issueReferences: [],
    matchedPageId: 100,
    matchedPageTitle: "Audio Pipeline",
    heuristicScore: 5,
    ...overrides,
  };
}

// ── matchPatchesToSection ──────────────────────────────────────────────

describe("matchPatchesToSection", () => {
  it("returns patches with sufficient token overlap", () => {
    const chunks = [
      makeChunk({
        chunkText: "The AudioEngine sink system routes playback through PulseAudio.",
        sectionHeading: "AudioEngine Sinks",
      }),
    ];
    const evidence = [
      makeEvidence({
        filePath: "xbmc/cores/AudioEngine/Sinks/AESinkPipeWire.cpp",
        patch: "Replace PulseAudio sink with PipeWire for audioengine",
        heuristicScore: 5,
      }),
    ];

    const result = matchPatchesToSection(chunks, evidence);
    expect(result.matchingPatches.length).toBe(1);
    expect(result.overlapScore).toBeGreaterThanOrEqual(2);
  });

  it("excludes patches with only domain stopword overlap", () => {
    const chunks = [
      makeChunk({
        chunkText: "The player video kodi addon system.",
        sectionHeading: "Player Overview",
      }),
    ];
    const evidence = [
      makeEvidence({
        // Only overlapping tokens are stopwords: "player", "video", "kodi"
        filePath: "src/player/video/kodi.ts",
        patch: "player video kodi changes",
        heuristicScore: 3,
      }),
    ];

    const result = matchPatchesToSection(chunks, evidence);
    expect(result.matchingPatches.length).toBe(0);
  });

  it("excludes patches with < 2 non-stopword token overlap", () => {
    const chunks = [
      makeChunk({
        chunkText: "Configuration settings for the system.",
        sectionHeading: "Configuration",
      }),
    ];
    const evidence = [
      makeEvidence({
        // Only "configuration" overlaps (1 token, below MIN_OVERLAP_SCORE=2)
        filePath: "src/other/something.ts",
        patch: "configuration changes here",
        heuristicScore: 1,
      }),
    ];

    const result = matchPatchesToSection(chunks, evidence);
    // "configuration" appears in both, but score from path is 0 (no match)
    // Score from patch is 1 ("configuration") — below MIN_OVERLAP_SCORE
    expect(result.matchingPatches.length).toBe(0);
  });

  it("sorts results by heuristic_score DESC", () => {
    const chunks = [
      makeChunk({
        chunkText: "The rendering pipeline codec transformation system for output processing.",
        sectionHeading: "Rendering Pipeline",
      }),
    ];
    const evidence = [
      makeEvidence({
        prNumber: 1001,
        filePath: "src/rendering/pipeline.ts",
        patch: "rendering pipeline codec changes",
        heuristicScore: 2,
      }),
      makeEvidence({
        prNumber: 1002,
        filePath: "src/rendering/codec.ts",
        patch: "rendering pipeline transformation updates",
        heuristicScore: 8,
      }),
    ];

    const result = matchPatchesToSection(chunks, evidence);
    expect(result.matchingPatches.length).toBe(2);
    expect(result.matchingPatches[0]!.prNumber).toBe(1002); // Higher score first
  });

  it("caps at 5 patches", () => {
    const chunks = [
      makeChunk({
        chunkText: "System with rendering pipeline codec transformation output processing filtering.",
        sectionHeading: "Processing",
      }),
    ];
    const evidence = Array.from({ length: 8 }, (_, i) =>
      makeEvidence({
        id: i + 1,
        prNumber: 2000 + i,
        filePath: `src/rendering/pipeline/module${i}.ts`,
        patch: `rendering pipeline codec transformation processing changes in module ${i}`,
        heuristicScore: 10 - i,
      }),
    );

    const result = matchPatchesToSection(chunks, evidence);
    expect(result.matchingPatches.length).toBeLessThanOrEqual(5);
  });

  it("returns correct sectionContent from concatenated chunks", () => {
    const chunks = [
      makeChunk({ chunkText: "First paragraph.", chunkIndex: 0 }),
      makeChunk({ chunkText: "Second paragraph.", chunkIndex: 1 }),
    ];
    const evidence = [makeEvidence()];

    const result = matchPatchesToSection(chunks, evidence);
    expect(result.sectionContent).toBe("First paragraph.\nSecond paragraph.");
  });
});

// ── buildGroundedSectionPrompt ─────────────────────────────────────────

describe("buildGroundedSectionPrompt", () => {
  it("includes section content and patch diffs", () => {
    const prompt = buildGroundedSectionPrompt({
      sectionHeading: "Audio Pipeline",
      sectionContent: "The audio pipeline uses PulseAudio.",
      patches: [
        { prNumber: 27901, prTitle: "Switch to PipeWire", patch: "-PulseAudio\n+PipeWire" },
      ],
      githubOwner: "xbmc",
      githubRepo: "xbmc",
    });

    expect(prompt).toContain("Audio Pipeline");
    expect(prompt).toContain("uses PulseAudio");
    expect(prompt).toContain("PR #27901");
    expect(prompt).toContain("Switch to PipeWire");
    expect(prompt).toContain("-PulseAudio\n+PipeWire");
  });

  it("includes grounding rules", () => {
    const prompt = buildGroundedSectionPrompt({
      sectionHeading: null,
      sectionContent: "Some content.",
      patches: [{ prNumber: 123, prTitle: "Test PR", patch: "diff" }],
      githubOwner: "xbmc",
      githubRepo: "xbmc",
    });

    expect(prompt).toContain("MUST cite the specific PR");
    expect(prompt).toContain("cannot be grounded");
    expect(prompt).toContain("NO_UPDATE");
  });

  it("includes WHY instruction", () => {
    const prompt = buildGroundedSectionPrompt({
      sectionHeading: "Test",
      sectionContent: "Content.",
      patches: [{ prNumber: 1, prTitle: "PR", patch: "d" }],
      githubOwner: "xbmc",
      githubRepo: "xbmc",
    });

    expect(prompt).toContain('Begin with "WHY: "');
  });

  it("uses correct GitHub URL format", () => {
    const prompt = buildGroundedSectionPrompt({
      sectionHeading: "Test",
      sectionContent: "Content.",
      patches: [{ prNumber: 1, prTitle: "PR", patch: "d" }],
      githubOwner: "xbmc",
      githubRepo: "xbmc",
    });

    expect(prompt).toContain("https://github.com/xbmc/xbmc/pull/");
  });

  it("handles null section heading as (Lead section)", () => {
    const prompt = buildGroundedSectionPrompt({
      sectionHeading: null,
      sectionContent: "Content.",
      patches: [{ prNumber: 1, prTitle: "PR", patch: "d" }],
      githubOwner: "xbmc",
      githubRepo: "xbmc",
    });

    expect(prompt).toContain("(Lead section)");
  });
});

// ── parseGeneratedSuggestion ───────────────────────────────────────────

describe("parseGeneratedSuggestion", () => {
  it("detects NO_UPDATE response", () => {
    const result = parseGeneratedSuggestion("NO_UPDATE");
    expect(result.isNoUpdate).toBe(true);
    expect(result.suggestion).toBe("");
  });

  it("detects case-insensitive NO_UPDATE", () => {
    const result = parseGeneratedSuggestion("no_update");
    expect(result.isNoUpdate).toBe(true);
  });

  it("extracts WHY summary from standard format", () => {
    const text = "WHY: The audio sink was changed from PulseAudio to PipeWire.\n\nThe audio pipeline now uses PipeWire (PR #27901).";
    const result = parseGeneratedSuggestion(text);

    expect(result.isNoUpdate).toBe(false);
    expect(result.whySummary).toBe("The audio sink was changed from PulseAudio to PipeWire.");
    expect(result.suggestion).toBe("The audio pipeline now uses PipeWire (PR #27901).");
  });

  it("handles WHY without space after colon", () => {
    const text = "WHY:Audio changed.\n\nNew content here.";
    const result = parseGeneratedSuggestion(text);

    expect(result.whySummary).toBe("Audio changed.");
    expect(result.suggestion).toBe("New content here.");
  });

  it("falls back to first sentence as summary when no WHY prefix", () => {
    const text = "The audio system was updated. The pipeline now uses PipeWire (PR #27901) for all audio routing.";
    const result = parseGeneratedSuggestion(text);

    expect(result.isNoUpdate).toBe(false);
    expect(result.whySummary).toBe("The audio system was updated.");
    expect(result.suggestion).toContain("PipeWire");
  });

  it("handles text with no sentence boundary", () => {
    const text = "Updated content without period ending";
    const result = parseGeneratedSuggestion(text);

    expect(result.isNoUpdate).toBe(false);
    expect(result.suggestion).toBe("Updated content without period ending");
  });
});

// ── checkGrounding ─────────────────────────────────────────────────────

describe("checkGrounding", () => {
  it("returns true when suggestion cites a matching PR", () => {
    const text = "The audio pipeline now uses PipeWire (PR #27901) for improved latency.";
    expect(checkGrounding(text, [27901])).toBe(true);
  });

  it("returns false when no matching PR citations", () => {
    const text = "The audio pipeline was updated for improved latency.";
    expect(checkGrounding(text, [27901])).toBe(false);
  });

  it("returns false when cited PR does not match input", () => {
    const text = "Changes from PR #99999 improved the system.";
    expect(checkGrounding(text, [27901])).toBe(false);
  });

  it("returns true with any one matching citation among multiple", () => {
    const text = "PipeWire support (PR #27901) and codec update (PR #28000).";
    expect(checkGrounding(text, [27901, 28000])).toBe(true);
  });

  it("handles PR # with different spacing", () => {
    const text = "See PR#27901 for details.";
    expect(checkGrounding(text, [27901])).toBe(true);
  });

  it("returns false for empty input PR numbers", () => {
    const text = "Some text with PR #123.";
    expect(checkGrounding(text, [])).toBe(false);
  });

  it("returns false for empty suggestion text", () => {
    expect(checkGrounding("", [27901])).toBe(false);
  });
});
