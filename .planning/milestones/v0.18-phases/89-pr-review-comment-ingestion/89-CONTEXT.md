# Phase 89: PR Review Comment Ingestion - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Backfill 18 months of human review comments from xbmc/xbmc, embed them into PostgreSQL with pgvector, and make them available as a retrieval source. The bot should be able to cite human review precedents in its responses. Cross-corpus ranking and unified retrieval are Phase 91.

</domain>

<decisions>
## Implementation Decisions

### Backfill strategy
- CLI command (e.g., `npm run backfill:reviews`) — one-shot manual execution
- Cursor-based resume: track last fetched page/timestamp so re-running picks up where it left off
- Throttled at ~50% of GitHub rate limit (~2500 req/hour) to leave room for normal bot operations
- Verbose logging: log every batch with counts, PR numbers, and running totals

### Chunking boundaries
- Hybrid chunking: group thread replies into one chunk if it fits the token window; split into overlapping chunks if too long
- Larger sliding windows: 1024 tokens with 256 overlap (user preference over roadmap's 512/128)
- Filter out bot PRs: skip PRs opened by known bots (dependabot, renovate, kodiai, etc.) — focus on human-to-human review patterns
- Metadata: Claude's discretion on what travels with each chunk (roadmap baseline: PR number, file, line range, author, date — Claude may add PR title, labels, or diff snippets if it improves retrieval quality)

### Incremental sync
- Ingest on new comments as well as PR close/merge — not just closed PRs
- Re-embed on edit, soft-delete on delete — track comment lifecycle
- Queue for async processing: acknowledge webhook immediately, process embedding in background
- CLI sub-command for manual re-sync of a specific PR (e.g., `npm run sync:reviews -- --pr 1234`)

### Retrieval surfacing
- Inline citations: weave review precedents into response text (e.g., "reviewers have previously flagged this pattern (PR #1234, @author)")
- Only cite strong matches — don't force precedents where similarity is low
- Design for multi-repo: store repo info in metadata so retrieval can span repos later without schema changes
- Initial weighting of review comments vs code context: Claude's discretion, with expectation that Phase 91 will tune cross-corpus weights

### Claude's Discretion
- Exact metadata fields per chunk (beyond roadmap baseline)
- Initial similarity threshold for "strong match" citations
- Weighting of review comments relative to code context (Phase 91 adjusts later)
- Async queue implementation (in-process vs external)
- Bot author detection heuristic

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches that fit existing codebase patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 89-pr-review-comment-ingestion*
*Context gathered: 2026-02-24*
