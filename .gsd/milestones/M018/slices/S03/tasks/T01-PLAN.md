# T01: 91-cross-corpus-retrieval-integration 01

**Slice:** S03 — **Milestone:** M018

## Description

Add hybrid search (vector + BM25 full-text) capability to each knowledge corpus store.

Purpose: KI-14 requires combining pgvector semantic similarity with PostgreSQL tsvector full-text search per corpus. The tsvector columns and GIN indexes already exist on all three tables (learning_memories, review_comments, wiki_pages) from migrations 003, 005, and 006. This plan adds full-text search methods to each store and a hybrid merge function that combines vector and BM25 results using per-corpus RRF.

Output: Each store gains a `searchByFullText` method. A `hybridSearchMerge` function combines vector + BM25 ranked lists into a single scored list per corpus.

## Must-Haves

- [ ] "Each corpus supports both vector and full-text search in a single call"
- [ ] "Hybrid search combines vector cosine distance with tsvector ts_rank via RRF-style merge"
- [ ] "Full-text search uses existing search_tsv columns with plainto_tsquery"

## Files

- `src/knowledge/hybrid-search.ts`
- `src/knowledge/hybrid-search.test.ts`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/review-comment-types.ts`
- `src/knowledge/wiki-types.ts`
- `src/knowledge/types.ts`
