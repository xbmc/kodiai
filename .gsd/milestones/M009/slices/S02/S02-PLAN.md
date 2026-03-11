# S02: Intelligent Retrieval

**Goal:** Build and test two pure functions: `buildRetrievalQuery()` for multi-signal query construction (RET-01) and `rerankByLanguage()` for post-retrieval language-aware re-ranking (RET-02).
**Demo:** Build and test two pure functions: `buildRetrievalQuery()` for multi-signal query construction (RET-01) and `rerankByLanguage()` for post-retrieval language-aware re-ranking (RET-02).

## Must-Haves


## Tasks

- [x] **T01: 52-intelligent-retrieval 01** `est:2min`
  - Build and test two pure functions: `buildRetrievalQuery()` for multi-signal query construction (RET-01) and `rerankByLanguage()` for post-retrieval language-aware re-ranking (RET-02).

Purpose: These are the core logic units for Phase 52. Both are pure functions with defined I/O, making them ideal TDD candidates. Building them first with full test coverage ensures correctness before integration.

Output: Two tested modules (`retrieval-query.ts`, `retrieval-rerank.ts`) and extended types in `types.ts`.
- [x] **T02: 52-intelligent-retrieval 02** `est:1min`
  - Wire `buildRetrievalQuery()` and `rerankByLanguage()` into the review handler's retrieval path, replacing the simple title+files query with multi-signal construction and adding post-retrieval language-aware re-ranking.

Purpose: This connects the pure functions from 52-01 to the live review pipeline, completing RET-01 and RET-02. The integration must preserve fail-open semantics — if the new code encounters any issue, the review proceeds without retrieval context.

Output: Updated `review.ts` with enriched retrieval queries and language-aware result ordering.

## Files Likely Touched

- `src/learning/retrieval-query.ts`
- `src/learning/retrieval-query.test.ts`
- `src/learning/retrieval-rerank.ts`
- `src/learning/retrieval-rerank.test.ts`
- `src/learning/types.ts`
- `src/handlers/review.ts`
