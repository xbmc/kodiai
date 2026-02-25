---
phase: 92-wire-unified-retrieval-consumers
plan: 02
status: complete
---

## Summary

Fixed the review retry path to pass full unified context and wired learningMemoryStore to createRetriever for hybrid BM25+vector search on the code corpus.

## What Was Built

- **Review retry fix**: The retry buildReviewPrompt call now passes wikiKnowledge, unifiedResults, and contextWindow — matching the primary review path exactly
- **Hybrid search wiring**: createRetriever() in index.ts now receives learningMemoryStore via the `memoryStore` parameter, enabling BM25 full-text search alongside vector search on the code corpus
- **RRF integration**: The existing per-corpus hybrid merge (Phase 91) now activates for the code corpus since the memoryStore is available

## Key Decisions

- Added only the 3 missing fields to the retry path (wikiKnowledge, unifiedResults, contextWindow) — minimal surgical change
- memoryStore parameter is optional in createRetriever, so the change is backward-compatible when learningMemoryStore is undefined
- Updated test assertion for unified context format (Knowledge Context instead of legacy Retrieval section)

## Key Files

### Modified
- `src/handlers/review.ts` — Added missing unified context fields to retry buildReviewPrompt call
- `src/index.ts` — Wired learningMemoryStore to createRetriever memoryStore parameter
- `src/handlers/review.test.ts` — Updated assertion for unified context format

## Self-Check: PASSED

- [x] All 72 review tests pass
- [x] All 124 review-prompt tests pass
- [x] All 12 retrieval unit tests pass
- [x] All 10 retrieval E2E tests pass
- [x] TypeScript compiles with no errors
- [x] Retry path now matches primary path for unified context fields
- [x] memoryStore wired in createRetriever call
