# Phase 123: Update Generation - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

LLM generates section-level rewrite suggestions for the top 20 stale wiki pages (by composite popularity score), grounded in actual code diff content from merged PRs. Each suggestion cites the specific PR(s) that motivated the change. Suggestions that cannot be grounded in verified diff content are excluded. Publishing is Phase 124.

</domain>

<decisions>
## Implementation Decisions

### Suggestion Granularity
- Decompose pages by MediaWiki section headings (== Heading == boundaries)
- Each section gets its own suggestion if stale; sections with no relevant PR evidence are skipped silently
- Suggestions are full rewritten sections (not change descriptions) — editors can copy-paste
- Wire Phase 125's voice-preserving pipeline (`generateWithVoicePreservation`) as the generation backend from day one

### Grounding & Citation Format
- Inline PR citations where the change is mentioned, e.g., "The audio pipeline now uses PipeWire (PR #27901)"
- Link to GitHub PR page (not file-specific diff links)
- Feed only relevant patches (matching the section being updated) to the LLM, not all patches for the page
- Each suggestion includes a brief 1-2 sentence summary of WHY the section needs updating before the full rewrite

### Inferred vs Grounded Filtering
- Strict grounding: every factual claim must trace to a specific PR patch
- Grounding enforced via prompt instructions (not a separate post-generation classifier)
- If a suggestion fails the grounding check, drop it entirely — don't include with warnings
- Skip sections where the diff shows no clear wiki-relevant impact (e.g., pure internal refactoring)

### Pipeline Orchestration
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

</decisions>

<specifics>
## Specific Ideas

- The staleness detector already produces `StalePage` results with `prNumber` and `changedFilePath` — use these as the starting point for evidence lookup
- Phase 125's `VoicePreservingPipelineOptions` expects a `generateSectionUpdate` callback — Phase 123 provides this callback with the grounded prompt
- The `wiki_pr_evidence` table (Phase 122) stores patches, PR metadata, and matched page IDs — query this for generation context
- Align with v0.24's epistemic philosophy: it's better to suggest nothing than to suggest something fabricated

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wiki-staleness-detector.ts`: `evaluateWithLlm()` already queries `wiki_pr_evidence` for patches — similar pattern needed for generation
- `wiki-voice-analyzer.ts`: `selectExemplarSections()` and `extractPageStyle()` for voice analysis
- `wiki-voice-validator.ts`: `generateWithVoicePreservation()` — the generation backend with voice matching and retry
- `wiki-voice-types.ts`: `VoicePreservedUpdate` type captures section suggestions with validation scores
- `wiki-popularity-store.ts`: composite popularity scoring for page ranking
- `generateWithFallback()` in `src/llm/generate.ts` for LLM calls with task routing

### Established Patterns
- Two-tier evaluation: heuristic pass then LLM evaluation (staleness detector)
- Fire-and-forget side effects with `.catch()` for non-critical operations
- `TASK_TYPES` taxonomy for model routing per task type
- Sequential processing with rate limiting (backfill scripts use 300ms delays)
- `ON CONFLICT` upsert pattern for idempotent writes

### Integration Points
- Input: `StalePage[]` from staleness detector's `runScan()` result, plus `wiki_pr_evidence` table
- Voice pipeline: `VoicePreservingPipelineOptions.generateSectionUpdate` callback
- Output: New `wiki_update_suggestions` table consumed by Phase 124
- Wiki page chunks: `WikiPageStore.getPageChunks()` for section content

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 123-update-generation*
*Context gathered: 2026-03-05*
