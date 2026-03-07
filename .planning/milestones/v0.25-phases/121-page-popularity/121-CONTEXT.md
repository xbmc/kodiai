# Phase 121: Page Popularity - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Every wiki page gets a composite popularity score combining inbound links, citation frequency, and edit recency, enabling principled top-N page selection. This phase builds the scoring infrastructure and data pipeline — it does NOT change how retrieval results are ranked or filtered (that's downstream consumer logic).

</domain>

<decisions>
## Implementation Decisions

### Score storage
- Separate `wiki_page_popularity` table with `page_id` FK — not columns on `wiki_pages` (which is chunked, many rows per page)
- One row per page_id, updated in-place on each refresh
- Store all individual signals AND composite score: `inbound_links` (int), `citation_count` (int), `edit_recency_score` (float), `composite_score` (float)
- Include metadata columns: `last_scored_at`, `last_linkshere_fetch`, `last_citation_reset` — granular freshness tracking per signal source

### Citation tracking
- Instrument the retrieval pipeline in `retrieval.ts` — after cross-corpus RRF, increment citation count for wiki pages that appeared in results
- Only count pages that survive the adaptive threshold (meaningful citations, not noise)
- Lightweight event log table: `(page_id, cited_at)` per retrieval hit — enables rolling window aggregation
- Rolling 90-day window for citation counts (aligns with Phase 122's 90-day PR scan window)

### Composite formula
- Weighted normalized sum: normalize each signal to 0-1 range, then `w1*links + w2*citations + w3*recency`
- Default weights: citations heaviest — links=0.3, citations=0.5, recency=0.2
- Weights defined as config constants in a dedicated module (not env vars) — easy to tune, importable by Phase 122+
- Edit recency uses exponential decay from `last_modified`: `score = e^(-lambda * days_since_edit)`
- All pages scored regardless of zero signals — a page with high citations but no inbound links is still valuable

### Refresh cadence
- Scheduled job using wiki-staleness-detector's scheduler pattern — runs independently of retrieval
- Weekly interval (matching staleness detector cycle)
- Full refresh of linkshere API data each run (wiki isn't huge, simpler than incremental)
- Separate one-time backfill script for initial population (same pattern as `wiki-backfill.ts`)

### Claude's Discretion
- Exact normalization approach (min-max vs percentile rank)
- Lambda value for exponential decay
- API rate limiting / batching strategy for linkshere calls
- Migration file numbering and exact column types
- Backfill script CLI interface

</decisions>

<specifics>
## Specific Ideas

- Citation window of 90 days intentionally aligns with Phase 122's PR scan window — keeps the time horizons consistent across the pipeline
- Scheduler pattern should mirror `wiki-staleness-detector.ts` structure for codebase consistency

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wiki-staleness-detector.ts`: Scheduler pattern (interval, startup delay, run state persistence) — reuse for popularity scorer
- `wiki-store.ts` / `WikiPageStore`: Page CRUD and search — query `last_modified` for recency signal
- `wiki-sync.ts`: MediaWiki API fetching patterns — reuse for `linkshere` API calls
- `wiki-backfill.ts`: Backfill script pattern — reuse for initial popularity population
- `retrieval.ts` + `cross-corpus-rrf.ts`: Integration point for citation tracking instrumentation

### Established Patterns
- PostgreSQL with `postgres` (Sql type from `db/client.ts`) for all data access
- Factory function pattern (`createXxxStore`) returning interface objects
- Run state persistence table for scheduled jobs (`wiki_staleness_run_state` pattern)
- Migration files in `src/db/migrations/` with numbered naming

### Integration Points
- `retrieval.ts`: After adaptive threshold filtering, log citation events for wiki pages in results
- `wiki_pages` table: Read `page_id` and `last_modified` for recency calculation
- `wiki_sync_state` / `wiki-sync.ts`: Source of truth for which pages exist
- Downstream: Phase 122 (staleness) and Phase 123 (update generation) consume top-N by composite score

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 121-page-popularity*
*Context gathered: 2026-03-03*
