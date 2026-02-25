# Phase 92: Wire Unified Retrieval to All Consumers - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Close all audit gaps by wiring unified retrieval output to mention handler, review retry, and code BM25. Update mention-prompt.ts to format unified context in @mention responses. Fix review retry to pass full unified context. Pass learningMemoryStore to createRetriever() for hybrid search. Update REQUIREMENTS.md checkboxes for satisfied-but-unchecked requirements (KI-07–10, KI-15–19).

</domain>

<decisions>
## Implementation Decisions

### Mention context formatting
- Use inline citations — weave wiki/review references naturally into @mention responses with [source] markers
- Differentiate source types: cite wiki as [wiki: Article Name] and reviews as [review: PR #123]
- Inject top-k relevant chunks into the mention prompt (not full context window, not summaries)
- Silent fallback when retrieval returns no wiki/review hits — answer from code context alone, no empty citation sections

### Review retry context preservation
- Reuse cached context from the first attempt on retry (don't rebuild fresh)
- Detect degraded results: if any corpus returned empty/error on first pass, selectively re-fetch only those on retry
- Simplified subset of unified context fields acceptable on retry path — doesn't need to match initial path exactly
- Final fallback: if retry with unified context still fails, attempt review with just the code diff (graceful degradation)

### Code corpus hybrid search
- Use RRF (Reciprocal Rank Fusion) for merging BM25+vector results — consistent with Phase 91's cross-corpus engine
- Fall back to vector-only if BM25 index not available (learningMemoryStore not initialized)
- Rely on unified retrieval's cross-corpus deduplication — no separate dedup within code corpus
- learningMemoryStore parameter is optional in createRetriever() — enhances with hybrid when provided, vector-only when absent

### Requirements checkbox cleanup
- Verify each requirement is actually satisfied before checking the box (don't blindly trust the audit)
- If verification finds a requirement not yet satisfied, fix it within this phase
- Checkbox updates in a separate commit from wiring code changes (clean audit trail)
- Include a verification summary log documenting which requirements were checked and what was verified

### Claude's Discretion
- Exact top-k count for mention context injection
- Cache implementation strategy for retry context
- Degraded-result detection mechanism
- Verification summary format and location

</decisions>

<specifics>
## Specific Ideas

- RRF merging for code corpus should reuse the same engine built in Phase 91 — no new merging logic
- Citation format: [wiki: Name] and [review: PR #123] to differentiate source types clearly
- Retry cache should be smart enough to detect partial results (not just empty) for selective re-fetch

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 92-wire-unified-retrieval-consumers*
*Context gathered: 2026-02-24*
