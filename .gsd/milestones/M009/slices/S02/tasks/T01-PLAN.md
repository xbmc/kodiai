# T01: 52-intelligent-retrieval 01

**Slice:** S02 — **Milestone:** M009

## Description

Build and test two pure functions: `buildRetrievalQuery()` for multi-signal query construction (RET-01) and `rerankByLanguage()` for post-retrieval language-aware re-ranking (RET-02).

Purpose: These are the core logic units for Phase 52. Both are pure functions with defined I/O, making them ideal TDD candidates. Building them first with full test coverage ensures correctness before integration.

Output: Two tested modules (`retrieval-query.ts`, `retrieval-rerank.ts`) and extended types in `types.ts`.

## Must-Haves

- [ ] "buildRetrievalQuery produces a query string incorporating PR title, body excerpt, conventional type, languages, risk signals, author tier, and file paths"
- [ ] "buildRetrievalQuery caps output length to ~800 chars to avoid embedding quality degradation"
- [ ] "rerankByLanguage boosts same-language results and penalizes cross-language results by adjustable factors"
- [ ] "rerankByLanguage treats Unknown-language records as neutral (no boost, no penalty)"
- [ ] "rerankByLanguage re-sorts results by adjusted distance after applying multipliers"

## Files

- `src/learning/retrieval-query.ts`
- `src/learning/retrieval-query.test.ts`
- `src/learning/retrieval-rerank.ts`
- `src/learning/retrieval-rerank.test.ts`
- `src/learning/types.ts`
