---
phase: 90-mediawiki-content-ingestion
plan: 03
subsystem: retrieval
tags: [mediawiki, sync, retrieval, citations, wiki]

requires:
  - phase: 90-mediawiki-content-ingestion
    provides: WikiPageStore, wiki-chunker, wiki-backfill
provides:
  - Scheduled wiki sync via MediaWiki RecentChanges API (24h interval)
  - Wiki retrieval search module with source attribution
  - Wiki corpus fan-out in createRetriever() pipeline
  - Citation formatting in review prompt (Wiki Knowledge section)
  - Graceful shutdown support for sync scheduler
affects: [90-mediawiki-content-ingestion]

tech-stack:
  added: []
  patterns:
    - "MediaWiki RecentChanges API for incremental sync"
    - "setInterval-based scheduler with startup delay"
    - "Fail-open wiki retrieval alongside review comments"
    - "Citation formatting with freshness indicators"

key-files:
  created:
    - src/knowledge/wiki-sync.ts
    - src/knowledge/wiki-sync.test.ts
    - src/knowledge/wiki-retrieval.ts
    - src/knowledge/wiki-retrieval.test.ts
  modified:
    - src/knowledge/retrieval.ts
    - src/execution/review-prompt.ts
    - src/handlers/review.ts
    - src/index.ts
    - src/knowledge/index.ts

key-decisions:
  - "setInterval with 60s startup delay and 24h recurrence"
  - "Page deduplication in RecentChanges response via Set"
  - "Fail-open: wiki errors never block review pipeline"
  - "Citation format: [Wiki] Page > Section (source) (updated YYYY-MM)"

patterns-established:
  - "Wiki sync: RecentChanges -> page-level revision check -> re-chunk -> embed -> replace"
  - "Wiki retrieval: mirrors searchReviewComments pattern exactly"
  - "Prompt section ordering: Retrieval > Review Precedents > Wiki Knowledge > Language Guidance"

requirements-completed: [KI-10, KI-11, KI-12]

duration: 12min
completed: 2026-02-25
---

# Plan 90-03: Sync, Retrieval, and Citation Summary

**Daily incremental sync, wiki search integration, and citation formatting in review prompts**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files created:** 4
- **Files modified:** 5

## Accomplishments
- Scheduled sync using MediaWiki RecentChanges API with page deduplication
- Wiki retrieval module with distance threshold filtering and source attribution
- Updated createRetriever() with wikiPageStore optional dependency and parallel fan-out
- RetrieveResult now includes wikiKnowledge array and wikiPageCount provenance
- formatWikiKnowledge() generates Wiki Knowledge prompt section with inline citations
- Review handler passes wikiKnowledge through to both buildReviewPrompt call sites
- App wiring: wiki page store created, passed to retriever, sync scheduler started
- Graceful shutdown stops wiki sync scheduler before closing DB

## Task Commits

1. **Task 1: Wiki sync scheduler and retrieval module** - `1fd37ac7cd` (feat)
2. **Task 2: Retrieval pipeline integration and citations** - `8dd9b9b924` (feat)

## Files Created/Modified
- `src/knowledge/wiki-sync.ts` - Scheduled sync with RecentChanges API
- `src/knowledge/wiki-sync.test.ts` - 8 tests for sync scheduler
- `src/knowledge/wiki-retrieval.ts` - Wiki search with source attribution
- `src/knowledge/wiki-retrieval.test.ts` - 10 tests for wiki retrieval
- `src/knowledge/retrieval.ts` - Added wikiPageStore dep and wiki fan-out
- `src/execution/review-prompt.ts` - Added formatWikiKnowledge and Wiki Knowledge section
- `src/handlers/review.ts` - Captures and passes wikiKnowledge to prompt builder
- `src/index.ts` - Wiki store creation, retriever wiring, sync scheduler lifecycle
- `src/knowledge/index.ts` - Added wiki retrieval and sync barrel exports

## Decisions Made
- Used setInterval with 60s startup delay (not external scheduler)
- RecentChanges API with page-level dedup handles multi-edit scenarios
- Citation format matches plan spec: `[Wiki] Title > Section (source) (updated YYYY-MM)`
- Fail-open: all wiki errors are warn-logged and return empty results

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - sync scheduler starts automatically when embedding provider is available.

## Next Phase Readiness
- Phase 90 fully complete: schema, store, chunker, backfill, sync, retrieval, citations
- Ready for Phase 91: Cross-Corpus Retrieval Integration

---
*Phase: 90-mediawiki-content-ingestion*
*Completed: 2026-02-25*
