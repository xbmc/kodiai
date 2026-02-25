---
phase: 89-pr-review-comment-ingestion
plan: 01
subsystem: database
tags: [postgres, pgvector, hnsw, tsvector, review-comments, chunking]

requires:
  - phase: initial-schema
    provides: "PostgreSQL schema with pgvector, learning_memories table, HNSW index pattern"
provides:
  - "review_comments table with pgvector embedding column, HNSW index, tsvector GIN index"
  - "review_comment_sync_state table for cursor-based backfill resume"
  - "ReviewCommentStore with write/read/search/softDelete/syncState operations"
  - "Thread-aware chunker with 1024-token windows and 256-token overlap"
  - "Bot filtering for review comment ingestion"
affects: [89-02, 89-03, 89-04, 91-cross-corpus-retrieval]

tech-stack:
  added: []
  patterns: [thread-aware-chunking, sliding-window-overlap, bot-filtering, factory-store-pattern]

key-files:
  created:
    - src/db/migrations/005-review-comments.sql
    - src/db/migrations/005-review-comments.down.sql
    - src/knowledge/review-comment-types.ts
    - src/knowledge/review-comment-chunker.ts
    - src/knowledge/review-comment-chunker.test.ts
    - src/knowledge/review-comment-store.ts
    - src/knowledge/review-comment-store.test.ts
  modified: []

key-decisions:
  - "Whitespace-based token counting (no external tokenizer dependency) for chunking"
  - "Factory pattern (createReviewCommentStore) consistent with existing createLearningMemoryStore"
  - "ON CONFLICT DO NOTHING for idempotent backfill writes"
  - "Bot filtering via configurable login set plus [bot] suffix pattern"

patterns-established:
  - "Thread-aware chunking: concatenate reply chains with author attribution, sliding window when >1024 tokens"
  - "Review comment store factory: createReviewCommentStore({ sql, logger }) returning typed interface"

requirements-completed: [KI-01, KI-02, KI-03]

duration: 2min
completed: 2026-02-25
---

# Phase 89 Plan 01: Review Comment Schema and Store Summary

**PostgreSQL review_comments table with pgvector HNSW index, thread-aware 1024/256 chunker, and full CRUD store with vector similarity search**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-25T03:25:00Z
- **Completed:** 2026-02-25T03:27:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- review_comments table with full metadata columns, embedding vector(1024), HNSW index, tsvector GIN index, and all query-pattern indexes
- review_comment_sync_state table for cursor-based backfill/incremental sync resume
- Thread-aware chunker with 1024-token sliding windows, 256-token overlap, and configurable bot filtering
- Full ReviewCommentStore implementation with writeChunks, softDelete, updateChunks, searchByEmbedding, thread retrieval, and sync state CRUD
- 23 tests (13 chunker + 10 store integration) all passing alongside full suite of 1152 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Create review_comments schema migration and type definitions** - `5454d8c289` (feat)
2. **Task 2: Implement review comment store and thread-aware chunker** - `3e63b63eb9` (feat)

## Files Created/Modified

- `src/db/migrations/005-review-comments.sql` - review_comments table + review_comment_sync_state table with all indexes
- `src/db/migrations/005-review-comments.down.sql` - Clean rollback dropping tables, triggers, functions, indexes
- `src/knowledge/review-comment-types.ts` - ReviewCommentInput, ReviewCommentChunk, ReviewCommentRecord, ReviewCommentStore interface, SyncState
- `src/knowledge/review-comment-chunker.ts` - Thread-aware chunking with sliding window and bot filtering
- `src/knowledge/review-comment-chunker.test.ts` - 13 tests covering single/multi/oversized threads, bot filtering, overlap
- `src/knowledge/review-comment-store.ts` - PostgreSQL store with pgvector search, following createLearningMemoryStore pattern
- `src/knowledge/review-comment-store.test.ts` - 10 integration tests with real PostgreSQL

## Decisions Made

- Whitespace-based token counting (`split(/\s+/)`) avoids external tokenizer dependency while providing adequate approximation
- Factory pattern `createReviewCommentStore({ sql, logger })` matches existing `createLearningMemoryStore` convention
- `ON CONFLICT (repo, comment_github_id, chunk_index) DO NOTHING` ensures idempotent backfill writes
- Bot filtering uses configurable `Set<string>` of logins plus automatic `[bot]` suffix detection
- `updateChunks` uses DELETE + INSERT in transaction to handle re-chunking when comment is edited

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Schema and store ready for Plan 02 (backfill pipeline) to bulk-ingest historical PR comments
- Plan 03 (incremental sync) can use getSyncState/updateSyncState for cursor tracking
- Plan 04 (retrieval integration) can use searchByEmbedding for vector similarity queries
- All 1152 existing tests continue to pass

---
*Phase: 89-pr-review-comment-ingestion*
*Completed: 2026-02-25*
