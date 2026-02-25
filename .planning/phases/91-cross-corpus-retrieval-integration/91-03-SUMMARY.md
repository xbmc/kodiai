---
phase: 91-cross-corpus-retrieval-integration
plan: 03
status: complete
---

## Summary

Refactored the retrieval pipeline to use unified cross-corpus retrieval with hybrid search, RRF, dedup, source-aware re-ranking, and context assembly.

## What Was Built

- **Unified pipeline**: Single `retrieve()` call fans out 6 parallel searches (3 vector + 3 BM25) via `Promise.allSettled` for maximum parallelism and fail-open
- **Per-corpus hybrid merge**: Vector + BM25 results combined via RRF before cross-corpus fusion
- **Source normalization**: All results converted to `UnifiedRetrievalChunk` with source labels (`[code: file.ts]`, `[review: PR #123]`, `[wiki: Page Title]`)
- **Context-dependent weighting**: `triggerType` option applies 1.2x multiplier to relevant sources (pr_review boosts code+review, question boosts wiki)
- **Context assembly**: `assembleContextWindow()` builds token-budgeted context with source labels and missing-corpus notes
- **Backward compatibility**: Legacy `findings`, `reviewPrecedents`, `wikiKnowledge` fields preserved alongside new `unifiedResults` and `contextWindow`

## Key Decisions

- Used `Promise.allSettled` instead of separate sequential/parallel blocks for cleaner fail-open behavior
- Guard `searchByFullText` with optional chaining (`?.searchByFullText`) for backward compat with existing mocks/consumers
- RerankedResult cast to MergedRetrievalResult via `unknown` for legacy `findings` field (pre-existing type mismatch)
- Source weight 1.2x is mild enough to adjust ranking without overwhelming relevance signals

## Key Files

### Modified
- `src/knowledge/retrieval.ts` — Unified pipeline with hybrid search, RRF, dedup, and context assembly
- `src/knowledge/index.ts` — Added exports for hybrid-search, cross-corpus-rrf, and dedup modules

## Self-Check: PASSED

- [x] All 12 existing retrieval tests pass (bun)
- [x] All 32 vitest knowledge tests pass
- [x] No new type errors
- [x] Legacy fields preserved for backward compat
- [x] Parallel fan-out via Promise.allSettled
