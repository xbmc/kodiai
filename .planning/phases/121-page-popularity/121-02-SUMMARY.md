---
phase: 121-page-popularity
plan: 02
subsystem: knowledge
tags: [mediawiki, linkshere, popularity-scoring, composite-score, scheduler, backfill]

# Dependency graph
requires:
  - phase: 121-page-popularity-01
    provides: wiki_page_popularity table, wiki_citation_events table, popularity config, popularity store
provides:
  - MediaWiki linkshere API client with batching and pagination
  - Composite popularity scorer with weekly scheduler
  - One-time backfill script for initial score population
affects: [122-wiki-staleness, 123-wiki-update-generation]

# Tech tracking
tech-stack:
  added: []
  patterns: [linkshere-api-batched-fetch, composite-popularity-scoring, scheduler-start-stop-runNow]

key-files:
  created:
    - src/knowledge/wiki-linkshere-fetcher.ts
    - src/knowledge/wiki-popularity-scorer.ts
    - src/knowledge/wiki-popularity-backfill.ts
  modified: []

key-decisions:
  - "Default to 365 days since edit when last_modified is null or zero"
  - "Scorer uses direct SQL DISTINCT ON query for page dedup rather than WikiPageStore methods"

patterns-established:
  - "Linkshere batched fetch: batch pageIds, paginate lhcontinue, cap per-page accumulation, fail-open per batch"

requirements-completed: [POP-01, POP-03, POP-04]

# Metrics
duration: 2min
completed: 2026-03-03
---

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
