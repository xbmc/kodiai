---
id: T01
parent: S01
milestone: M019
provides:
  - "Migration 007: language column on learning_memories with index, language_tags on wiki_pages with GIN index, SQL CASE backfill"
  - "EXTENSION_LANGUAGE_MAP expanded to 61 entries (30+ languages)"
  - "classifyFileLanguageWithContext: lowercase output, .h ambiguity resolution via PR context"
  - "RELATED_LANGUAGES map: bidirectional C/C++, TS/JS, ObjC affinities for retrieval boosting"
  - "LearningMemoryRecord.language field: written on writeMemory, returned by getMemoryRecord"
  - "Backfill script: src/scripts/backfill-language.ts with --dry-run and stats logging"
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 5min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# T01: 93-language-aware-retrieval-boosting 01

**# Phase 93 Plan 01: Language Schema and Classification Summary**

## What Happened

# Phase 93 Plan 01: Language Schema and Classification Summary

**Migration 007 adds language column to learning_memories (with SQL CASE backfill), expands language taxonomy to 61 extensions, and populates language on every new memory write with context-aware .h resolution**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T09:26:05Z
- **Completed:** 2026-02-25T09:31:08Z
- **Tasks:** 4
- **Files modified:** 8

## Accomplishments

- Migration 007 adds nullable language column to learning_memories with index, language_tags array to wiki_pages with GIN index, and SQL CASE backfill for 30+ language extensions
- EXTENSION_LANGUAGE_MAP expanded from 46 to 61 entries; new classifyFileLanguageWithContext resolves .h ambiguity by inspecting PR context files
- RELATED_LANGUAGES map exported for affinity boosting (C/C++, TS/JS, ObjC/C/C++ relationships)
- writeMemory now stores language on every record; caller can pre-classify with context-aware function
- Backfill script with --dry-run flag logs total records, per-language counts, unknown count, and failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 007 — add language columns** - `87677ef854` (feat)
2. **Task 2: Expand EXTENSION_LANGUAGE_MAP and add context-aware classification** - `3be0258724` (feat)
3. **Task 3: Add language field to types and populate on memory write** - `fe29a11998` (feat)
4. **Task 4: Create backfill script with stats logging** - `75fa2a342d` (feat)

## Files Created/Modified

- `src/db/migrations/007-language-column.sql` - Adds language column, language_tags, indexes, SQL CASE backfill
- `src/db/migrations/007-language-column.down.sql` - Rollback migration
- `src/execution/diff-analysis.ts` - Expanded EXTENSION_LANGUAGE_MAP (61 entries), RELATED_LANGUAGES, classifyFileLanguageWithContext
- `src/execution/diff-analysis.test.ts` - 20 new tests for EXTENSION_LANGUAGE_MAP coverage, classifyFileLanguageWithContext, RELATED_LANGUAGES
- `src/knowledge/types.ts` - Added language?: string to LearningMemoryRecord
- `src/knowledge/memory-store.ts` - MemoryRow.language, rowToRecord includes language, writeMemory populates language
- `src/knowledge/memory-store.test.ts` - 3 new tests: language stored from filePath, caller-provided language used, getMemoryRecord returns language
- `src/scripts/backfill-language.ts` - Idempotent backfill script with batching, --dry-run, stats summary
- `src/db/migrations/006-wiki-pages.sql` - Bug fix: UNIQUE with COALESCE expression moved to CREATE UNIQUE INDEX

## Decisions Made

- Kept classifyFileLanguage returning Title Case for backward compatibility with retrieval-rerank.ts and mention.ts consumers
- classifyFileLanguageWithContext returns lowercase (matches DB storage convention)
- .h files default to 'c' without context; upgraded to 'cpp' when any .cpp/.cc/.cxx/.hpp/.hxx present in context files
- record.language takes precedence in writeMemory — allows context-aware pre-classification at call site
- EXTENSION_LANGUAGE_MAP uses case-sensitive key 'R' for uppercase R extension (R language convention)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing bug in migration 006 preventing tests from running**
- **Found during:** Task 3 (memory-store tests)
- **Issue:** migration 006 used `UNIQUE(page_id, COALESCE(section_anchor, ''), chunk_index)` — COALESCE in inline UNIQUE constraint is not valid SQL; requires CREATE UNIQUE INDEX
- **Fix:** Removed trailing comma from column list, moved UNIQUE to `CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_unique_chunk ON wiki_pages (page_id, COALESCE(section_anchor, ''), chunk_index)`
- **Files modified:** src/db/migrations/006-wiki-pages.sql
- **Verification:** Migration 006 applies cleanly; all 13 memory-store tests pass
- **Committed in:** fe29a11998 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Pre-existing migration bug blocked running DB tests. Fix was minimal and correct.

## Issues Encountered

- The plan verification step specifies `npx vitest run` but the project uses `bun test` (bun:test, not vitest). Tests run correctly with bun.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Language column in DB is ready for retrieval boosting (Plan 02)
- RELATED_LANGUAGES map ready for affinity boost weighting
- classifyFileLanguageWithContext available for context-aware classification in review handler
- Backfill script available for post-migration verification with --dry-run

---
*Phase: 93-language-aware-retrieval-boosting*
*Completed: 2026-02-25*
