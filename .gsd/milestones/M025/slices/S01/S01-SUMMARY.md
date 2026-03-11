---
id: S01
parent: M025
milestone: M025
provides:
  - createContextualizedEmbeddingProvider for voyage-context-3
  - contextualizedEmbedChunks batch helper for backfill scripts
  - VoyageAIClient re-export for direct SDK access
  - Parameterized wiki-store embedding model (no more hardcoded voyage-code-3)
  - Per-corpus embedding routing in retrieval pipeline (wiki vs shared)
  - wiki-embedding-backfill.ts CLI script for re-embedding all wiki pages with voyage-context-3
  - embedding-comparison.ts benchmark script for comparing retrieval quality across models
requires: []
affects: []
key_files: []
key_decisions:
  - "Wiki store accepts embedding model as parameter (opts.embeddingModel) with voyage-code-3 default for backward compat"
  - "Wiki sync scheduler uses wikiEmbeddingProvider so new pages get voyage-context-3 embeddings"
  - "contextualizedEmbedChunks uses 30s timeout (vs 10s for single) to accommodate larger batch payloads"
  - "Backfill script uses contextualizedEmbedChunks for batch page-level embedding with per-chunk fallback on token limit errors"
  - "Comparison benchmark generates query embeddings on the fly for both models, searching existing DB vectors"
  - "13 eval queries chosen as representative kodi.wiki search use cases"
patterns_established:
  - "Per-corpus embedding routing: createRetriever accepts optional wikiEmbeddingProvider, falls back to shared"
  - "Contextualized embed wraps single text as inputs: [[text]] for both document and query"
  - "Batch-then-fallback: try contextualizedEmbedChunks for full page, fall back to per-chunk on failure"
  - "Model-agnostic benchmarking: --old-model/--new-model flags for reuse across future model evaluations"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-03-03
blocker_discovered: false
---
# S01: Embedding Migration

**# Phase 120 Plan 01: Embedding Provider and Pipeline Wiring Summary**

## What Happened

# Phase 120 Plan 01: Embedding Provider and Pipeline Wiring Summary

**Contextualized embedding provider (voyage-context-3) with per-corpus routing through wiki retrieval pipeline**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T08:01:24Z
- **Completed:** 2026-03-03T08:04:55Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created `createContextualizedEmbeddingProvider` using Voyage AI's `contextualizedEmbed()` API with fail-open semantics
- Added `contextualizedEmbedChunks` batch helper and `VoyageAIClient` re-export for the backfill script in plan 120-02
- Parameterized wiki-store to accept embedding model name instead of hardcoding "voyage-code-3"
- Wired per-corpus embedding routing: wiki searches use voyage-context-3, all other corpora remain on voyage-code-3
- All 82 existing wiki tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create contextualized embedding provider and parameterize wiki-store** - `d515cfa4c5` (feat)
2. **Task 2: Wire per-corpus embedding providers through retrieval pipeline and index.ts** - `f4b1fde654` (feat)

## Files Created/Modified
- `src/knowledge/embeddings.ts` - Added createContextualizedEmbeddingProvider, contextualizedEmbedChunks, VoyageAIClient re-export
- `src/knowledge/wiki-store.ts` - Parameterized embeddingModel in writeChunks and replacePageChunks
- `src/knowledge/retrieval.ts` - Added wikiEmbeddingProvider to createRetriever deps, routed wiki searches through it
- `src/knowledge/troubleshooting-retrieval.ts` - Added wikiEmbeddingProvider for wiki fallback searches
- `src/handlers/troubleshooting-agent.ts` - Plumbed wikiEmbeddingProvider through handler to retrieval call
- `src/index.ts` - Created two providers (voyage-code-3 shared + voyage-context-3 wiki), wired to all consumers

## Decisions Made
- Wiki store uses `opts.embeddingModel ?? "voyage-code-3"` for backward compatibility -- callers that don't pass the option get the old behavior
- Wiki sync scheduler receives the wiki-specific provider so newly synced pages immediately get voyage-context-3 embeddings
- Batch embed helper uses 30s timeout (vs 10s for single embed) to accommodate larger payloads

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated troubleshooting-agent.ts handler to accept wikiEmbeddingProvider**
- **Found during:** Task 2 (wiring index.ts)
- **Issue:** Plan specified passing wikiEmbeddingProvider to createTroubleshootingHandler in index.ts but didn't mention updating the handler's type signature
- **Fix:** Added wikiEmbeddingProvider to handler deps type, destructuring, and retrieveTroubleshootingContext call
- **Files modified:** src/handlers/troubleshooting-agent.ts
- **Verification:** bun build src/index.ts --no-bundle compiles cleanly
- **Committed in:** f4b1fde654 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for type correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Contextualized embedding infrastructure is in place
- Ready for plan 120-02: backfill migration script to re-embed existing wiki chunks with voyage-context-3
- New wiki pages synced after deployment will automatically use voyage-context-3

---
*Phase: 120-embedding-migration*
*Completed: 2026-03-03*

# Phase 120 Plan 02: Wiki Embedding Backfill and Comparison Scripts Summary

**Backfill script for voyage-context-3 migration with batch page-level embedding and side-by-side comparison benchmark**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T08:07:16Z
- **Completed:** 2026-03-03T08:09:16Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Created wiki-embedding-backfill.ts that re-embeds all wiki page chunks with voyage-context-3 using contextualizedEmbedChunks batch API
- Created embedding-comparison.ts benchmark with 13 eval queries, formatted console output, and JSON export
- Both scripts are reusable and parameterized via CLI flags (not one-time throwaway)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create wiki embedding backfill script** - `e55bdf0cd4` (feat)
2. **Task 2: Create embedding comparison benchmark script** - `57037bc7bc` (feat)

## Files Created/Modified
- `scripts/wiki-embedding-backfill.ts` - CLI script to re-embed all wiki pages with voyage-context-3, includes pre-flight token count, batch+fallback embedding, post-backfill verification
- `scripts/embedding-comparison.ts` - Benchmark comparing retrieval results between two embedding models with console table output and JSON export

## Decisions Made
- Backfill uses batch contextualizedEmbedChunks per page with automatic per-chunk fallback when batch fails (token limit errors)
- Comparison generates query embeddings on the fly for both models and searches the existing DB vectors -- before backfill, new-model results will appear degraded (noted in output)
- 13 eval queries selected as representative kodi.wiki search patterns covering install, PVR, audio, addons, skins, database, HDR, remotes, debugging, repos, keyboards, scrapers, and streaming

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - scripts use existing DATABASE_URL and VOYAGE_API_KEY environment variables.

## Next Phase Readiness
- Both scripts ready to run: `bun scripts/embedding-comparison.ts` for pre-migration baseline, then `bun scripts/wiki-embedding-backfill.ts` for migration
- Phase 120 embedding migration is now complete (all plans delivered)

---
*Phase: 120-embedding-migration*
*Completed: 2026-03-03*
