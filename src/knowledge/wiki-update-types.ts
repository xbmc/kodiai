/**
 * Type definitions for wiki update generation pipeline.
 *
 * Consumed by wiki-update-generator.ts (Phase 123) and
 * scripts/generate-wiki-updates.ts (CLI entry point).
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { WikiPageStore } from "./wiki-types.ts";
import type { TaskRouter } from "../llm/task-router.ts";
import type { CostTracker } from "../llm/cost-tracker.ts";
import type { PREvidence } from "./wiki-staleness-types.ts";
import type { VoiceValidationResult } from "./wiki-voice-types.ts";

/** Links a wiki section to its matching PR evidence patches. */
export type SectionPatchMatch = {
  /** Section heading (null for lead/intro section). */
  sectionHeading: string | null;
  /** Concatenated chunk texts for this section. */
  sectionContent: string;
  /** PR evidence rows with relevant patches for this section. */
  matchingPatches: PREvidence[];
  /** Total non-stopword token overlap score. */
  overlapScore: number;
};

/** A single generated suggestion stored in wiki_update_suggestions table. */
export type UpdateSuggestion = {
  id?: number;
  pageId: number;
  pageTitle: string;
  /** Section heading (null for lead/intro section). */
  sectionHeading: string | null;
  /** Original section content before update. */
  originalContent: string;
  /** LLM-generated section rewrite suggestion. */
  suggestion: string;
  /** 1-2 sentence explanation of why the section needs updating. */
  whySummary: string;
  /** Whether the suggestion is grounded in PR evidence. */
  groundingStatus: "grounded" | "ungrounded" | "no_update";
  /** PR(s) cited in the suggestion. */
  citingPrs: Array<{ prNumber: number; prTitle: string }>;
  /** True if voice validation failed after retry. */
  voiceMismatchWarning: boolean;
  /** Full validation scores (null if voice validation not performed). */
  voiceScores: VoiceValidationResult | null;
  /** When the suggestion was generated. */
  generatedAt?: string;
};

/** Constructor options for the update generator module. */
export type UpdateGeneratorOptions = {
  sql: Sql;
  wikiPageStore: WikiPageStore;
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  logger: Logger;
  /** GitHub owner for PR link URLs (default: "xbmc"). */
  githubOwner: string;
  /** GitHub repo for PR link URLs (default: "xbmc"). */
  githubRepo: string;
  /** Milliseconds between LLM calls for rate limiting (default: 300). */
  rateLimitMs?: number;
};

/** Result from a full generation run. */
export type UpdateGeneratorResult = {
  /** Number of pages processed. */
  pagesProcessed: number;
  /** Number of sections processed (across all pages). */
  sectionsProcessed: number;
  /** Number of grounded suggestions generated and stored. */
  suggestionsGenerated: number;
  /** Number of suggestions dropped (ungrounded). */
  suggestionsDropped: number;
  /** Number of suggestions with voice mismatch warnings. */
  voiceMismatches: number;
  /** Total duration in milliseconds. */
  durationMs: number;
};
