# Phase 125: Voice-Preserving Updates - Context

**Gathered:** 2026-03-05 (updated)
**Status:** Ready for re-planning

<domain>
## Phase Boundary

When generating wiki page update suggestions (Phase 123's output), preserve the existing page's writing voice and tone while actively improving content quality — factual accuracy, formatting clarity, and readability. This phase modifies the update generation pipeline — it does not add new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Style extraction approach
- Use BOTH explicit style description AND few-shot examples combined for maximum fidelity
- First pass: LLM analyzes the page and produces a written style description (tone, perspective, conventions)
- Second component: 2-3 representative sections from the page included as style exemplars in the generation prompt
- **Content sampling**: Sample from beginning, middle, and end of the page to capture style variation (not just first ~3000 tokens)
- Per-page granularity (one style description per wiki page, not per-section)
- Exemplar selection: current logic (diversity scoring + evenly-spaced positions) is good — keep it
- **Wiki convention analysis**: Style extraction should explicitly catalog categories, interwiki links, navboxes, and other wiki-specific structural elements so they're preserved in output
- **Cache style descriptions with TTL**: Store in DB and reuse for N days; invalidate when page content changes. Reduces cost on repeated runs

### Formatting fidelity
- Preserve writing voice: heading levels, list styles, bold/italic patterns, link formats, whitespace between sections
- Wiki-specific markup (MediaWiki templates, infoboxes, magic words like `{{Note|...}}`) must be preserved verbatim — don't invent new templates or switch to markdown
- Suggestions presented as full section rewrites (not inline diffs) so reviewer sees exactly what the page would look like
- Match the specific section's voice conventions, not page majority
- **Post-generation template check**: After generation, verify all original `{{...}}` templates still appear in the output. If templates are missing, regenerate once with explicit feedback about which templates are missing. Drop the suggestion if second attempt also fails
- **Heuristic formatting element check**: Simple pattern check for novel formatting elements (e.g., if original has no code blocks but suggestion does, flag it) — but this is now advisory, not blocking, since formatting improvements are encouraged
- **Heading level validation**: Parse output for headings and verify they match the original section's heading levels. Flag mismatches

### Voice matching validation
- LLM self-evaluation pass compares generated suggestion against original sections
- 6-dimension scoring (1-5 each): tone, perspective, structure, terminology, formatting, markup preservation
- On failure: regenerate once with validation feedback injected into prompt; if still below threshold, publish with internal 'voice mismatch' warning tag
- Voice match score is internal only — not included in published suggestion comments

### Modernization boundary
- **Improve formatting freely**: Add code blocks, tables, bold emphasis, inline code, etc. wherever they make the content clearer. No restriction to existing formatting types — if code references should use inline code or commands should use code blocks, add them
- **Moderate normalization**: Normalize list markers (mixed `*` and `-` to one style), consistent code formatting, link style consistency within a section, heading capitalization
- **Replace deprecated content**: If old API X is now API Y, replace references with current equivalents — don't leave dead content
- Content updates only within existing sections — don't add, remove, or reorder sections
- **Suggest structural improvements as notes**: If a section seems too long or unwieldy after update, add a note like "Consider splitting this section" but don't do the split in the suggestion itself

### Claude's Discretion
- Voice match threshold value (what score triggers regeneration)
- Exact prompt structure for style extraction and generation
- How to select the 2-3 most representative sections for few-shot examples
- Validation feedback logging/storage approach (debug logs vs DB persistence)
- Style description cache TTL duration
- Which formatting improvements are clearly beneficial vs over-engineering

</decisions>

<specifics>
## Specific Ideas

The key shift from v1: suggestions should preserve the author's *voice* (how they write) while freely *improving* the content (what they write about and how it's formatted). Think of it as a knowledgeable editor who respects the author's style but cleans up the page where it helps readers.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WikiPageStore.getPageChunks(pageId)`: Retrieves all chunks for a page, ordered by chunk index — provides the raw page content for style analysis
- `WikiPageChunk` type: Has `sectionHeading`, `sectionAnchor`, `sectionLevel`, `chunkText` — section-level granularity already modeled
- `TaskRouter`: Existing LLM routing infrastructure for non-agentic tasks — style analysis and validation passes can use this
- `CostTracker`: Per-invocation cost tracking — additional LLM calls (style extraction, validation) will be tracked
- `wiki-voice-analyzer.ts`: Existing style extraction and exemplar selection — needs updating for spread sampling and wiki convention analysis
- `wiki-voice-validator.ts`: Existing 6-dimension validation — needs post-generation template/formatting checks added
- `wiki-update-generator.ts`: Existing pipeline integration — needs modernization boundary changes

### Established Patterns
- Two-tier evaluation: Used by wiki staleness detector (cheap heuristic first, LLM on flagged subset) — voice validation follows a similar two-pass pattern
- Fire-and-forget side effects: Used for citation logging — could apply to voice match metrics logging
- Task-type taxonomy with dot hierarchy (e.g., `staleness-evidence`) — voice tasks are `voice-extract`, `voice-validate`
- DELETE + INSERT pattern in storeSuggestion for handling NULL section_heading

### Integration Points
- Phase 123 (Update Generation): Voice preservation modifies the generation prompt and adds a validation pass — this is where the code changes land
- `wiki-staleness-detector.ts`: Provides `StalePage` candidates that feed into update generation
- `wiki-popularity-scorer.ts`: Provides top-N page ranking that determines which pages get processed
- Schema: May need `wiki_style_cache` table for style description TTL caching

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 125-voice-preserving-updates*
*Context gathered: 2026-03-05 (updated from 2026-03-03)*
