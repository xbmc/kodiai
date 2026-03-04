/**
 * Wiki voice analyzer: extracts writing style from wiki pages and selects
 * representative sections for few-shot voice matching.
 *
 * Flow: page chunks -> style extraction (LLM) + exemplar selection (deterministic)
 * -> consumed by voice-preserving generation pipeline.
 */

import type { Logger } from "pino";
import type { WikiPageRecord, WikiPageStore } from "./wiki-types.ts";
import type {
  PageStyleDescription,
  StyleExemplar,
  VoiceAnalyzerOptions,
} from "./wiki-voice-types.ts";
import type { VoiceValidationResult } from "./wiki-voice-types.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { generateWithVoicePreservation } from "./wiki-voice-validator.ts";
import type { VoicePreservedSuggestion } from "./wiki-voice-validator.ts";

/** Maximum token budget for style extraction input. */
const STYLE_EXTRACTION_TOKEN_BUDGET = 3000;

/**
 * Select 2-3 representative sections from a page as few-shot style exemplars.
 *
 * Selection criteria:
 * - Groups chunks by sectionHeading
 * - Excludes very short sections (< 50 chars total)
 * - Spreads selections across page positions (early, middle, late)
 * - Prefers sections with formatting diversity (lists, links, code, templates)
 *
 * @param chunks - All chunks for a page, ordered by chunkIndex
 * @param targetCount - Number of exemplars to select (default: 3)
 */
export function selectExemplarSections(
  chunks: WikiPageRecord[],
  targetCount: number = 3,
): StyleExemplar[] {
  if (chunks.length === 0) return [];

  // Group chunks by sectionHeading
  const sectionMap = new Map<
    string,
    { heading: string | null; chunks: WikiPageRecord[]; totalLength: number }
  >();

  for (const chunk of chunks) {
    const key = chunk.sectionHeading ?? "__intro__";
    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        heading: chunk.sectionHeading,
        chunks: [],
        totalLength: 0,
      });
    }
    const section = sectionMap.get(key)!;
    section.chunks.push(chunk);
    section.totalLength += chunk.chunkText.length;
  }

  // Filter out very short sections
  const eligibleSections = Array.from(sectionMap.values()).filter(
    (s) => s.totalLength >= 50,
  );

  if (eligibleSections.length === 0) return [];

  // If fewer eligible sections than target, return all
  if (eligibleSections.length <= targetCount) {
    return eligibleSections.map((s) => ({
      sectionHeading: s.heading,
      chunkText: s.chunks.map((c) => c.chunkText).join("\n"),
      chunkIndex: s.chunks[0]!.chunkIndex,
    }));
  }

  // Score sections by formatting diversity for tiebreaking
  const scored = eligibleSections.map((s) => {
    const text = s.chunks.map((c) => c.chunkText).join("\n");
    let diversityScore = 0;
    if (/^[\*\-]\s/m.test(text)) diversityScore++; // bullet lists
    if (/^\d+\.\s/m.test(text)) diversityScore++; // numbered lists
    if (/\[\[|\[http/m.test(text)) diversityScore++; // links
    if (/```|<code|<pre/m.test(text)) diversityScore++; // code blocks
    if (/\{\{/m.test(text)) diversityScore++; // MediaWiki templates
    return { section: s, diversityScore, text };
  });

  // Sort by diversity score descending for preference, but select by position spread
  scored.sort((a, b) => b.diversityScore - a.diversityScore);

  // Select from spread positions: pick indices at evenly-spaced intervals
  const result: StyleExemplar[] = [];
  const totalSections = eligibleSections.length;

  for (let i = 0; i < targetCount; i++) {
    const positionIndex = Math.floor((i * totalSections) / targetCount);
    const selected = eligibleSections[positionIndex]!;
    result.push({
      sectionHeading: selected.heading,
      chunkText: selected.chunks.map((c) => c.chunkText).join("\n"),
      chunkIndex: selected.chunks[0]!.chunkIndex,
    });
  }

  return result;
}

/**
 * Build the style extraction prompt for LLM analysis.
 */
function buildStyleExtractionPrompt(
  pageTitle: string,
  contentText: string,
): string {
  return `Analyze the writing style, voice, and formatting conventions of this wiki page.

Page title: "${pageTitle}"

Page content (representative sections):
${contentText}

Produce a style description covering:
1. TONE: Formal/informal, technical level, audience assumed
2. PERSPECTIVE: Second person ("you"), imperative ("do X"), third person, passive voice
3. SENTENCE STRUCTURE: Short/long, simple/complex, fragments allowed?
4. TERMINOLOGY: Specific terms used consistently (list them)
5. FORMATTING CONVENTIONS:
   - Heading style (level usage, capitalization)
   - List style (bullets vs numbered, nesting)
   - Code formatting (inline code, code blocks, languages)
   - Link style (bare URLs, named links, wiki links)
   - Emphasis patterns (bold, italic, when used)
   - MediaWiki-specific markup found: templates, infoboxes, magic words (list each with exact syntax)
6. STRUCTURAL PATTERNS: How sections begin/end, transition phrases, paragraph length

Output as plain text description, not JSON.`;
}

/**
 * Extract formatting elements from style description text using simple patterns.
 */
function extractFormattingElements(text: string): string[] {
  const elements: string[] = [];
  if (/bullet|unordered/i.test(text)) elements.push("bullet lists");
  if (/numbered|ordered list/i.test(text)) elements.push("numbered lists");
  if (/code block|fenced code/i.test(text)) elements.push("code blocks");
  if (/inline code|backtick/i.test(text)) elements.push("inline code");
  if (/bold|\*\*/i.test(text)) elements.push("bold emphasis");
  if (/italic|_emphasis/i.test(text)) elements.push("italic emphasis");
  if (/heading/i.test(text)) elements.push("headings");
  if (/link|URL/i.test(text)) elements.push("links");
  if (/table/i.test(text)) elements.push("tables");
  return elements;
}

/**
 * Extract MediaWiki-specific markup patterns from style description text.
 */
function extractMediaWikiMarkup(text: string): string[] {
  const patterns: string[] = [];
  // Match {{TemplateName|...}} patterns mentioned in the text
  const templateMatches = text.match(/\{\{[^}]+\}\}/g);
  if (templateMatches) {
    for (const match of templateMatches) {
      if (!patterns.includes(match)) {
        patterns.push(match);
      }
    }
  }
  return patterns;
}

/**
 * Extract a page's writing style via LLM analysis.
 *
 * Produces a PageStyleDescription containing the LLM's assessment of
 * tone, perspective, sentence structure, terminology, and formatting
 * conventions. Uses the first ~3000 tokens of page content.
 *
 * @param pageChunks - All chunks for the page, ordered by chunkIndex
 * @param opts - Voice analyzer options (taskRouter, costTracker, logger)
 */
export async function extractPageStyle(
  pageChunks: WikiPageRecord[],
  opts: VoiceAnalyzerOptions,
): Promise<PageStyleDescription> {
  const logger = opts.logger.child({ module: "wiki-voice-analyzer" });

  if (pageChunks.length === 0) {
    return {
      pageTitle: "unknown",
      styleText: "",
      formattingElements: [],
      mediaWikiMarkup: [],
      tokenCount: 0,
    };
  }

  const pageTitle = pageChunks[0]!.pageTitle;

  // Select content within token budget
  let tokenCount = 0;
  const contentParts: string[] = [];
  for (const chunk of pageChunks) {
    if (tokenCount + chunk.tokenCount > STYLE_EXTRACTION_TOKEN_BUDGET) break;
    contentParts.push(chunk.chunkText);
    tokenCount += chunk.tokenCount;
  }

  const contentText = contentParts.join("\n\n---\n\n");
  const prompt = buildStyleExtractionPrompt(pageTitle, contentText);

  const resolved = opts.taskRouter.resolve(TASK_TYPES.VOICE_EXTRACT);

  const result = await generateWithFallback({
    taskType: TASK_TYPES.VOICE_EXTRACT,
    resolved,
    prompt,
    logger,
    costTracker: opts.costTracker,
    repo: opts.repo,
  });

  const styleText = result.text.trim();
  const formattingElements = extractFormattingElements(styleText);
  const mediaWikiMarkup = extractMediaWikiMarkup(styleText);

  logger.debug(
    {
      pageTitle,
      tokenCount,
      formattingElementCount: formattingElements.length,
      mediaWikiMarkupCount: mediaWikiMarkup.length,
      durationMs: result.durationMs,
    },
    "Page style extracted",
  );

  return {
    pageTitle,
    styleText,
    formattingElements,
    mediaWikiMarkup,
    tokenCount,
  };
}

// ── Voice-Preserving Generation Pipeline ──────────────────────────────

/** Section input for the voice-preserving pipeline. */
export type SectionInput = {
  sectionHeading: string | null;
  chunkText: string;
  diffEvidence: string;
};

/**
 * Build a voice-preserving generation prompt that combines style description,
 * exemplar sections, original content, and diff evidence.
 *
 * The prompt enforces all CONTEXT.md constraints:
 * - Only use formatting elements the page already uses
 * - Preserve MediaWiki templates verbatim
 * - Stay within existing section boundaries
 * - Output complete section rewrite (not diff)
 */
export function buildVoicePreservingPrompt(opts: {
  styleDescription: PageStyleDescription;
  exemplarSections: StyleExemplar[];
  originalSection: string;
  sectionHeading: string | null;
  diffEvidence: string;
}): string {
  const exemplarText = opts.exemplarSections
    .map((s) => {
      const heading = s.sectionHeading ? `### ${s.sectionHeading}` : "### (Lead section)";
      return `${heading}\n${s.chunkText}`;
    })
    .join("\n\n");

  const mediaWikiNote =
    opts.styleDescription.mediaWikiMarkup.length > 0
      ? `\nMediaWiki templates found on this page: ${opts.styleDescription.mediaWikiMarkup.join(", ")}\nThese MUST be preserved exactly as-is.`
      : "";

  return `You are updating a wiki page section. Your output MUST match the existing page's voice, tone, and formatting.

## Page Style
${opts.styleDescription.styleText}
${mediaWikiNote}

## Style Examples (from this page)
${exemplarText}

## Section to Update
${opts.sectionHeading ? `### ${opts.sectionHeading}` : "### (Lead section)"}
${opts.originalSection}

## What Changed (evidence)
${opts.diffEvidence}

## Constraints
- ONLY use formatting elements listed in the style description
- PRESERVE all MediaWiki templates ({{...}}) and markup EXACTLY as they appear
- Do NOT add code blocks, tables, or other formatting not present in the original
- Do NOT add, remove, or reorder sections — update content within the existing section only
- Match the specific section's conventions (list style, heading level, emphasis patterns)
- Update factual content: fix version numbers, API names, deprecated references to current values
- Gently normalize obvious formatting inconsistencies (capitalization, spacing) while keeping overall voice
- Output the COMPLETE updated section, not a diff`;
}

/**
 * Create a voice-preserving pipeline that processes stale wiki pages.
 *
 * The pipeline:
 * 1. Extracts page style once per page (LLM call)
 * 2. Selects exemplar sections once per page (deterministic)
 * 3. For each section: builds prompt -> generates -> validates -> retries if needed
 *
 * Returns a processPage function that Phase 123 (Update Generation) calls.
 */
export function createVoicePreservingPipeline(opts: {
  taskRouter: import("../llm/task-router.ts").TaskRouter;
  costTracker?: import("../llm/cost-tracker.ts").CostTracker;
  logger: Logger;
  repo?: string;
  wikiPageStore: import("./wiki-types.ts").WikiPageStore;
  generateSectionUpdate: (prompt: string) => Promise<string>;
}): {
  processPage: (
    pageId: number,
    sections: SectionInput[],
  ) => Promise<import("./wiki-voice-types.ts").VoicePreservedUpdate[]>;
} {
  const logger = opts.logger.child({ module: "wiki-voice-pipeline" });

  return {
    async processPage(pageId, sections) {
      // Step 1: Fetch all page chunks
      const pageChunks = await opts.wikiPageStore.getPageChunks(pageId);
      if (pageChunks.length === 0) {
        logger.warn({ pageId }, "No chunks found for page, skipping voice preservation");
        return [];
      }

      const pageTitle = pageChunks[0]!.pageTitle;

      // Step 2: Extract style once per page
      const styleDescription = await extractPageStyle(pageChunks, {
        taskRouter: opts.taskRouter,
        costTracker: opts.costTracker,
        logger: opts.logger,
        repo: opts.repo,
      });

      // Step 3: Select exemplar sections once per page
      const exemplarSections = selectExemplarSections(pageChunks);

      // Step 4: Process each section
      const results: import("./wiki-voice-types.ts").VoicePreservedUpdate[] = [];
      let voiceMismatches = 0;

      for (const section of sections) {
        const prompt = buildVoicePreservingPrompt({
          styleDescription,
          exemplarSections,
          originalSection: section.chunkText,
          sectionHeading: section.sectionHeading,
          diffEvidence: section.diffEvidence,
        });

        const preserved = await generateWithVoicePreservation({
          generateFn: () => opts.generateSectionUpdate(prompt),
          originalSection: section.chunkText,
          styleDescription,
          buildPromptWithFeedback: async (feedback: string) => {
            const feedbackPrompt = `${prompt}\n\n## Voice Match Feedback (from previous attempt)\n${feedback}\n\nPlease regenerate the section update, paying special attention to the feedback above.`;
            return opts.generateSectionUpdate(feedbackPrompt);
          },
          taskRouter: opts.taskRouter,
          costTracker: opts.costTracker,
          logger: opts.logger,
          repo: opts.repo,
        });

        if (preserved.voiceMismatchWarning) voiceMismatches++;

        results.push({
          pageId,
          pageTitle,
          sectionHeading: section.sectionHeading,
          originalContent: section.chunkText,
          suggestion: preserved.suggestion,
          voiceMismatchWarning: preserved.voiceMismatchWarning,
          validationScores: preserved.validationResult,
        });
      }

      logger.info(
        { pageId, pageTitle, sectionsProcessed: sections.length, voiceMismatches },
        "Voice-preserving page processing complete",
      );

      return results;
    },
  };
}
