/**
 * Wiki update generator: produces section-level rewrite suggestions for stale
 * wiki pages, grounded in actual PR evidence with inline citations.
 *
 * Flow: popular stale pages -> section decomposition -> patch matching ->
 *       voice-preserving generation -> grounding check -> DB storage.
 *
 * Connects Phase 122 (staleness evidence) with Phase 125 (voice preservation)
 * to produce verified, citable wiki update suggestions for Phase 124 (publishing).
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { WikiPageRecord } from "./wiki-types.ts";
import type { PREvidence } from "./wiki-staleness-types.ts";
import type {
  SectionPatchMatch,
  UpdateSuggestion,
  UpdateGeneratorOptions,
  UpdateGeneratorResult,
} from "./wiki-update-types.ts";
import { DOMAIN_STOPWORDS } from "./wiki-staleness-detector.ts";
import { createVoicePreservingPipeline } from "./wiki-voice-analyzer.ts";
import type { SectionInput } from "./wiki-voice-analyzer.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";

/** Maximum patches to include per section. */
const MAX_PATCHES_PER_SECTION = 5;

/** Maximum total patch content length (chars) per section. */
const PATCH_CONTENT_CAP = 3000;

/** Minimum non-stopword token overlap to include a patch. */
const MIN_OVERLAP_SCORE = 2;

// ── Section-to-Patch Matching ──────────────────────────────────────────

/**
 * Extract non-stopword tokens from text, splitting on word boundaries.
 * Filters tokens <= 3 chars and domain stopwords.
 */
function extractTokens(texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const t of text.toLowerCase().split(/\W+/)) {
      if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) {
        tokens.add(t);
      }
    }
  }
  return tokens;
}

/**
 * Extract tokens from a file path, splitting on path separators and common delimiters.
 */
function extractPathTokens(filePath: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of filePath.toLowerCase().split(/[/._\-]+/)) {
    if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) {
      tokens.add(t);
    }
  }
  return tokens;
}

/**
 * Match PR evidence patches to a wiki section by token overlap.
 *
 * Extracts tokens from section heading + body and from each patch's file path
 * + patch content. Includes patches with >= MIN_OVERLAP_SCORE non-stopword
 * token overlap. Sorts by heuristic_score DESC, caps at MAX_PATCHES_PER_SECTION,
 * and truncates total patch content at PATCH_CONTENT_CAP.
 *
 * Exported for testing.
 */
export function matchPatchesToSection(
  sectionChunks: WikiPageRecord[],
  evidenceRows: PREvidence[],
): SectionPatchMatch {
  const heading = sectionChunks[0]?.sectionHeading ?? null;
  const sectionContent = sectionChunks.map((c) => c.chunkText).join("\n");

  // Build section tokens from heading + body
  const sectionTexts = sectionChunks.map((c) => c.chunkText);
  if (heading) sectionTexts.push(heading);
  const sectionTokens = extractTokens(sectionTexts);

  // Score each evidence row by token overlap
  const scored: Array<{ evidence: PREvidence; overlap: number }> = [];

  for (const ev of evidenceRows) {
    // Tokens from file path
    const pathTokens = extractPathTokens(ev.filePath);
    // Tokens from patch content
    const patchTokens = extractTokens([ev.patch]);

    // Union of path + patch tokens
    let overlap = 0;
    for (const token of pathTokens) {
      if (sectionTokens.has(token)) overlap++;
    }
    for (const token of patchTokens) {
      if (sectionTokens.has(token) && !pathTokens.has(token)) overlap++;
    }

    if (overlap >= MIN_OVERLAP_SCORE) {
      scored.push({ evidence: ev, overlap });
    }
  }

  // Sort by heuristic_score DESC, take top N
  scored.sort((a, b) => b.evidence.heuristicScore - a.evidence.heuristicScore);
  const topScored = scored.slice(0, MAX_PATCHES_PER_SECTION);

  // Cap total patch content
  const matchingPatches: PREvidence[] = [];
  let totalPatchLen = 0;

  for (const { evidence } of topScored) {
    if (totalPatchLen + evidence.patch.length > PATCH_CONTENT_CAP) {
      // Try to include a truncated version if we have room
      const remaining = PATCH_CONTENT_CAP - totalPatchLen;
      if (remaining > 100) {
        matchingPatches.push({
          ...evidence,
          patch: evidence.patch.slice(0, remaining) + "\n[truncated]",
        });
      }
      break;
    }
    matchingPatches.push(evidence);
    totalPatchLen += evidence.patch.length;
  }

  const totalOverlap = scored.reduce((sum, s) => sum + s.overlap, 0);

  return {
    sectionHeading: heading,
    sectionContent,
    matchingPatches,
    overlapScore: totalOverlap,
  };
}

// ── Grounding Prompt ───────────────────────────────────────────────────

/**
 * Build a grounding-enforced prompt for section update generation.
 *
 * Includes patch diffs with PR numbers, strict grounding rules, citation
 * format instructions, and NO_UPDATE escape hatch.
 *
 * Exported for testing.
 */
export function buildGroundedSectionPrompt(opts: {
  sectionHeading: string | null;
  sectionContent: string;
  patches: Array<{ prNumber: number; prTitle: string; patch: string }>;
  githubOwner: string;
  githubRepo: string;
}): string {
  const patchContext = opts.patches
    .map(
      (p) =>
        `### PR #${p.prNumber}: ${p.prTitle}\n\`\`\`diff\n${p.patch}\n\`\`\``,
    )
    .join("\n\n");

  const heading = opts.sectionHeading ?? "(Lead section)";

  return `Update this wiki section based ONLY on the code changes shown below.

SECTION: ${heading}
${opts.sectionContent}

CODE CHANGES (from merged PRs):
${patchContext}

RULES:
1. Begin with "WHY: " followed by 1-2 sentences explaining why this section needs updating
2. Then output the COMPLETE updated section content
3. Every factual change you make MUST cite the specific PR inline, e.g., "(PR #${opts.patches[0]?.prNumber ?? "NNNN"})"
4. Link format: https://github.com/${opts.githubOwner}/${opts.githubRepo}/pull/{number}
5. If a change cannot be grounded in the patches above, DO NOT include it
6. If the patches show no wiki-relevant changes for this section, respond with only "NO_UPDATE"`;
}

// ── Output Parsing ─────────────────────────────────────────────────────

/**
 * Parse LLM-generated suggestion text into structured components.
 *
 * Expected formats:
 * - "NO_UPDATE" — no changes needed
 * - "WHY: <summary>\n\n<suggestion>" — standard output
 * - Fallback: first sentence as summary, rest as suggestion
 *
 * Exported for testing.
 */
export function parseGeneratedSuggestion(text: string): {
  whySummary: string;
  suggestion: string;
  isNoUpdate: boolean;
} {
  const trimmed = text.trim();

  // Check for NO_UPDATE
  if (trimmed.toUpperCase().startsWith("NO_UPDATE")) {
    return { whySummary: "", suggestion: "", isNoUpdate: true };
  }

  // Check for WHY: prefix
  if (trimmed.startsWith("WHY: ") || trimmed.startsWith("WHY:")) {
    const withoutPrefix = trimmed.startsWith("WHY: ")
      ? trimmed.slice(5)
      : trimmed.slice(4);
    const splitIndex = withoutPrefix.indexOf("\n\n");
    if (splitIndex !== -1) {
      return {
        whySummary: withoutPrefix.slice(0, splitIndex).trim(),
        suggestion: withoutPrefix.slice(splitIndex + 2).trim(),
        isNoUpdate: false,
      };
    }
    // No double newline — use first line as summary
    const lineBreak = withoutPrefix.indexOf("\n");
    if (lineBreak !== -1) {
      return {
        whySummary: withoutPrefix.slice(0, lineBreak).trim(),
        suggestion: withoutPrefix.slice(lineBreak + 1).trim(),
        isNoUpdate: false,
      };
    }
    // Single line — treat entire text as suggestion with empty summary
    return { whySummary: withoutPrefix.trim(), suggestion: "", isNoUpdate: false };
  }

  // Fallback: first sentence as summary
  const sentenceEnd = trimmed.search(/[.!?]\s/);
  if (sentenceEnd !== -1) {
    return {
      whySummary: trimmed.slice(0, sentenceEnd + 1).trim(),
      suggestion: trimmed.slice(sentenceEnd + 2).trim(),
      isNoUpdate: false,
    };
  }

  // No sentence boundary — use entire text as suggestion
  return { whySummary: "", suggestion: trimmed, isNoUpdate: false };
}

// ── Grounding Check ────────────────────────────────────────────────────

/**
 * Verify that a suggestion is grounded by checking for PR citations.
 *
 * Extracts all `PR #NNNN` patterns from suggestion text and checks if at
 * least one matches a PR number from the input patches.
 *
 * Exported for testing.
 */
export function checkGrounding(
  suggestionText: string,
  inputPrNumbers: number[],
): boolean {
  if (inputPrNumbers.length === 0) return false;

  const prPattern = /PR\s*#(\d+)/gi;
  const inputSet = new Set(inputPrNumbers);
  let match;

  while ((match = prPattern.exec(suggestionText)) !== null) {
    const citedPr = parseInt(match[1]!, 10);
    if (inputSet.has(citedPr)) return true;
  }

  return false;
}

/**
 * Extract cited PR numbers from suggestion text.
 */
function extractCitedPrs(
  suggestionText: string,
  evidenceRows: PREvidence[],
): Array<{ prNumber: number; prTitle: string }> {
  const prPattern = /PR\s*#(\d+)/gi;
  const prMap = new Map<number, string>();
  for (const ev of evidenceRows) {
    prMap.set(ev.prNumber, ev.prTitle);
  }

  const cited: Array<{ prNumber: number; prTitle: string }> = [];
  const seen = new Set<number>();
  let match;

  while ((match = prPattern.exec(suggestionText)) !== null) {
    const prNum = parseInt(match[1]!, 10);
    if (!seen.has(prNum) && prMap.has(prNum)) {
      cited.push({ prNumber: prNum, prTitle: prMap.get(prNum)! });
      seen.add(prNum);
    }
  }

  return cited;
}

// ── Main Generator ─────────────────────────────────────────────────────

/**
 * Group page chunks by sectionHeading into logical sections.
 */
function groupChunksIntoSections(
  chunks: WikiPageRecord[],
): Map<string | null, WikiPageRecord[]> {
  const sections = new Map<string | null, WikiPageRecord[]>();
  for (const chunk of chunks) {
    const heading = chunk.sectionHeading;
    if (!sections.has(heading)) sections.set(heading, []);
    sections.get(heading)!.push(chunk);
  }
  return sections;
}

/**
 * Create an update generator that processes stale wiki pages and produces
 * grounded, voice-preserving section rewrite suggestions.
 *
 * @param opts - Generator configuration
 * @returns Object with `run()` method for executing the generation pipeline
 */
export function createUpdateGenerator(opts: UpdateGeneratorOptions): {
  run(runOpts: {
    topN?: number;
    dryRun?: boolean;
    pageIds?: number[];
  }): Promise<UpdateGeneratorResult>;
} {
  const logger = opts.logger.child({ module: "wiki-update-generator" });

  return {
    async run(runOpts) {
      const startTime = Date.now();
      const topN = runOpts.topN ?? 20;
      const dryRun = runOpts.dryRun ?? false;

      let result: UpdateGeneratorResult = {
        pagesProcessed: 0,
        sectionsProcessed: 0,
        suggestionsGenerated: 0,
        suggestionsDropped: 0,
        voiceMismatches: 0,
        durationMs: 0,
      };

      // Step 1: Determine pages to process
      let pages: Array<{ pageId: number; pageTitle: string }>;

      if (runOpts.pageIds && runOpts.pageIds.length > 0) {
        // Use specified page IDs — look up titles from wiki_pages
        const rows = await opts.sql`
          SELECT DISTINCT page_id, page_title
          FROM wiki_pages
          WHERE page_id = ANY(${runOpts.pageIds})
            AND deleted = false
        `;
        pages = rows.map((r) => ({
          pageId: r.page_id as number,
          pageTitle: r.page_title as string,
        }));
      } else {
        // Top N pages by popularity that have PR evidence
        const rows = await opts.sql`
          SELECT DISTINCT wpp.page_id, wpp.page_title, wpp.composite_score
          FROM wiki_page_popularity wpp
          INNER JOIN wiki_pr_evidence wpe ON wpe.matched_page_id = wpp.page_id
          ORDER BY wpp.composite_score DESC
          LIMIT ${topN}
        `;
        pages = rows.map((r) => ({
          pageId: r.page_id as number,
          pageTitle: r.page_title as string,
        }));
      }

      if (pages.length === 0) {
        logger.info("No stale pages with PR evidence found — nothing to generate");
        result.durationMs = Date.now() - startTime;
        return result;
      }

      logger.info(
        { pageCount: pages.length, topN, dryRun },
        "Starting wiki update generation",
      );

      // Create generateSectionUpdate callback for voice pipeline
      const generateSectionUpdate = async (prompt: string): Promise<string> => {
        const resolved = opts.taskRouter.resolve(TASK_TYPES.SECTION_UPDATE);
        const genResult = await generateWithFallback({
          taskType: TASK_TYPES.SECTION_UPDATE,
          resolved,
          prompt,
          logger,
          costTracker: opts.costTracker,
          repo: `${opts.githubOwner}/${opts.githubRepo}`,
        });
        return genResult.text;
      };

      // Create voice-preserving pipeline
      const pipeline = createVoicePreservingPipeline({
        taskRouter: opts.taskRouter,
        costTracker: opts.costTracker,
        logger: opts.logger,
        repo: `${opts.githubOwner}/${opts.githubRepo}`,
        wikiPageStore: opts.wikiPageStore,
        generateSectionUpdate,
      });

      // Step 2: Process each page sequentially
      for (const page of pages) {
        try {
          await processPage(page, pipeline, opts, runOpts, result, logger);
        } catch (err) {
          logger.error(
            { err, pageId: page.pageId, pageTitle: page.pageTitle },
            "Failed to process page (continuing to next)",
          );
        }

        // Rate limit between pages
        if (opts.rateLimitMs && opts.rateLimitMs > 0) {
          await new Promise((r) => setTimeout(r, opts.rateLimitMs));
        }
      }

      result.pagesProcessed = pages.length;
      result.durationMs = Date.now() - startTime;

      logger.info(
        {
          pagesProcessed: result.pagesProcessed,
          sectionsProcessed: result.sectionsProcessed,
          suggestionsGenerated: result.suggestionsGenerated,
          suggestionsDropped: result.suggestionsDropped,
          voiceMismatches: result.voiceMismatches,
          durationMs: result.durationMs,
        },
        "Wiki update generation complete",
      );

      return result;
    },
  };
}

/**
 * Process a single page: decompose into sections, match patches,
 * generate via voice pipeline, check grounding, store results.
 */
async function processPage(
  page: { pageId: number; pageTitle: string },
  pipeline: ReturnType<typeof createVoicePreservingPipeline>,
  opts: UpdateGeneratorOptions,
  runOpts: { dryRun?: boolean },
  result: UpdateGeneratorResult,
  logger: Logger,
): Promise<void> {
  // Fetch page chunks
  const pageChunks = await opts.wikiPageStore.getPageChunks(page.pageId);
  if (pageChunks.length === 0) {
    logger.debug({ pageId: page.pageId }, "No chunks found, skipping");
    return;
  }

  // Group chunks into sections
  const sections = groupChunksIntoSections(pageChunks);

  // Fetch PR evidence for this page
  const evidenceRows = await opts.sql`
    SELECT id, pr_number, pr_title, pr_description, pr_author, merged_at,
           file_path, patch, issue_references, matched_page_id,
           matched_page_title, heuristic_score
    FROM wiki_pr_evidence
    WHERE matched_page_id = ${page.pageId}
    ORDER BY merged_at DESC
  `;

  const evidence: PREvidence[] = evidenceRows.map((r) => ({
    id: r.id as number,
    prNumber: r.pr_number as number,
    prTitle: r.pr_title as string,
    prDescription: (r.pr_description as string) ?? null,
    prAuthor: r.pr_author as string,
    mergedAt: new Date(r.merged_at as string),
    filePath: r.file_path as string,
    patch: r.patch as string,
    issueReferences: (r.issue_references as Array<{
      issueNumber: number;
      keyword: string;
      crossRepo: string | null;
    }>) ?? [],
    matchedPageId: (r.matched_page_id as number) ?? null,
    matchedPageTitle: (r.matched_page_title as string) ?? null,
    heuristicScore: r.heuristic_score as number,
  }));

  if (evidence.length === 0) {
    logger.debug({ pageId: page.pageId }, "No PR evidence found, skipping");
    return;
  }

  // Match patches to sections and build SectionInput array
  const sectionInputs: SectionInput[] = [];
  const sectionMatches: Map<string | null, SectionPatchMatch> = new Map();

  for (const [heading, chunks] of sections) {
    const match = matchPatchesToSection(chunks, evidence);
    if (match.matchingPatches.length === 0) {
      // Skip sections with no relevant PR evidence (per CONTEXT.md)
      continue;
    }
    sectionMatches.set(heading, match);

    // Build diff evidence string for voice pipeline
    const diffEvidence = match.matchingPatches
      .map(
        (p) =>
          `PR #${p.prNumber}: ${p.prTitle}\n${p.patch}`,
      )
      .join("\n\n");

    sectionInputs.push({
      sectionHeading: heading,
      chunkText: match.sectionContent,
      diffEvidence,
    });
  }

  if (sectionInputs.length === 0) {
    logger.info(
      { pageId: page.pageId, pageTitle: page.pageTitle },
      "No sections matched any patches, skipping page",
    );
    return;
  }

  result.sectionsProcessed += sectionInputs.length;

  // Generate via voice-preserving pipeline
  const voiceResults = await pipeline.processPage(page.pageId, sectionInputs);

  let pageSuggestions = 0;
  let pageDropped = 0;

  for (const vr of voiceResults) {
    const sectionMatch = sectionMatches.get(vr.sectionHeading);
    if (!sectionMatch) continue;

    // Parse the generated suggestion
    const parsed = parseGeneratedSuggestion(vr.suggestion);

    if (parsed.isNoUpdate) {
      logger.debug(
        { pageId: page.pageId, section: vr.sectionHeading },
        "Section returned NO_UPDATE, skipping",
      );
      continue;
    }

    // Check grounding
    const inputPrNumbers = sectionMatch.matchingPatches.map((p) => p.prNumber);
    const isGrounded = checkGrounding(parsed.suggestion, inputPrNumbers);

    if (!isGrounded) {
      logger.info(
        { pageId: page.pageId, section: vr.sectionHeading },
        "Suggestion failed grounding check (no matching PR citations), dropping",
      );
      pageDropped++;
      result.suggestionsDropped++;
      continue;
    }

    // Extract cited PRs
    const citingPrs = extractCitedPrs(parsed.suggestion, evidence);

    if (vr.voiceMismatchWarning) {
      result.voiceMismatches++;
    }

    // Store in DB (unless dry run)
    if (!runOpts.dryRun) {
      await storeSuggestion(opts.sql, {
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        sectionHeading: vr.sectionHeading,
        originalContent: vr.originalContent,
        suggestion: parsed.suggestion,
        whySummary: parsed.whySummary,
        groundingStatus: "grounded",
        citingPrs,
        voiceMismatchWarning: vr.voiceMismatchWarning,
        voiceScores: vr.validationScores,
      });
    }

    pageSuggestions++;
    result.suggestionsGenerated++;
  }

  logger.info(
    {
      pageId: page.pageId,
      pageTitle: page.pageTitle,
      sectionsMatched: sectionInputs.length,
      suggestionsGenerated: pageSuggestions,
      suggestionsDropped: pageDropped,
    },
    "Page processing complete",
  );
}

/**
 * Store a grounded suggestion in wiki_update_suggestions.
 * Uses DELETE + INSERT in a transaction to handle NULL section_heading
 * (PostgreSQL UNIQUE doesn't treat NULLs as equal).
 */
async function storeSuggestion(
  sql: Sql,
  suggestion: Omit<UpdateSuggestion, "id" | "generatedAt">,
): Promise<void> {
  const headingCoalesced = suggestion.sectionHeading ?? "";

  await sql.begin(async (tx) => {
    // Delete existing suggestion for this page + section
    await tx`
      DELETE FROM wiki_update_suggestions
      WHERE page_id = ${suggestion.pageId}
        AND COALESCE(section_heading, '') = ${headingCoalesced}
    `;

    // Insert new suggestion
    await tx`
      INSERT INTO wiki_update_suggestions (
        page_id, page_title, section_heading, original_content,
        suggestion, why_summary, grounding_status,
        citing_prs, voice_mismatch_warning, voice_scores, generated_at
      ) VALUES (
        ${suggestion.pageId},
        ${suggestion.pageTitle},
        ${suggestion.sectionHeading},
        ${suggestion.originalContent},
        ${suggestion.suggestion},
        ${suggestion.whySummary},
        ${suggestion.groundingStatus},
        ${JSON.stringify(suggestion.citingPrs)}::jsonb,
        ${suggestion.voiceMismatchWarning},
        ${suggestion.voiceScores ? JSON.stringify(suggestion.voiceScores) : null}::jsonb,
        now()
      )
    `;
  });
}
