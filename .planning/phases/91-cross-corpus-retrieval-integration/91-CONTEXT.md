# Phase 91: Cross-Corpus Retrieval Integration - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Unified retrieval layer that fan-outs queries across code, review comments, and wiki corpora with hybrid search (BM25 + vector), Reciprocal Rank Fusion, source-aware re-ranking, result attribution, deduplication, and context assembly. Depends on Phase 89 (review comment ingestion) and Phase 90 (wiki content ingestion).

</domain>

<decisions>
## Implementation Decisions

### Ranking Strategy
- Context-dependent source weighting: weight depends on trigger (PR reviews weight code+reviews higher, issue Q&A weights wiki higher)
- Hybrid search combines BM25 and vector via RRF (not weighted linear combination)
- Standard RRF k-parameter of 60 (industry standard from original paper)
- Mild recency boost: recent results get a small bonus (10-20% for last 30 days), but old highly-relevant results still surface

### Result Attribution UX
- Inline source labels woven into response text: `[wiki: Page Title]`, `[review: PR #1234]`, `[code: file.ts]`
- Every citation is a clickable markdown link to the source (wiki URL, GitHub PR URL, code file URL)
- When multiple sources agree: cite the strongest source, briefly mention others ("also referenced in [review: PR #456]")
- Soft cap of 5-8 citations per response to avoid clutter

### Query Fan-Out Behavior
- All three corpus queries fire in parallel every time (no smart gating)
- When a corpus has no data: gracefully skip but add a subtle note in response ("Note: wiki corpus not yet available")
- Shared token budget for context assembly: top-ranked chunks fill the budget regardless of source type (no reserved per-corpus slots)

### Deduplication
- Dedup happens before rank fusion (within each corpus, to prevent duplicates from inflating a corpus's RRF contribution)
- Cosine similarity threshold: Claude's discretion based on testing with actual corpus data
- When duplicates found: keep the highest-ranked chunk (pure quality wins, source type irrelevant)
- Surviving chunks annotated with alternate sources that had near-duplicates ("also found in wiki")

### Claude's Discretion
- Exact cosine similarity threshold for dedup (start around 0.90, tune based on corpus testing)
- Implementation of the recency boost formula
- Token budget size for context assembly
- Error handling and timeout strategy for parallel queries

</decisions>

<specifics>
## Specific Ideas

- End-to-end test: a PR review response should cite code context + human review precedent + wiki page in one response
- The context-dependent weighting should feel natural — not a hard switch, more like a gradient based on the trigger type
- "No retrieval path bypasses the unified layer" — all existing retrieval consumers must go through this

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 91-cross-corpus-retrieval-integration*
*Context gathered: 2026-02-24*
