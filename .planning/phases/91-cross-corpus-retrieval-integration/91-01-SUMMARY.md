---
phase: 91-cross-corpus-retrieval-integration
plan: 01
status: complete
---

## Summary

Added hybrid search (vector + BM25 full-text) capability to all three knowledge corpus stores and created a generic RRF merge function.

## What Was Built

- **searchByFullText** methods on ReviewCommentStore, WikiPageStore, and LearningMemoryStore using existing tsvector GIN indexes with plainto_tsquery
- **hybridSearchMerge** generic function that combines vector + BM25 ranked lists via Reciprocal Rank Fusion (k=60 default per user decision)
- Distance normalization: BM25 ts_rank mapped to `1 - rank` for consistent lower-is-better convention

## Key Decisions

- searchByFullText on LearningMemoryStore is optional (`?`) since it's a new capability not all consumers need
- BM25 distance = `1 - ts_rank` to maintain consistent distance convention across search types
- Empty query guard returns empty array (no wasted DB calls)

## Key Files

### Created
- `src/knowledge/hybrid-search.ts` — Generic RRF merge function
- `src/knowledge/hybrid-search.test.ts` — 8 tests covering all merge scenarios

### Modified
- `src/knowledge/review-comment-types.ts` — Added searchByFullText interface
- `src/knowledge/review-comment-store.ts` — Added searchByFullText implementation
- `src/knowledge/wiki-types.ts` — Added searchByFullText interface
- `src/knowledge/wiki-store.ts` — Added searchByFullText implementation
- `src/knowledge/types.ts` — Added optional searchByFullText to LearningMemoryStore
- `src/knowledge/memory-store.ts` — Added searchByFullText implementation

## Self-Check: PASSED

- [x] All three stores have searchByFullText methods
- [x] hybridSearchMerge passes all 8 tests
- [x] Existing knowledge tests still pass
- [x] Type check passes (no new errors)
