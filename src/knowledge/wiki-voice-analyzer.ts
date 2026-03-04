/**
 * Wiki voice analyzer: extracts writing style from wiki pages and selects
 * representative sections for few-shot voice matching.
 *
 * Flow: page chunks -> style extraction (LLM) + exemplar selection (deterministic)
 * -> consumed by voice-preserving generation pipeline.
 */

import type { Logger } from "pino";
import type { WikiPageRecord } from "./wiki-types.ts";
import type {
  PageStyleDescription,
  StyleExemplar,
  VoiceAnalyzerOptions,
} from "./wiki-voice-types.ts";
import { generateWithFallback } from "../llm/generate.ts";

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

  // Use voice.extract task type — registered in task-types.ts by Plan 03
  const resolved = opts.taskRouter.resolve("voice.extract");

  const result = await generateWithFallback({
    taskType: "voice.extract",
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
