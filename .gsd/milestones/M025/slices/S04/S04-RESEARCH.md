# Phase 123: Update Generation - Research

**Researched:** 2026-03-04
**Domain:** LLM-powered section-level wiki update suggestions grounded in PR evidence
**Confidence:** HIGH

## Summary

Phase 123 generates section-level rewrite suggestions for stale wiki pages using the voice-preserving pipeline from Phase 125 and the PR evidence stored by Phase 122's staleness detector. The architecture is straightforward: a standalone CLI script queries the top 20 pages by popularity, fetches their PR evidence from `wiki_pr_evidence`, decomposes each page into MediaWiki sections, matches relevant patches to sections, then calls the voice-preserving pipeline with grounded prompts. Results are stored in a new `wiki_update_suggestions` table for Phase 124 to consume.

The core challenge is section-to-patch matching: determining which stored PR patches are relevant to which wiki section. The codebase already has the token-overlap heuristic from the staleness detector, and the PR evidence table stores patches keyed by `matched_page_id`. The new work is decomposing pages by `== Heading ==` boundaries and filtering patches to only those relevant to each section's topic.

**Primary recommendation:** Build a single `scripts/generate-wiki-updates.ts` script that orchestrates the full pipeline: query popular stale pages, decompose into sections, match patches to sections, generate via `createVoicePreservingPipeline`, store results. Add a new `SECTION_UPDATE` task type for the grounding+generation LLM call.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Decompose pages by MediaWiki section headings (== Heading == boundaries)
- Each section gets its own suggestion if stale; sections with no relevant PR evidence are skipped silently
- Suggestions are full rewritten sections (not change descriptions) — editors can copy-paste
- Wire Phase 125's voice-preserving pipeline (`generateWithVoicePreservation`) as the generation backend from day one
- Inline PR citations where the change is mentioned, e.g., "The audio pipeline now uses PipeWire (PR #27901)"
- Link to GitHub PR page (not file-specific diff links)
- Feed only relevant patches (matching the section being updated) to the LLM, not all patches for the page
- Each suggestion includes a brief 1-2 sentence summary of WHY the section needs updating before the full rewrite
- Strict grounding: every factual claim must trace to a specific PR patch
- Grounding enforced via prompt instructions (not a separate post-generation classifier)
- If a suggestion fails the grounding check, drop it entirely — don't include with warnings
- Skip sections where the diff shows no clear wiki-relevant impact (e.g., pure internal refactoring)
- Standalone manual-trigger script (like backfill scripts), not integrated into the staleness detector
- Process top 20 pages by composite popularity score per run (matches UPDATE-04)
- Store generated suggestions in a new DB table (wiki_update_suggestions) for Phase 124 to consume
- Process pages sequentially with rate limiting between LLM calls

### Claude's Discretion
- DB table schema design for wiki_update_suggestions (columns, indexes, constraints)
- Section-to-patch matching algorithm (how to determine which patches are relevant to which section)
- Rate limiting intervals between LLM calls
- Error handling and retry strategy for individual section failures
- How to surface generation progress (logging detail level)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPDATE-01 | LLM generates section-level rewrite suggestions for stale wiki pages | Voice-preserving pipeline (`createVoicePreservingPipeline`) handles generation; section decomposition via heading regex; new `wiki_update_suggestions` table stores results |
| UPDATE-02 | Suggestions grounded in actual code diff content (not fabricated) | Prompt engineering with explicit grounding constraints; patches fed per-section from `wiki_pr_evidence` table; ungrounded suggestions dropped entirely |
| UPDATE-03 | Each suggestion cites the PR(s)/commit(s) that motivated the change | Inline PR citation format in generation prompt; PR metadata from `wiki_pr_evidence` rows (pr_number, pr_title); GitHub PR URL template |
| UPDATE-04 | Top 20 pages by composite popularity score processed per run | `wiki-popularity-store.ts` `getTopN(20)` provides ranking; cross-reference with staleness scan results to filter to stale pages only |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (postgres.js) | existing | DB queries for evidence lookup and suggestion storage | Already used throughout codebase |
| ai (Vercel AI SDK) | existing | `generateText()` via `generateWithFallback` | Project standard for non-agentic LLM calls |
| pino | existing | Structured logging | Project standard |
| node:util parseArgs | built-in | CLI argument parsing | Pattern from all backfill scripts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| wiki-voice-analyzer.ts | Phase 125 | `createVoicePreservingPipeline`, `SectionInput` type | Core generation backend |
| wiki-voice-validator.ts | Phase 125 | `generateWithVoicePreservation` with retry | Called by voice pipeline |
| wiki-popularity-store.ts | Phase 121 | `getTopN()` for page ranking | Selecting top 20 pages |
| wiki-staleness-detector.ts | Phase 122 | `StalePage` type, `wiki_pr_evidence` table | Evidence source |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── knowledge/
│   ├── wiki-update-generator.ts     # Core logic: section matching, prompt building, DB storage
│   └── wiki-update-types.ts         # Types for suggestions, generation options
├── db/migrations/
│   └── 023-wiki-update-suggestions.sql  # New table
├── llm/
│   └── task-types.ts                # Add SECTION_UPDATE task type
scripts/
└── generate-wiki-updates.ts         # CLI entry point
```

### Pattern 1: Standalone Script with Core Logic Module
**What:** CLI script thin-wraps a module in `src/knowledge/` — exactly like `scripts/backfill-wiki.ts` wraps `wiki-backfill.ts`
**When to use:** Manual-trigger pipelines that may later be scheduled
**Example:**
```typescript
// scripts/generate-wiki-updates.ts
const generator = createUpdateGenerator({ sql, wikiPageStore, taskRouter, ... });
const result = await generator.run({ topN: 20, dryRun: false });
```

### Pattern 2: Section Decomposition via Heading Boundaries
**What:** Split wiki page chunks into logical sections using `== Heading ==` regex from `sectionHeading` field on `WikiPageRecord`
**When to use:** When generating per-section suggestions
**Example:**
```typescript
// Group chunks by sectionHeading (already stored per-chunk in wiki_pages)
const sectionMap = new Map<string | null, WikiPageRecord[]>();
for (const chunk of pageChunks) {
  const key = chunk.sectionHeading;
  if (!sectionMap.has(key)) sectionMap.set(key, []);
  sectionMap.get(key)!.push(chunk);
}
```

### Pattern 3: Section-to-Patch Matching via Token Overlap
**What:** Reuse the token overlap approach from `heuristicScore()` to match wiki section content against stored patches
**When to use:** Determining which patches from `wiki_pr_evidence` are relevant to which section
**Example:**
```typescript
// For each section, extract tokens from heading + body
// For each patch, extract tokens from file path + patch content
// Score overlap; include patches with score > 0
function matchPatchesToSection(
  sectionChunks: WikiPageRecord[],
  evidenceRows: PREvidence[],
): PREvidence[] {
  const sectionTokens = extractTokens(sectionChunks);
  return evidenceRows.filter(ev => {
    const patchTokens = extractTokens([ev.filePath, ev.patch]);
    return tokenOverlap(sectionTokens, patchTokens) > 0;
  });
}
```

### Pattern 4: Grounding Prompt with Citation Instructions
**What:** LLM prompt that forces inline PR citations and strict grounding
**When to use:** The `generateSectionUpdate` callback passed to `createVoicePreservingPipeline`
**Key elements:**
- List specific patches and PR numbers in the prompt context
- Instruct: "Every factual change must cite the specific PR that introduced it"
- Instruct: "If you cannot ground a claim in the provided patches, do not include it"
- Include PR URL template: `https://github.com/xbmc/xbmc/pull/{number}`

### Anti-Patterns to Avoid
- **Full-page rewrites:** Must decompose by section — never generate entire page at once
- **All patches to LLM:** Only feed section-relevant patches — reduces token usage and improves grounding accuracy
- **Post-generation classifier:** Grounding enforced via prompt, not a separate verification step
- **Parallel LLM calls:** Process pages sequentially with rate limiting (project convention)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Voice-preserving generation | Custom generation pipeline | `createVoicePreservingPipeline` from wiki-voice-analyzer.ts | Already handles style extraction, exemplar selection, voice validation, retry |
| LLM text generation | Direct API calls | `generateWithFallback` from generate.ts | Handles fallback, cost tracking, model routing |
| Page popularity ranking | Custom scoring query | `WikiPopularityStore.getTopN()` | Already implements composite scoring |
| Section heading parsing | Manual regex on raw text | `sectionHeading` field on `WikiPageRecord` | Already parsed and stored per-chunk at ingest time |
| PR evidence lookup | GitHub API calls at generation time | `wiki_pr_evidence` table queries | Phase 122 already stores patches with page associations |

**Key insight:** Phase 123 is primarily an integration phase — it connects Phase 122's evidence (patches in DB) with Phase 125's generation pipeline (voice preservation). The novel work is section-to-patch matching and the grounding prompt design.

## Common Pitfalls

### Pitfall 1: Token Budget Explosion
**What goes wrong:** Feeding too many patches to the LLM causes token limit errors or poor output quality
**Why it happens:** A popular page may have dozens of matching patches across many PRs
**How to avoid:** Cap patch content per section at 3000 chars (same as staleness detector); sort patches by heuristic_score DESC and take top 5
**Warning signs:** LLM calls timing out or returning truncated responses

### Pitfall 2: False Section-to-Patch Matches
**What goes wrong:** Token overlap produces false positives — e.g., "player" appears in both a wiki section about video player and a patch to audio player code
**Why it happens:** Generic domain terms create spurious matches
**How to avoid:** Reuse `DOMAIN_STOPWORDS` set from staleness detector; require minimum overlap score (e.g., >= 2 non-stopword tokens)
**Warning signs:** Suggestions referencing unrelated code changes

### Pitfall 3: Ungrounded Claims Leaking Through
**What goes wrong:** LLM generates plausible-sounding but ungrounded content despite prompt instructions
**Why it happens:** LLMs naturally fill gaps with training knowledge
**How to avoid:** Post-generation heuristic check: scan for PR citation format (PR #NNNNN); if a suggestion paragraph contains factual claims without any PR citation, flag it. The CONTEXT.md says no separate classifier, but a lightweight heuristic check on the output format is different from a full classification step
**Warning signs:** Suggestions without any `(PR #NNNN)` citations

### Pitfall 4: Empty Suggestions for All Sections
**What goes wrong:** No sections match any patches, producing zero suggestions for a page
**Why it happens:** Staleness detector flagged the page at page-level but no section-level patch matches exist
**How to avoid:** This is expected behavior per CONTEXT.md ("sections with no relevant PR evidence are skipped silently"). Log at info level so operators know. Consider: if zero sections produce suggestions, log a warning but still record a "no_suggestions" entry

### Pitfall 5: Voice Pipeline Cost Multiplication
**What goes wrong:** Each section requires style extraction (1 LLM call) + generation (1-2 calls) + voice validation (1-2 calls) = 3-5 calls per section
**Why it happens:** Voice-preserving pipeline does full validation loop per section
**How to avoid:** Style extraction and exemplar selection happen once per page (already the case in `createVoicePreservingPipeline`). For 20 pages with avg 5 sections each, budget for ~100-200 LLM calls per run. Use 300ms rate limiting between calls (project convention)
**Warning signs:** Runs exceeding cost budget or taking hours

## Code Examples

### Section Decomposition from Page Chunks
```typescript
// wiki_pages already stores sectionHeading per chunk
// Group chunks into sections:
function groupChunksIntoSections(chunks: WikiPageRecord[]): Map<string | null, WikiPageRecord[]> {
  const sections = new Map<string | null, WikiPageRecord[]>();
  for (const chunk of chunks) {
    const heading = chunk.sectionHeading;
    if (!sections.has(heading)) sections.set(heading, []);
    sections.get(heading)!.push(chunk);
  }
  return sections;
}
```

### PR Evidence Query for a Page
```typescript
// Fetch all stored evidence for a page, ordered by recency
const evidence = await sql`
  SELECT pr_number, pr_title, pr_description, pr_author, merged_at,
         file_path, patch, issue_references, heuristic_score
  FROM wiki_pr_evidence
  WHERE matched_page_id = ${pageId}
  ORDER BY merged_at DESC
`;
```

### Grounding Generation Prompt
```typescript
function buildGroundedSectionPrompt(opts: {
  sectionHeading: string | null;
  sectionContent: string;
  patches: Array<{ prNumber: number; prTitle: string; patch: string }>;
}): string {
  const patchContext = opts.patches.map(p =>
    `### PR #${p.prNumber}: ${p.prTitle}\n\`\`\`diff\n${p.patch}\n\`\`\``
  ).join("\n\n");

  return `Update this wiki section based ONLY on the code changes shown below.

SECTION: ${opts.sectionHeading ?? "(Lead section)"}
${opts.sectionContent}

CODE CHANGES (from merged PRs):
${patchContext}

RULES:
1. Every factual change you make MUST cite the specific PR, e.g., "(PR #27901)"
2. Link PRs as: https://github.com/xbmc/xbmc/pull/NUMBER
3. If a change cannot be grounded in the patches above, DO NOT include it
4. Begin with 1-2 sentences explaining WHY this section needs updating
5. Output the COMPLETE updated section content (not a diff)
6. If the patches show no wiki-relevant changes for this section, respond with "NO_UPDATE"`;
}
```

### Suggestion DB Storage
```typescript
// Upsert suggestion with ON CONFLICT for idempotency
await sql`
  INSERT INTO wiki_update_suggestions (
    page_id, page_title, section_heading, original_content,
    suggestion, why_summary, grounding_status,
    citing_prs, voice_mismatch_warning, voice_scores,
    generated_at
  ) VALUES (
    ${pageId}, ${pageTitle}, ${sectionHeading}, ${originalContent},
    ${suggestion}, ${whySummary}, ${groundingStatus},
    ${JSON.stringify(citingPRs)}::jsonb, ${voiceMismatchWarning},
    ${JSON.stringify(voiceScores)}::jsonb, now()
  )
  ON CONFLICT (page_id, section_heading) DO UPDATE SET
    suggestion = EXCLUDED.suggestion,
    why_summary = EXCLUDED.why_summary,
    grounding_status = EXCLUDED.grounding_status,
    citing_prs = EXCLUDED.citing_prs,
    voice_mismatch_warning = EXCLUDED.voice_mismatch_warning,
    voice_scores = EXCLUDED.voice_scores,
    generated_at = EXCLUDED.generated_at
`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full-page rewrite suggestions | Section-level rewrite suggestions | v0.25 design | Better granularity, editors review per-section |
| Ungrounded LLM generation | Diff-grounded with PR citations | v0.25 design | Epistemic integrity, verifiable claims |
| Direct generation | Voice-preserving pipeline (Phase 125) | v0.25 Phase 125 | Style consistency with original wiki |

## Open Questions

1. **Staleness filter for popularity-ranked pages**
   - What we know: UPDATE-04 says "top 20 by popularity score." But not all popular pages are stale.
   - What's unclear: Should we process top 20 popular pages that ARE stale (intersect popularity with staleness results)? Or run staleness detection within the script?
   - Recommendation: Query staleness scan results (run `runScan()` or use latest run's results) and intersect with popularity top N. If fewer than 20 stale pages exist, process whatever is available. The script should accept `--top-n` flag defaulting to 20.

2. **Grounding check mechanism**
   - What we know: CONTEXT.md says "grounding enforced via prompt instructions (not a separate post-generation classifier)" and "if a suggestion fails the grounding check, drop it entirely"
   - What's unclear: How to programmatically verify a suggestion is grounded without a classifier
   - Recommendation: Lightweight heuristic: check that the generated text contains at least one `PR #NNNN` citation matching the input patches. If zero citations found, treat as ungrounded and drop. This is format validation, not classification.

3. **Why summary extraction**
   - What we know: Each suggestion needs "a brief 1-2 sentence summary of WHY the section needs updating before the full rewrite"
   - What's unclear: Should this be a separate LLM call or embedded in the main generation prompt?
   - Recommendation: Embed in the main generation prompt. Instruct the LLM to output `WHY: <summary>\n\n<updated section>`. Parse the WHY prefix in post-processing.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/knowledge/wiki-staleness-detector.ts` — staleness pipeline, heuristic scoring, PR evidence storage
- Codebase analysis: `src/knowledge/wiki-voice-analyzer.ts` — voice-preserving pipeline, `createVoicePreservingPipeline`, `SectionInput` type
- Codebase analysis: `src/knowledge/wiki-voice-validator.ts` — `generateWithVoicePreservation` function signature and flow
- Codebase analysis: `src/knowledge/wiki-staleness-types.ts` — `StalePage`, `PREvidence`, `WikiPageCandidate` types
- Codebase analysis: `src/knowledge/wiki-voice-types.ts` — `VoicePreservedUpdate`, `VoicePreservingPipelineOptions` types
- Codebase analysis: `src/knowledge/wiki-types.ts` — `WikiPageRecord`, `WikiPageStore` interface
- Codebase analysis: `src/knowledge/wiki-popularity-store.ts` — `PopularityRecord`, `getTopN()` method
- Codebase analysis: `src/db/migrations/022-wiki-pr-evidence.sql` — evidence table schema
- Codebase analysis: `src/llm/task-types.ts` — existing task type taxonomy
- Codebase analysis: `scripts/backfill-wiki.ts` — CLI script pattern

### Secondary (MEDIUM confidence)
- CONTEXT.md user decisions — locked design choices from Phase 123 discussion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all components already exist in codebase
- Architecture: HIGH - integration of existing modules with clear interfaces
- Pitfalls: HIGH - derived from codebase patterns and Phase 122/125 implementation experience

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (30 days — stable internal codebase patterns)