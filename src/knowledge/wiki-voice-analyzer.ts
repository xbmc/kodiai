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
  StyleCacheEntry,
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
7. WIKI CONVENTIONS:
   - Categories used on this page (list exact [[Category:...]] entries)
   - Interwiki links found (list exact [[xx:...]] entries)
   - Navigation templates/navboxes (list exact {{Navbox...}} entries)
   - Other templates used (list each {{TemplateName}} with its purpose)
   These MUST be preserved verbatim in any generated output.

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
 * Sample content from beginning, middle, and end of a page for spread style analysis.
 * Selects first 2, middle 2, and last 2 chunks (deduplicating overlaps for short pages).
 * Caps total at tokenBudget.
 */
export function sampleSpreadContent(
  chunks: WikiPageRecord[],
  tokenBudget: number = STYLE_EXTRACTION_TOKEN_BUDGET,
): WikiPageRecord[] {
  if (chunks.length === 0) return [];
  if (chunks.length <= 6) return chunks;

  const mid = Math.floor(chunks.length / 2);
  const indices = new Set<number>();
  // Beginning
  indices.add(0);
  indices.add(1);
  // Middle
  indices.add(mid - 1);
  indices.add(mid);
  // End
  indices.add(chunks.length - 2);
  indices.add(chunks.length - 1);

  const selected: WikiPageRecord[] = [];
  let tokenCount = 0;
  for (const idx of Array.from(indices).sort((a, b) => a - b)) {
    const chunk = chunks[idx]!;
    if (tokenCount + chunk.tokenCount > tokenBudget) break;
    selected.push(chunk);
    tokenCount += chunk.tokenCount;
  }
  return selected;
}

/**
 * Extract wiki-specific conventions from ALL page chunks.
 * Scans for categories, interwiki links, navboxes, and templates.
 */
export function extractWikiConventions(chunks: WikiPageRecord[]): {
  categories: string[];
  interwikiLinks: string[];
  navboxes: string[];
  templates: string[];
} {
  const categories = new Set<string>();
  const interwikiLinks = new Set<string>();
  const navboxes = new Set<string>();
  const templates = new Set<string>();

  for (const chunk of chunks) {
    const text = chunk.chunkText;

    // Categories: [[Category:...]]
    const catMatches = text.match(/\[\[Category:[^\]]+\]\]/g);
    if (catMatches) catMatches.forEach((m) => categories.add(m));

    // Interwiki links: [[xx:...]] (2-3 letter language codes)
    const iwMatches = text.match(/\[\[[a-z]{2,3}:[^\]]+\]\]/g);
    if (iwMatches) iwMatches.forEach((m) => interwikiLinks.add(m));

    // Navboxes: {{Navbox...}}
    const navMatches = text.match(/\{\{Navbox[^}]*\}\}/g);
    if (navMatches) navMatches.forEach((m) => navboxes.add(m));

    // Templates: {{TemplateName...}} - extract name only
    const tmplMatches = text.match(/\{\{([^}|]+)/g);
    if (tmplMatches) {
      for (const m of tmplMatches) {
        const name = m.slice(2).trim();
        if (name && !name.startsWith("#") && !name.startsWith("!")) {
          templates.add(name);
        }
      }
    }
  }

  return {
    categories: Array.from(categories),
    interwikiLinks: Array.from(interwikiLinks),
    navboxes: Array.from(navboxes),
    templates: Array.from(templates),
  };
}

/**
 * Compute a content hash for cache invalidation.
 * Uses Bun.hash for speed.
 */
export function computeContentHash(chunks: WikiPageRecord[]): string {
  const content = chunks.map((c) => c.chunkText).join("\n");
  return String(Bun.hash(content));
}

/**
 * Look up a cached style description.
 * Returns null on miss, hash mismatch, or expiry.
 */
export async function getCachedStyle(
  sql: any,
  pageId: number,
  contentHash: string,
): Promise<PageStyleDescription | null> {
  const rows = await sql`
    SELECT style_description FROM wiki_style_cache
    WHERE page_id = ${pageId}
      AND content_hash = ${contentHash}
      AND expires_at > now()
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].style_description as PageStyleDescription;
}

/**
 * Upsert a style description into the cache.
 */
export async function cacheStyleDescription(
  sql: any,
  pageId: number,
  pageTitle: string,
  contentHash: string,
  style: PageStyleDescription,
  ttlDays: number = 7,
): Promise<void> {
  await sql`
    INSERT INTO wiki_style_cache (page_id, page_title, content_hash, style_description, expires_at)
    VALUES (${pageId}, ${pageTitle}, ${contentHash}, ${sql.json(style)}, now() + ${ttlDays + ' days'}::interval)
    ON CONFLICT (page_id) DO UPDATE SET
      page_title = EXCLUDED.page_title,
      content_hash = EXCLUDED.content_hash,
      style_description = EXCLUDED.style_description,
      expires_at = EXCLUDED.expires_at,
      created_at = now()
  `;
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
  opts: VoiceAnalyzerOptions & { sql?: any; cacheTtlDays?: number },
): Promise<PageStyleDescription> {
  const logger = opts.logger.child({ module: "wiki-voice-analyzer" });

  const emptyConventions = { categories: [], interwikiLinks: [], navboxes: [], templates: [] };

  if (pageChunks.length === 0) {
    return {
      pageTitle: "unknown",
      styleText: "",
      formattingElements: [],
      mediaWikiMarkup: [],
      tokenCount: 0,
      wikiConventions: emptyConventions,
    };
  }

  const pageTitle = pageChunks[0]!.pageTitle;
  const pageId = pageChunks[0]!.pageId;

  // Check cache if sql provided
  if (opts.sql) {
    const contentHash = computeContentHash(pageChunks);
    const cached = await getCachedStyle(opts.sql, pageId, contentHash);
    if (cached) {
      logger.debug({ pageTitle, pageId }, "Style cache hit");
      return cached;
    }

    // Cache miss - extract via LLM, then cache
    const result = await extractPageStyleLLM(pageChunks, opts, logger);

    await cacheStyleDescription(
      opts.sql, pageId, pageTitle, contentHash, result, opts.cacheTtlDays ?? 7,
    );
    return result;
  }

  // No sql - backward compatible, no caching
  return extractPageStyleLLM(pageChunks, opts, logger);
}

/** Internal: run LLM style extraction (called on cache miss or when no sql). */
async function extractPageStyleLLM(
  pageChunks: WikiPageRecord[],
  opts: VoiceAnalyzerOptions,
  logger: Logger,
): Promise<PageStyleDescription> {
  const pageTitle = pageChunks[0]!.pageTitle;

  // Use spread sampling instead of sequential
  const sampled = sampleSpreadContent(pageChunks);
  let tokenCount = 0;
  const contentParts: string[] = [];
  for (const chunk of sampled) {
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
    logger: logger as any,
    costTracker: opts.costTracker,
    repo: opts.repo,
  });

  const styleText = result.text.trim();
  const formattingElements = extractFormattingElements(styleText);
  const mediaWikiMarkup = extractMediaWikiMarkup(styleText);
  const wikiConventions = extractWikiConventions(pageChunks);

  logger.debug(
    {
      pageTitle,
      tokenCount,
      formattingElementCount: formattingElements.length,
      mediaWikiMarkupCount: mediaWikiMarkup.length,
      wikiConventionCount: wikiConventions.categories.length + wikiConventions.templates.length,
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
    wikiConventions,
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
 * The prompt encourages formatting improvements per CONTEXT.md:
 * - Improve formatting freely (code blocks, tables, bold)
 * - Normalize inconsistencies
 * - Replace deprecated content
 * - Hard constraints: preserve templates, heading levels, section boundaries
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

## Formatting & Modernization
- IMPROVE formatting freely: add code blocks for code/commands, tables for structured data, bold for emphasis, inline code for API names — wherever it makes the content clearer for readers
- NORMALIZE inconsistencies: standardize list markers (mixed * and - to one style), code formatting, link style, heading capitalization within the section
- REPLACE deprecated content: if old API X is now API Y based on the evidence, use the current name — don't leave dead references
- If the section seems too long or unwieldy after your update, add a note: "<!-- Consider splitting this section into subsections -->" but don't do the split yourself

## Hard Constraints
- PRESERVE all MediaWiki templates ({{...}}) and wiki markup EXACTLY as they appear — do not modify, remove, or invent templates
- PRESERVE heading levels: if the section uses == Heading ==, keep that exact level
- Do NOT add, remove, or reorder sections — update content within the existing section only
- Match the section's writing voice: tone, perspective (you/imperative/third person), terminology
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
  sql?: unknown;
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

      // Step 2: Extract style once per page (with optional caching)
      const styleDescription = await extractPageStyle(pageChunks, {
        taskRouter: opts.taskRouter,
        costTracker: opts.costTracker,
        logger: opts.logger,
        repo: opts.repo,
        sql: opts.sql,
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

        // Drop suggestions that failed template check twice (empty suggestion signals failure)
        if (preserved.suggestion === "" && !preserved.templateCheckPassed) {
          logger.warn(
            { pageId, pageTitle, sectionHeading: section.sectionHeading },
            "Dropping section: template preservation failed after retry",
          );
          continue;
        }

        results.push({
          pageId,
          pageTitle,
          sectionHeading: section.sectionHeading,
          originalContent: section.chunkText,
          suggestion: preserved.suggestion,
          voiceMismatchWarning: preserved.voiceMismatchWarning,
          validationScores: preserved.validationResult,
          templateCheckPassed: preserved.templateCheckPassed,
          headingCheckPassed: preserved.headingCheckPassed,
          formattingAdvisory: preserved.formattingAdvisory,
          sectionLengthAdvisory: preserved.sectionLengthAdvisory,
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
