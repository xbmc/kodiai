---
phase: 120-embedding-migration
plan: 01
subsystem: knowledge
tags: [voyage-ai, embeddings, contextual-embeddings, pgvector, retrieval]

requires:
  - phase: none
    provides: existing embedding provider and retrieval pipeline

provides:
  - createContextualizedEmbeddingProvider for voyage-context-3
  - contextualizedEmbedChunks batch helper for backfill scripts
  - VoyageAIClient re-export for direct SDK access
  - Parameterized wiki-store embedding model (no more hardcoded voyage-code-3)
  - Per-corpus embedding routing in retrieval pipeline (wiki vs shared)

affects: [120-02-backfill-migration]

tech-stack:
  added: []
  patterns: [per-corpus-embedding-provider, contextualized-embed-api]

key-files:
  created: []
  modified:
    - src/knowledge/embeddings.ts
    - src/knowledge/wiki-store.ts
    - src/knowledge/retrieval.ts
    - src/knowledge/troubleshooting-retrieval.ts
    - src/handlers/troubleshooting-agent.ts
    - src/index.ts

key-decisions:
  - "Wiki store accepts embedding model as parameter (opts.embeddingModel) with voyage-code-3 default for backward compat"
  - "Wiki sync scheduler uses wikiEmbeddingProvider so new pages get voyage-context-3 embeddings"
  - "contextualizedEmbedChunks uses 30s timeout (vs 10s for single) to accommodate larger batch payloads"

patterns-established:
  - "Per-corpus embedding routing: createRetriever accepts optional wikiEmbeddingProvider, falls back to shared"
  - "Contextualized embed wraps single text as inputs: [[text]] for both document and query"

requirements-completed: [EMBED-02, EMBED-03, EMBED-04]

duration: 3min
completed: 2026-03-03
---

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
