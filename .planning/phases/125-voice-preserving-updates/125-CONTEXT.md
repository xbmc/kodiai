# Phase 125: Voice-Preserving Updates - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

When generating wiki page update suggestions (Phase 123's output), preserve the existing page's formatting conventions, writing voice, tone, and style so edits read as natural continuations rather than AI-generated insertions. This phase modifies the update generation pipeline — it does not add new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Style extraction approach
- Use BOTH explicit style description AND few-shot examples combined for maximum fidelity
- First pass: LLM analyzes the page and produces a written style description (tone, perspective, conventions)
- Second component: 2-3 representative sections from the page included as style exemplars in the generation prompt
- Per-page granularity (one style description per wiki page, not per-section)
- Style descriptions regenerated each run — no caching or schema changes needed

### Formatting fidelity
- Preserve ALL visible formatting: heading levels, list styles, code blocks, bold/italic patterns, link formats, whitespace between sections
- Wiki-specific markup (MediaWiki templates, infoboxes, magic words like `{{Note|...}}`) must be preserved verbatim — don't invent new templates or switch to markdown
- Suggestions presented as full section rewrites (not inline diffs) so reviewer sees exactly what the page would look like
- Match the specific section's conventions, not page majority — if section 3 uses bullets and section 5 uses numbered lists, each section's suggestion mirrors its own pattern

### Voice matching validation
- LLM self-evaluation pass compares generated suggestion against original sections
- Comprehensive check: tone (formal/informal), perspective (second person/imperative), sentence structure, terminology consistency, formatting conventions
- On failure: regenerate once with validation feedback injected into prompt; if still below threshold, publish with internal 'voice mismatch' warning tag
- Voice match score is internal only — not included in published suggestion comments

### Modernization boundary
- Update factual content: fix version numbers, API names, deprecated references to current values (these are errors, not style)
- Gently normalize obvious formatting inconsistencies (capitalization, spacing) while keeping overall voice
- Only use formatting elements the page already uses — don't introduce code blocks, tables, etc. that the page doesn't have
- Content updates only within existing sections — don't add, remove, or reorder sections

### Claude's Discretion
- Voice match threshold value (what score triggers regeneration)
- Exact prompt structure for style extraction and generation
- How to select the 2-3 most representative sections for few-shot examples
- Internal logging and metrics for voice match quality tracking

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The key principle is that generated suggestions should be indistinguishable from what the original page author would have written.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WikiPageStore.getPageChunks(pageId)`: Retrieves all chunks for a page, ordered by chunk index — provides the raw page content for style analysis
- `WikiPageChunk` type: Has `sectionHeading`, `sectionAnchor`, `sectionLevel`, `chunkText` — section-level granularity already modeled
- `TaskRouter`: Existing LLM routing infrastructure for non-agentic tasks — style analysis and validation passes can use this
- `CostTracker`: Per-invocation cost tracking — additional LLM calls (style extraction, validation) will be tracked

### Established Patterns
- Two-tier evaluation: Used by wiki staleness detector (cheap heuristic first, LLM on flagged subset) — voice validation follows a similar two-pass pattern
- Fire-and-forget side effects: Used for citation logging — could apply to voice match metrics logging
- Task-type taxonomy with dot hierarchy (e.g., `staleness-evidence`) — voice tasks could be `voice-extract`, `voice-validate`

### Integration Points
- Phase 123 (Update Generation): Voice preservation modifies the generation prompt and adds a validation pass — this is where the code changes land
- `wiki-staleness-detector.ts`: Provides `StalePage` candidates that feed into update generation
- `wiki-popularity-scorer.ts`: Provides top-N page ranking that determines which pages get processed

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 125-voice-preserving-updates*
*Context gathered: 2026-03-03*
