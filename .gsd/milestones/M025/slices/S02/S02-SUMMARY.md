---
id: S02
parent: M025
milestone: M025
provides:
  - Application bootstrap wiring for popularity store, citation logger, and scorer scheduler
  - Production citation accumulation via wikiCitationLogger in retrieval pipeline
  - Weekly automated popularity score refresh via scorer scheduler
  - MediaWiki linkshere API client with batching and pagination
  - Composite popularity scorer with weekly scheduler
  - One-time backfill script for initial score population
  - wiki_page_popularity table for composite scoring
  - wiki_citation_events table for rolling-window citation tracking
  - Popularity config constants (weights, lambda, citation window)
  - WikiPopularityStore with CRUD for popularity and citation tables
  - Fire-and-forget citation logging in retrieval pipeline
requires: []
affects: []
key_files: []
key_decisions:
  - "Popularity store declared unconditionally (lightweight, no connections) so both retriever and scorer can access it"
  - "Scorer starts unconditionally when wikiPageStore exists (not gated on Slack config unlike staleness detector)"
  - "Default to 365 days since edit when last_modified is null or zero"
  - "Scorer uses direct SQL DISTINCT ON query for page dedup rather than WikiPageStore methods"
  - "Min-max normalization with zero-division guard for composite scoring"
  - "Deduplicate page_ids within single retrieval call before citation INSERT"
  - "Batch upsert popularity records in groups of 100 to avoid overly large queries"
patterns_established:
  - "Scheduler wiring: import, shutdown ref, stop call, create, start, assign ref, log"
  - "Linkshere batched fetch: batch pageIds, paginate lhcontinue, cap per-page accumulation, fail-open per batch"
  - "Fire-and-forget pattern: void promise.catch() for non-blocking side effects in hot paths"
  - "Rolling-window event log: append-only table with periodic cleanup for time-bounded aggregation"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-03-03
blocker_discovered: false
---
# S02: Page Popularity

**# Phase 121 Plan 03: Application Bootstrap Wiring Summary**

## What Happened

# Phase 121 Plan 03: Application Bootstrap Wiring Summary

**Wired wiki popularity store as citation logger into retrieval pipeline and started weekly popularity scorer on boot**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-03T18:19:17Z
- **Completed:** 2026-03-03T18:20:31Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Popularity store created and passed as wikiCitationLogger to createRetriever -- citation events now accumulate in production
- Wiki popularity scorer instantiated with weekly schedule and started on application boot
- Shutdown ref stored and stopped on graceful shutdown for clean lifecycle management

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire popularity store, citation logger, and scorer into application bootstrap** - `37a27f6bf8` (feat)

## Files Created/Modified
- `src/index.ts` - Added imports, shutdown ref, stop call, popularityStore creation, wikiCitationLogger wiring, and scorer bootstrap

## Decisions Made
- Popularity store declared unconditionally outside the `isolationLayer && embeddingProvider` conditional so both the retriever and scorer can access it (store is lightweight with no connections)
- Scorer starts unconditionally (not gated on slackWikiChannelId) since popularity scoring is independent of Slack integration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 121 (Page Popularity) is now fully complete: schema, store, scorer, backfill, and bootstrap wiring all in place
- Ready for Phase 122 and beyond

---
*Phase: 121-page-popularity*
*Completed: 2026-03-03*

# Phase 121 Plan 02: Linkshere Fetcher, Popularity Scorer, and Backfill Summary

**MediaWiki linkshere API fetcher with batched pagination, composite popularity scorer on weekly scheduler, and CLI backfill script for initial score population**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T17:24:13Z
- **Completed:** 2026-03-03T17:26:07Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Built linkshere fetcher with batching (50 per request), pagination (lhcontinue), rate limiting (500ms), namespace filtering (main only), and per-page cap (5000)
- Built composite scorer combining all three signals (inbound links 0.3, citation frequency 0.5, edit recency 0.2) with min-max normalization and weekly scheduled refresh
- Created standalone backfill script that runs scoring and prints top 10 pages for verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Create linkshere fetcher and popularity scorer with scheduler** - `6ae9abe8e1` (feat)
2. **Task 2: Create backfill script and wire scorer into application startup** - `0980ea19af` (feat)

## Files Created/Modified
- `src/knowledge/wiki-linkshere-fetcher.ts` - MediaWiki linkshere API client with batching, pagination, rate limiting, and fail-open error handling
- `src/knowledge/wiki-popularity-scorer.ts` - Composite scorer factory with start/stop/runNow scheduler following staleness detector pattern
- `src/knowledge/wiki-popularity-backfill.ts` - CLI-runnable script that creates scorer, runs scoring, and prints top 10 pages

## Decisions Made
- Default to 365 days since edit when last_modified is null or zero (assumes very old page rather than penalizing with infinite age)
- Used direct SQL DISTINCT ON query in scorer to get unique pages from chunked wiki_pages table, since WikiPageStore does not expose a listDistinctPages method
- Scorer wiring into app startup documented as carry-forward (scorer is usable now via backfill script and programmatic runNow)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three popularity scoring modules complete and compilable
- Backfill script ready to run: `bun run src/knowledge/wiki-popularity-backfill.ts`
- **Carry-forward:** Scorer's `start()` needs to be called in app bootstrap (similar to wiki-staleness-detector). This is a lightweight wiring task for the next phase or a quick task.
- **Carry-forward:** `wikiCitationLogger` needs to be wired into `createRetriever` caller in `src/index.ts` to begin accumulating citation events

---
*Phase: 121-page-popularity*
*Completed: 2026-03-03*

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
