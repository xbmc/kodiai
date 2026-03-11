---
id: S03
parent: M018
milestone: M018
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 
blocker_discovered: false
---
# S03: Cross Corpus Retrieval Integration

**## Summary**

## What Happened

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

## Summary

Wired all retrieval consumers to use the unified cross-corpus pipeline with triggerType-based source boosting and citation formatting. Added comprehensive E2E tests.

## What Was Built

- **Consumer wiring**: All three handlers (review, mention, Slack) pass `triggerType` to retriever and forward `unifiedResults`/`contextWindow` to prompt builders
- **Prompt integration**: `buildReviewPrompt` accepts `unifiedResults` and `contextWindow`, preferring `formatUnifiedContext` over legacy separate sections when available, with fallback for backward compat
- **E2E test suite**: 6 new cross-corpus tests proving attribution from all three corpora, triggerType boosting, fail-open resilience, and legacy field preservation
- **Citation formatting**: `formatUnifiedContext` produces inline source labels with clickable links, alternate source annotations, and soft cap at 8 citations

## Key Decisions

- Unified context section replaces all three legacy sections (retrieval, precedents, wiki) when present, avoiding duplicate context
- Legacy path preserved in `buildReviewPrompt` for deployments where unified pipeline is not yet active
- E2E tests use bun:test (same as existing retrieval tests) with mock stores providing known data from all three corpora

## Key Files

### Modified
- `src/handlers/review.ts` — Passes triggerType: "pr_review" and unified results to prompt builder
- `src/handlers/mention.ts` — Passes triggerType: "question" to retriever
- `src/slack/assistant-handler.ts` — Passes triggerType: "slack", prefers contextWindow
- `src/execution/review-prompt.ts` — Added unifiedResults/contextWindow to buildReviewPrompt, integrated formatUnifiedContext
- `src/knowledge/retrieval.e2e.test.ts` — 6 new cross-corpus E2E tests (10 total)

## Self-Check: PASSED

- [x] All 22 bun retrieval tests pass (12 unit + 10 E2E)
- [x] All 32 vitest knowledge tests pass
- [x] All 124 review-prompt tests pass
- [x] No new type errors in modified files
- [x] E2E proves: single call returns code + review + wiki with attribution
- [x] All handlers pass triggerType for context-dependent weighting
- [x] Legacy fields preserved for backward compatibility
