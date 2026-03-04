/**
 * Type definitions for wiki voice analysis, style extraction, and voice-preserving
 * update generation. Consumed by wiki-voice-analyzer.ts and wiki-voice-validator.ts.
 */

import type { Logger } from "pino";
import type { TaskRouter } from "../llm/task-router.ts";
import type { CostTracker } from "../llm/cost-tracker.ts";
import type { WikiPageStore } from "./wiki-types.ts";

/** Result of extracting a page's writing style via LLM analysis. */
export type PageStyleDescription = {
  /** The page this style was extracted from. */
  pageTitle: string;
  /** Full LLM-generated style description text. */
  styleText: string;
  /** Formatting elements detected (e.g., "bullet lists", "code blocks", "bold emphasis"). */
  formattingElements: string[];
  /** MediaWiki-specific markup found (e.g., "{{Note|...}}", "{{Infobox ...}}"). */
  mediaWikiMarkup: string[];
  /** Approximate token count of the content used for extraction. */
  tokenCount: number;
};

/** A representative section selected as a few-shot exemplar for voice matching. */
export type StyleExemplar = {
  /** Section heading (null for intro/lead section). */
  sectionHeading: string | null;
  /** The chunk text content. */
  chunkText: string;
  /** Chunk index within the page. */
  chunkIndex: number;
};

/** Per-dimension voice match scores (1-5 scale). */
export type VoiceMatchScores = {
  toneMatch: number;
  perspectiveMatch: number;
  structureMatch: number;
  terminologyMatch: number;
  formattingMatch: number;
  markupPreservation: number;
};

/** Result of validating a generated suggestion against the original section's voice. */
export type VoiceValidationResult = {
  /** Whether the voice match passed the threshold. */
  passed: boolean;
  /** Per-dimension scores (1-5 each). */
  scores: VoiceMatchScores;
  /** Average of all dimension scores. */
  overallScore: number;
  /** Specific feedback on what doesn't match (null if passed). */
  feedback: string | null;
};

/** Options shared by voice analysis functions. */
export type VoiceAnalyzerOptions = {
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  logger: Logger;
  repo?: string;
};

/** Options for the voice-preserving generation pipeline. */
export type VoicePreservingPipelineOptions = VoiceAnalyzerOptions & {
  /** Store for fetching page chunks. */
  wikiPageStore: WikiPageStore;
  /** Function that generates a section update from a prompt (provided by Phase 123). */
  generateSectionUpdate: (prompt: string) => Promise<string>;
};

/** A single voice-preserved section update. */
export type VoicePreservedUpdate = {
  /** Page ID the update belongs to. */
  pageId: number;
  /** Page title. */
  pageTitle: string;
  /** Section heading (null for intro/lead section). */
  sectionHeading: string | null;
  /** Original section content before update. */
  originalContent: string;
  /** Voice-preserving suggestion text. */
  suggestion: string;
  /** True if voice validation failed after retry. */
  voiceMismatchWarning: boolean;
  /** Full validation scores for internal tracking. */
  validationScores: VoiceValidationResult;
};
