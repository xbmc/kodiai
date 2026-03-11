# T02: 92-wire-unified-retrieval-consumers 02

**Slice:** S04 — **Milestone:** M018

## Description

Fix the review retry path to pass full unified context to buildReviewPrompt and wire learningMemoryStore into createRetriever() for hybrid BM25+vector search on the code corpus.

Purpose: The retry path currently drops wikiKnowledge, unifiedResults, and contextWindow. The code corpus currently gets vector-only search because learningMemoryStore is not passed to createRetriever. This plan closes both gaps.
Output: Review retry preserves unified context; code corpus gets hybrid search via BM25+vector.

## Must-Haves

- [ ] "Review retry path passes full unified context (unifiedResults, contextWindow, wikiKnowledge) to buildReviewPrompt"
- [ ] "createRetriever() receives learningMemoryStore for hybrid BM25+vector search on code corpus"
- [ ] "Code corpus BM25 search is active when learningMemoryStore is available"
- [ ] "Retry gracefully degrades if unified context is unavailable — falls back to code diff only"

## Files

- `src/handlers/review.ts`
- `src/index.ts`
