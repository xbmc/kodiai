# T01: 89-pr-review-comment-ingestion 01

**Slice:** S01 — **Milestone:** M018

## Description

Create the PostgreSQL schema, store module, and chunking logic for PR review comment ingestion.

Purpose: Establish the data layer that backfill (Plan 02), incremental sync (Plan 03), and retrieval (Plan 04) all depend on. Schema must support full metadata, vector search, and multi-repo scoping.
Output: Migration file, store module with write/read/search operations, type definitions, and thread-aware chunker.

## Must-Haves

- [ ] "knowledge.review_comments table exists in PostgreSQL with pgvector embedding column and all required metadata columns"
- [ ] "Review comments can be stored with full metadata: repo, PR number, file path, line range, author, date, and thread grouping"
- [ ] "Thread-aware chunking groups reply chains into single chunks when under token limit, splits with overlapping windows when over"
- [ ] "HNSW index on review_comments.embedding enables cosine similarity search"
- [ ] "Multi-repo support: repo column scopes all queries, enabling future cross-repo retrieval"

## Files

- `src/db/migrations/005-review-comments.sql`
- `src/db/migrations/005-review-comments.down.sql`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/review-comment-store.test.ts`
- `src/knowledge/review-comment-types.ts`
- `src/knowledge/review-comment-chunker.ts`
- `src/knowledge/review-comment-chunker.test.ts`
