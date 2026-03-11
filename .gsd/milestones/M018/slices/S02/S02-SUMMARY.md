---
id: S02
parent: M018
milestone: M018
provides:
  - Backfill engine with MediaWiki API pagination, rate limiting, and embedding pipeline
  - CLI entry point (bun run backfill:wiki) with --source, --namespace, --dry-run flags
  - Resume-capable backfill via sync state tracking
  - Barrel exports for all wiki modules
  - wiki_pages table with pgvector embedding column, HNSW index, tsvector GIN index
  - wiki_sync_state table for backfill/sync progress tracking
  - WikiPageStore with write/read/search/delete operations
  - Section-based HTML-to-markdown chunker with 1024-token windows, 256-token overlap
  - WikiPageInput, WikiPageChunk, WikiPageRecord, WikiPageStore type definitions
  - Scheduled wiki sync via MediaWiki RecentChanges API (24h interval)
  - Wiki retrieval search module with source attribution
  - Wiki corpus fan-out in createRetriever() pipeline
  - Citation formatting in review prompt (Wiki Knowledge section)
  - Graceful shutdown support for sync scheduler
requires: []
affects: []
key_files: []
key_decisions:
  - "Used plain fetch instead of external MediaWiki library (no new dependencies)"
  - "Injectable fetchFn parameter for testing without real HTTP"
  - "500ms default delay between API requests for rate limiting"
  - "COALESCE(section_anchor, '') in UNIQUE constraint to handle NULL lead sections"
  - "Stale flag set automatically when chunk written without embedding"
  - "Section-based splitting preserves document structure unlike naive fixed-size"
  - "setInterval with 60s startup delay and 24h recurrence"
  - "Page deduplication in RecentChanges response via Set"
  - "Fail-open: wiki errors never block review pipeline"
  - "Citation format: [Wiki] Page > Section (source) (updated YYYY-MM)"
patterns_established:
  - "Wiki backfill: allpages pagination -> parse per page -> chunk -> embed -> store"
  - "CLI pattern mirrors backfill-review-comments.ts exactly"
  - "Wiki page chunking: HTML -> markdown -> section split -> sliding window -> prefix prepend"
  - "Wiki store: same factory pattern as createReviewCommentStore"
  - "Wiki sync: RecentChanges -> page-level revision check -> re-chunk -> embed -> replace"
  - "Wiki retrieval: mirrors searchReviewComments pattern exactly"
  - "Prompt section ordering: Retrieval > Review Precedents > Wiki Knowledge > Language Guidance"
observability_surfaces: []
drill_down_paths: []
duration: 12min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# S02: Mediawiki Content Ingestion

**# Plan 90-02: Backfill CLI with MediaWiki API Summary**

## What Happened

# Plan 90-02: Backfill CLI with MediaWiki API Summary

**MediaWiki API backfill engine with allpages/parse pagination, resume support, rate limiting, and CLI entry point**

## Performance

- **Duration:** 6 min
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 2

## Accomplishments
- Backfill engine fetches all pages from MediaWiki API with pagination
- Resume from last sync state on restart
- Rate limiting with configurable delay between requests
- Injectable fetch function for complete test isolation
- CLI with --source, --base-url, --namespace, --delay, --dry-run flags
- 9 unit tests passing without network access

## Task Commits

1. **Task 1: MediaWiki API backfill engine** - `527b56ce73` (feat)
2. **Task 2: CLI and barrel exports** - `0c55f9949f` (feat)

## Files Created/Modified
- `src/knowledge/wiki-backfill.ts` - Backfill engine with pagination and embedding
- `src/knowledge/wiki-backfill.test.ts` - 9 tests with mocked fetch
- `scripts/backfill-wiki.ts` - CLI entry point
- `src/knowledge/index.ts` - Added wiki module exports
- `package.json` - Added backfill:wiki script

## Decisions Made
- Used plain fetch instead of MediaWiki library to avoid new dependencies
- Injectable fetchFn for testing without real HTTP calls
- 500ms default delay between API requests

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backfill engine ready for production use
- Ready for retrieval integration and sync scheduler (Plan 03)

---
*Phase: 90-mediawiki-content-ingestion*
*Completed: 2026-02-25*

# Plan 90-01: Schema, Store, and Section-Based Chunker Summary

**PostgreSQL wiki_pages table with pgvector HNSW index, section-based HTML-to-markdown chunker with 1024/256 sliding window, and full WikiPageStore CRUD**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files created:** 7

## Accomplishments
- Migration 006 creates wiki_pages and wiki_sync_state tables with all required indexes
- Section-based chunker splits at heading boundaries with sliding window for large sections
- HTML-to-markdown strips tags, preserves code blocks, converts tables to text rows
- Page title + section heading prepended as context prefix for better embedding quality
- Full WikiPageStore with vector search, namespace filtering, and sync state tracking

## Task Commits

1. **Task 1: Schema migration and type definitions** - `abc9b65664` (feat)
2. **Task 2: Wiki page store and section-based chunker** - `582812784b` (feat)

## Files Created/Modified
- `src/db/migrations/006-wiki-pages.sql` - wiki_pages + wiki_sync_state tables
- `src/db/migrations/006-wiki-pages.down.sql` - Rollback migration
- `src/knowledge/wiki-types.ts` - Type definitions for all wiki page types and store interface
- `src/knowledge/wiki-store.ts` - PostgreSQL store with vector search, CRUD, sync state
- `src/knowledge/wiki-store.test.ts` - Store tests (pgvector integration)
- `src/knowledge/wiki-chunker.ts` - Section-based chunker with HTML-to-markdown
- `src/knowledge/wiki-chunker.test.ts` - 23 tests for chunker, all passing

## Decisions Made
- Used COALESCE(section_anchor, '') in unique constraint to handle NULL anchors for lead sections
- Stale flag set to true when chunk written without embedding (backfill will fill embeddings)
- Reused same HNSW tuning (m=16, ef_construction=64) as review_comments and learning_memories

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema and store layer complete, ready for backfill engine (Plan 02)
- Chunker tested and verified with 23 passing tests
- Store interface matches the contract expected by backfill and retrieval modules

---
*Phase: 90-mediawiki-content-ingestion*
*Completed: 2026-02-25*

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
