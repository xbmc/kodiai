---
phase: 90-mediawiki-content-ingestion
plan: 01
subsystem: database
tags: [postgresql, pgvector, mediawiki, chunking, html-to-markdown]

requires:
  - phase: 86-postgresql-pgvector-on-azure
    provides: PostgreSQL + pgvector infrastructure, migration runner, DB client factory
provides:
  - wiki_pages table with pgvector embedding column, HNSW index, tsvector GIN index
  - wiki_sync_state table for backfill/sync progress tracking
  - WikiPageStore with write/read/search/delete operations
  - Section-based HTML-to-markdown chunker with 1024-token windows, 256-token overlap
  - WikiPageInput, WikiPageChunk, WikiPageRecord, WikiPageStore type definitions
affects: [90-mediawiki-content-ingestion, 91-cross-corpus-retrieval-integration]

tech-stack:
  added: []
  patterns:
    - "Wiki store factory: createWikiPageStore({ sql, logger }) returning typed interface"
    - "Section-based chunking: split at headings, sliding window within large sections"
    - "Title+section prefix prepending for embedding context"
    - "HTML-to-markdown: strip tags, preserve code blocks, convert tables to text"
    - "COALESCE sentinel for NULL section_anchor in unique constraint"

key-files:
  created:
    - src/db/migrations/006-wiki-pages.sql
    - src/db/migrations/006-wiki-pages.down.sql
    - src/knowledge/wiki-types.ts
    - src/knowledge/wiki-store.ts
    - src/knowledge/wiki-store.test.ts
    - src/knowledge/wiki-chunker.ts
    - src/knowledge/wiki-chunker.test.ts

key-decisions:
  - "COALESCE(section_anchor, '') in UNIQUE constraint to handle NULL lead sections"
  - "Stale flag set automatically when chunk written without embedding"
  - "Section-based splitting preserves document structure unlike naive fixed-size"

patterns-established:
  - "Wiki page chunking: HTML -> markdown -> section split -> sliding window -> prefix prepend"
  - "Wiki store: same factory pattern as createReviewCommentStore"

requirements-completed: [KI-07, KI-08, KI-09]

duration: 8min
completed: 2026-02-25
---

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
