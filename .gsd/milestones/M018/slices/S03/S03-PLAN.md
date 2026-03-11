# S03: Cross Corpus Retrieval Integration

**Goal:** Add hybrid search (vector + BM25 full-text) capability to each knowledge corpus store.
**Demo:** Add hybrid search (vector + BM25 full-text) capability to each knowledge corpus store.

## Must-Haves


## Tasks

- [x] **T01: 91-cross-corpus-retrieval-integration 01**
  - Add hybrid search (vector + BM25 full-text) capability to each knowledge corpus store.

Purpose: KI-14 requires combining pgvector semantic similarity with PostgreSQL tsvector full-text search per corpus. The tsvector columns and GIN indexes already exist on all three tables (learning_memories, review_comments, wiki_pages) from migrations 003, 005, and 006. This plan adds full-text search methods to each store and a hybrid merge function that combines vector and BM25 results using per-corpus RRF.

Output: Each store gains a `searchByFullText` method. A `hybridSearchMerge` function combines vector + BM25 ranked lists into a single scored list per corpus.
- [x] **T02: 91-cross-corpus-retrieval-integration 02**
  - Build the cross-corpus Reciprocal Rank Fusion engine and cosine deduplication module.

Purpose: KI-15 requires RRF merging ranked lists from heterogeneous sources using `1/(k + rank)` scoring summed across lists. KI-19 requires near-duplicate chunks from different sources to be collapsed via cosine similarity threshold. This plan creates both as standalone, tested modules that the unified retrieval pipeline (plan 03) will consume.

Output: `crossCorpusRRF` function that merges ranked lists from code, review, and wiki corpora. `deduplicateChunks` function that collapses near-duplicates within and across corpora.
- [x] **T03: 91-cross-corpus-retrieval-integration 03**
  - Refactor the retrieval pipeline to use unified cross-corpus retrieval with hybrid search, RRF, source-aware re-ranking, and attributed context assembly.

Purpose: KI-13 (single retrieval call fans out to all corpora), KI-16 (source-aware re-ranking), KI-17 (source attribution labels), KI-18 (token-budgeted context assembly). The current `retrieval.ts` treats the three corpora as separate result streams (`findings`, `reviewPrecedents`, `wikiKnowledge`). This plan refactors it to normalize all results into `UnifiedRetrievalChunk`, run cross-corpus RRF, dedup, and return a unified ranked list with source attribution.

Output: Refactored `createRetriever` that returns unified results. Backward-compatible `RetrieveResult` type with new `unifiedResults` field alongside legacy fields for gradual consumer migration.
- [x] **T04: 91-cross-corpus-retrieval-integration 04**
  - Wire all retrieval consumers to use unified results with cross-corpus attribution formatting, and create the end-to-end validation test.

Purpose: Complete the consumer side of the unified retrieval layer. All handlers (review, mention, Slack) must use the new `unifiedResults` and `contextWindow` from the retriever. Citation formatting should use the inline source labels specified in CONTEXT.md. The E2E test validates that a single retrieval call returns results from all three corpora with proper attribution.

Output: All consumers use unified retrieval. End-to-end test proves the full pipeline.

## Files Likely Touched

- `src/knowledge/hybrid-search.ts`
- `src/knowledge/hybrid-search.test.ts`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/review-comment-types.ts`
- `src/knowledge/wiki-types.ts`
- `src/knowledge/types.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/cross-corpus-rrf.test.ts`
- `src/knowledge/dedup.ts`
- `src/knowledge/dedup.test.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/review-comment-retrieval.ts`
- `src/knowledge/wiki-retrieval.ts`
- `src/knowledge/index.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/slack/assistant-handler.ts`
- `src/knowledge/retrieval.e2e.test.ts`
