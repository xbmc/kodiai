---
phase: 91-cross-corpus-retrieval-integration
plan: 02
status: complete
---

## Summary

Created the cross-corpus Reciprocal Rank Fusion engine and Jaccard-based deduplication module.

## What Was Built

- **crossCorpusRRF** function: merges ranked lists from code, review_comment, and wiki corpora using `1/(k+rank)` scoring (k=60 default). Includes configurable recency boost (15% for items within 30 days).
- **UnifiedRetrievalChunk** type: normalized chunk format with source labels, URLs, RRF scores, and alternate source annotations.
- **deduplicateChunks** function: Jaccard similarity-based dedup with two modes:
  - `within-corpus`: dedup within each source before RRF (prevents duplicate inflation)
  - `cross-corpus`: dedup across all sources after RRF merge
- **jaccardSimilarity** utility: whitespace-tokenized Jaccard coefficient (case insensitive)

## Key Decisions

- Jaccard on tokens instead of embedding cosine: dedup targets near-identical text (copy-paste), not semantically similar content. Avoids extra API calls.
- Default threshold 0.90 (per CONTEXT.md Claude's discretion starting at ~0.90)
- Recency boost 15% for 30-day window (middle of CONTEXT.md range "10-20%")
- Surviving deduped chunks get `alternateSources` annotations (per CONTEXT.md)

## Key Files

### Created
- `src/knowledge/cross-corpus-rrf.ts` — RRF engine and UnifiedRetrievalChunk type
- `src/knowledge/cross-corpus-rrf.test.ts` — 9 tests
- `src/knowledge/dedup.ts` — Jaccard dedup with within/cross-corpus modes
- `src/knowledge/dedup.test.ts` — 15 tests (6 jaccardSimilarity + 9 deduplicateChunks)

## Self-Check: PASSED

- [x] RRF uses k=60 default per user decision
- [x] Recency boost 15% within 30-day window
- [x] Dedup threshold 0.90
- [x] Surviving chunks annotated with alternate sources
- [x] All 24 tests pass
