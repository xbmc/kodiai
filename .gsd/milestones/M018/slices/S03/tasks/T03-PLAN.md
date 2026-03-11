# T03: 91-cross-corpus-retrieval-integration 03

**Slice:** S03 — **Milestone:** M018

## Description

Refactor the retrieval pipeline to use unified cross-corpus retrieval with hybrid search, RRF, source-aware re-ranking, and attributed context assembly.

Purpose: KI-13 (single retrieval call fans out to all corpora), KI-16 (source-aware re-ranking), KI-17 (source attribution labels), KI-18 (token-budgeted context assembly). The current `retrieval.ts` treats the three corpora as separate result streams (`findings`, `reviewPrecedents`, `wikiKnowledge`). This plan refactors it to normalize all results into `UnifiedRetrievalChunk`, run cross-corpus RRF, dedup, and return a unified ranked list with source attribution.

Output: Refactored `createRetriever` that returns unified results. Backward-compatible `RetrieveResult` type with new `unifiedResults` field alongside legacy fields for gradual consumer migration.

## Must-Haves

- [ ] "Single retrieval call fans out to all three corpora simultaneously"
- [ ] "All corpus results are normalized to UnifiedRetrievalChunk with source labels"
- [ ] "Source-aware re-ranking weights results by context type (PR review vs issue Q&A)"
- [ ] "Context assembly respects token budget with attributed chunks from any source"
- [ ] "No retrieval path bypasses the unified layer"

## Files

- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/review-comment-retrieval.ts`
- `src/knowledge/wiki-retrieval.ts`
- `src/knowledge/index.ts`
