---
phase: 121-page-popularity
plan: 01
subsystem: database, knowledge
tags: [postgres, wiki, popularity, citation-tracking, retrieval-pipeline]

# Dependency graph
requires:
  - phase: 120-embedding-migration
    provides: wiki embedding infrastructure and voyage-context-3 support
provides:
  - wiki_page_popularity table for composite scoring
  - wiki_citation_events table for rolling-window citation tracking
  - Popularity config constants (weights, lambda, citation window)
  - WikiPopularityStore with CRUD for popularity and citation tables
  - Fire-and-forget citation logging in retrieval pipeline
affects: [121-02-PLAN, 122-wiki-staleness, 123-wiki-update-generation]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget-citation-logging, rolling-window-event-log, popularity-composite-scoring]

key-files:
  created:
    - src/db/migrations/020-wiki-page-popularity.sql
    - src/db/migrations/020-wiki-page-popularity.down.sql
    - src/db/migrations/021-wiki-citation-events.sql
    - src/db/migrations/021-wiki-citation-events.down.sql
    - src/knowledge/wiki-popularity-config.ts
    - src/knowledge/wiki-popularity-store.ts
  modified:
    - src/knowledge/retrieval.ts

key-decisions:
  - "Min-max normalization with zero-division guard for composite scoring"
  - "Deduplicate page_ids within single retrieval call before citation INSERT"
  - "Batch upsert popularity records in groups of 100 to avoid overly large queries"

patterns-established:
  - "Fire-and-forget pattern: void promise.catch() for non-blocking side effects in hot paths"
  - "Rolling-window event log: append-only table with periodic cleanup for time-bounded aggregation"

requirements-completed: [POP-02, POP-03]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 121 Plan 01: Wiki Popularity Schema and Citation Tracking Summary

**PostgreSQL schema for wiki page popularity scoring with fire-and-forget citation event logging in the retrieval pipeline**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T17:20:07Z
- **Completed:** 2026-03-03T17:21:50Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created wiki_page_popularity table with individual signal columns, composite score, and freshness tracking
- Created wiki_citation_events append-only log with indexes for rolling-window aggregation and cleanup
- Built config module with all weight constants, exponential decay lambda, and linkshere API settings
- Built popularity store with logCitations, getCitationCounts, cleanupOldCitations, upsertPopularity, getTopPages, getAll
- Instrumented retrieval pipeline with fire-and-forget citation logging after cross-corpus dedup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migrations, config module, and popularity store** - `3b0843879e` (feat)
2. **Task 2: Instrument retrieval pipeline with fire-and-forget citation logging** - `3cdcf08538` (feat)

## Files Created/Modified
- `src/db/migrations/020-wiki-page-popularity.sql` - Page popularity table with composite score and signal columns
- `src/db/migrations/020-wiki-page-popularity.down.sql` - Down migration for popularity table
- `src/db/migrations/021-wiki-citation-events.sql` - Citation event log table with rolling window indexes
- `src/db/migrations/021-wiki-citation-events.down.sql` - Down migration for citation events table
- `src/knowledge/wiki-popularity-config.ts` - Weight constants, decay lambda, citation window, linkshere settings, computeCompositeScore function
- `src/knowledge/wiki-popularity-store.ts` - Factory store with logCitations, getCitationCounts, cleanupOldCitations, upsertPopularity, getTopPages, getAll
- `src/knowledge/retrieval.ts` - Added optional wikiCitationLogger dep and fire-and-forget citation logging

## Decisions Made
- Min-max normalization with zero-division guard (return 0 when max === min) for composite scoring
- Deduplicate page_ids within a single retrieval call before citation INSERT to avoid inflated counts
- Batch upsert popularity records in groups of 100 to avoid overly large queries
- Citation logging placed after cross-corpus dedup to only count meaningful citations that survived filtering

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema and store ready for Plan 02 (linkshere fetcher, scorer, backfill script, scheduler)
- Citation events will begin accumulating as soon as `wikiCitationLogger` is wired into `createRetriever` caller in `src/index.ts`
- The caller (`src/index.ts`) needs to pass `wikiCitationLogger: popularityStore` when creating the retriever -- this wiring happens after the store is created and tested

---
*Phase: 121-page-popularity*
*Completed: 2026-03-03*
