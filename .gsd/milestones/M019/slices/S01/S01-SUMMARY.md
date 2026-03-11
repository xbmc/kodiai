---
id: S01
parent: M019
milestone: M019
provides:
  - "review handler writes language field to learning memories using context-aware .h resolution"
  - "mention handler normalizes prLanguages to lowercase canonical forms for retrieval"
  - "wiki-retrieval tests cover languageTags in results and empty-array defaults"
  - "5 e2e tests validate language-aware ranking: boost, no-penalty, wiki tags, affinity, proportional"
  - Language boosting in unified pipeline step 6e (proportional, boost-only)
  - refactored rerankByLanguage — stored language, no penalty, related language affinity
  - WikiKnowledgeMatch.languageTags field wired through searchWikiPages
  - language field in code chunk metadata (memoryToUnified)
  - languageTags field in wiki chunk metadata (wikiMatchToUnified)
  - "Migration 007: language column on learning_memories with index, language_tags on wiki_pages with GIN index, SQL CASE backfill"
  - "EXTENSION_LANGUAGE_MAP expanded to 61 entries (30+ languages)"
  - "classifyFileLanguageWithContext: lowercase output, .h ambiguity resolution via PR context"
  - "RELATED_LANGUAGES map: bidirectional C/C++, TS/JS, ObjC affinities for retrieval boosting"
  - "LearningMemoryRecord.language field: written on writeMemory, returned by getMemoryRecord"
  - "Backfill script: src/scripts/backfill-language.ts with --dry-run and stats logging"
requires: []
affects: []
key_files: []
key_decisions:
  - "Use classifyFileLanguageWithContext (not classifyFileLanguage) for memory writes — resolves .h ambiguity using PR context files"
  - "Normalize in mention.ts at construction time: keeps retrieval.ts boost logic clean (single normalization site)"
  - "E2E tests use adaptive: false to get deterministic RRF scores for language boost assertions"
  - "Boost-only policy: non-matching language results keep original score, never penalized (LANG-03/LANG-04)"
  - "Language boosting in two pipeline paths: rerankByLanguage for legacy findings[], step 6e for unified results — no double-boost because memoryToUnified reads original distance"
  - "Proportional multi-language weights: 80% C++ PR boosts C++ results more than 50% C++ PR"
  - "Related language affinity at 50% of exact boost (relatedLanguageRatio = 0.5)"
  - "Stored record.language takes precedence; fallback to classifyFileLanguage(filePath) for old records without language field"
  - "Kept classifyFileLanguage returning Title Case for backward compatibility; new classifyFileLanguageWithContext returns lowercase for DB"
  - ".h files default to 'c', upgrade to 'cpp' when C++ context files (.cpp/.cc/.cxx/.hpp/.hxx) are present in PR"
  - "record.language takes precedence in writeMemory — callers can pre-classify with context-aware function"
  - "EXTENSION_LANGUAGE_MAP uses case-sensitive keys (R vs r) for correct R language handling"
patterns_established:
  - "Pattern: language field always written to LearningMemoryRecord at PR review time with full PR context"
  - "Pattern: prLanguages always lowercase-normalized before entering retrieval pipeline"
  - "buildProportionalLanguageWeights: normalize prLanguages to lowercase weight map before boosting"
  - "getChunkLanguage: extracts language from unified chunk — metadata.language for code, metadata.languageTags[0] for wiki, classifyFileLanguage(filePath) for review_comment"
  - "Language classification: two-tier API — classifyFileLanguage (display/legacy) vs classifyFileLanguageWithContext (DB/new code)"
  - "Backfill scripts live in src/scripts/ and support --dry-run for safe post-migration verification"
observability_surfaces: []
drill_down_paths: []
duration: 5min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# S01: Language Aware Retrieval Boosting

**# Phase 93 Plan 04: Language-Aware Retrieval Boosting - Consumer Wiring Summary**

## What Happened

# Phase 93 Plan 04: Language-Aware Retrieval Boosting - Consumer Wiring Summary

**Context-aware language classification wired through review/mention handlers, with 5 e2e tests proving language-aware RRF ranking across all three corpora**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-25T17:42:44Z
- **Completed:** 2026-02-25T17:48:24Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- review.ts writes `language` field to `LearningMemoryRecord` using `classifyFileLanguageWithContext` — `.h` files in C++ PRs correctly classified as `cpp` rather than `c`
- mention.ts normalizes `prLanguages` to lowercase canonical forms (C++ -> cpp, C# -> csharp, etc.) at construction time so retrieval boost logic receives consistent input
- wiki-retrieval.test.ts adds `languageTags: []` to mock record default, plus two new tests covering languageTags round-trip and empty-array defaults
- retrieval.e2e.test.ts adds 5 language boost tests: C++ memory beats Python, no-penalty for non-matching, wiki tags boost, C affinity in C++ PR, proportional multi-language boost

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire language through wiki retrieval and handlers** - `eb87b4b` (feat)
2. **Task 2: E2E test for language-aware cross-corpus ranking** - `8d4f667` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/handlers/review.ts` - Import classifyFileLanguageWithContext; add `language` field to LearningMemoryRecord using context-aware classification
- `src/handlers/mention.ts` - Normalize prLanguages to lowercase (C++ -> cpp, C# -> csharp, etc.)
- `src/knowledge/wiki-retrieval.test.ts` - Add languageTags to mock record default; add 2 tests for languageTags in results
- `src/knowledge/retrieval.e2e.test.ts` - Add describe block with 5 language-aware ranking e2e tests

## Decisions Made

- Used `classifyFileLanguageWithContext` not `classifyFileLanguage` in review.ts — the context-aware version resolves `.h` ambiguity using all changed PR files, returning lowercase already (no `.toLowerCase()` needed)
- Normalization placed in mention.ts at `prLanguages` construction time rather than in retrieval.ts — keeps retrieval clean, single normalization site
- E2E tests use `adaptive: false` so threshold behavior is deterministic and language boost effects are observable in rrfScore comparisons

## Deviations from Plan

None - plan executed exactly as written. Wiki retrieval's `languageTags` mapping was already added in Plan 03 Task 2 as noted in the plan, so no changes to wiki-retrieval.ts source were needed.

## Issues Encountered

None.

## Next Phase Readiness

Phase 93 is now complete:
- All write paths store language metadata (review handler pre-classifies, backfill script handles historical data)
- All read paths expose language metadata to unified pipeline (wiki languageTags, code language field)
- Handler integration complete (review writes, mention reads with normalization)
- Language-aware ranking proven end-to-end by tests

Ready for Phase 94 (Kodi depends analysis).

---
*Phase: 93-language-aware-retrieval-boosting*
*Completed: 2026-02-25*

# Phase 93 Plan 03: Language-Aware Retrieval Boosting — Pipeline Consolidation Summary

**Proportional language boosting in unified pipeline step 6e with boost-only policy, refactored rerankByLanguage using stored language field and related-language affinity**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-25T17:35:19Z
- **Completed:** 2026-02-25T17:41:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Refactored `rerankByLanguage` to use stored `record.language` field (fallback to classifyFileLanguage for old records), removed cross-language penalty, added related language affinity (C/C++ at 50% of exact boost)
- Added language boosting to unified pipeline step 6e-bis: proportional weights from PR language distribution, boost-only policy (no penalty for non-matching results)
- Wired `languageTags` from `WikiPageRecord` through `searchWikiPages` into `WikiKnowledgeMatch` and unified chunk metadata
- Updated `memoryToUnified` to include normalized language in chunk metadata for boost lookups
- Fixed 2 pre-existing telemetry tests that expected old cross-language penalty behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor retrieval-rerank.ts — stored language, no penalty** - `de97635e58` (feat)
2. **Task 2: Move language boosting to unified pipeline, remove legacy double-boost** - `51f6f0e222` (feat)
3. **Deviation fix: Review handler telemetry test values** - `405331ac0b` (fix)

## Files Created/Modified

- `src/knowledge/retrieval-rerank.ts` - Refactored: stored language, no penalty, related-language affinity, new RerankConfig shape (relatedLanguageRatio replaces crossLanguagePenalty)
- `src/knowledge/retrieval-rerank.test.ts` - Updated: 15 tests (6 legacy updated + 9 new behaviors including stored language, no-penalty, related language affinity)
- `src/knowledge/retrieval.ts` - Added: step 6e-bis language boosting, helper functions, memoryToUnified language metadata, wikiMatchToUnified languageTags metadata
- `src/knowledge/retrieval.test.ts` - Added: 7 new language-aware pipeline tests (boost, no-penalty, proportional, affinity, wiki tags, metadata)
- `src/knowledge/wiki-retrieval.ts` - Added languageTags field to WikiKnowledgeMatch; wired from WikiPageRecord in searchWikiPages
- `src/handlers/review.test.ts` - Updated expected avgDistance and distanceThreshold values to reflect no-penalty behavior

## Decisions Made

- Boost-only policy in unified pipeline: `chunk.rrfScore *= (1 + boost)` where boost is proportional to language weight. Non-matching chunks are untouched.
- Single location per pipeline: legacy `rerankByLanguage` continues for `findings[]` backward compat; step 6e-bis handles `unifiedResults`. No double-boost verified because `memoryToUnified` reads original `result.distance`.
- `getChunkLanguage` helper abstracts language extraction for all 3 source types (code uses `metadata.language`, wiki uses `metadata.languageTags`, review_comment classifies from `metadata.filePath`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated review handler telemetry tests for no-penalty behavior**
- **Found during:** Full test suite run after Task 2
- **Issue:** `createReviewHandler` tests expected `avgDistance = 0.315` and `distanceThreshold = 0.46` based on old Python penalty (`0.4 * 1.15 = 0.46`). With boost-only policy, Python gets `0.4 * 1.0 = 0.40`, giving `avgDistance = 0.285`.
- **Fix:** Updated test expectations and comments to reflect new correct values
- **Files modified:** `src/handlers/review.test.ts`
- **Verification:** All 72 review handler tests pass
- **Committed in:** `405331ac0b` (separate fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in tests reflecting old behavior)
**Impact on plan:** Necessary fix — tests were asserting the wrong behavior that was being removed. No scope creep.

## Issues Encountered

None — implementation proceeded directly from reading the codebase to implementing the plan.

## Self-Check: PASSED

- `src/knowledge/retrieval-rerank.ts` — FOUND
- `src/knowledge/retrieval.ts` — FOUND
- `src/knowledge/wiki-retrieval.ts` — FOUND
- `src/knowledge/retrieval-rerank.test.ts` — FOUND
- `src/knowledge/retrieval.test.ts` — FOUND
- `src/handlers/review.test.ts` — FOUND
- `.planning/phases/93-language-aware-retrieval-boosting/93-03-SUMMARY.md` — FOUND
- Commit `de97635e58` (Task 1) — FOUND
- Commit `51f6f0e222` (Task 2) — FOUND
- Commit `405331ac0b` (deviation fix) — FOUND

## Next Phase Readiness

- Language boosting fully wired in unified pipeline (LANG-03, LANG-04 complete)
- All 1336 tests pass
- Plan 04 can proceed: language signal integration for review handler (passing prLanguages from PR diff analysis)

---
*Phase: 93-language-aware-retrieval-boosting*
*Completed: 2026-02-25*

# Phase 93 Plan 02: Wiki Language Affinity Tag Detection Summary

**One-liner:** detectLanguageTags function added to wiki chunker detecting languages from fenced code blocks and prose mentions, wired through WikiPageChunk/WikiPageRecord types and wiki-store INSERT/SELECT for full persistence.

## What Was Built

Language affinity tagging for wiki pages is now complete end-to-end:

1. **`detectLanguageTags(rawText: string): string[]`** exported from `wiki-chunker.ts`:
   - Scans fenced code blocks with ` ```lang ` patterns, maps to canonical names via `CODE_BLOCK_LANG_ALIASES`
   - Detects prose language mentions (e.g. "TypeScript API", "Python implementation")
   - Returns `["general"]` when no languages detected
   - Returns sorted, deduplicated canonical names

2. **`chunkWikiPage`** updated to call `detectLanguageTags` on full page content before chunking, setting `languageTags` on every chunk (page-level analysis — all chunks get same tags).

3. **Type updates** in `wiki-types.ts`:
   - `WikiPageChunk.languageTags?: string[]` (optional, set by chunker)
   - `WikiPageRecord.languageTags: string[]` (always present after DB read)

4. **`wiki-store.ts`** updated:
   - `WikiRow.language_tags: string[]` internal type field
   - `rowToRecord` maps `language_tags` to `languageTags` with `?? []` fallback
   - Both `writeChunks` and `replacePageChunks` INSERT `language_tags` via `sql.array()`
   - Default to `["general"]` when chunk lacks `languageTags`

## Tests

- **wiki-chunker.test.ts**: 7 new tests — code block detection (python, c+cpp, js+python), alias normalization (py→python, js→javascript, ts→typescript), prose mention detection (TypeScript API), general fallback, and chunk wiring
- **wiki-store.test.ts**: 4 new tests — writeChunks stores tags, defaults to general, searchByEmbedding returns tags in results, replacePageChunks replaces old tags with new ones on re-ingest

All 30 chunker tests + all 16 store tests pass.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | bab4ebdc41 | feat(93-02): add language affinity tag detection to wiki chunker |
| 2 | af06517d3c | feat(93-02): wire language_tags through wiki-types and wiki-store |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/knowledge/wiki-chunker.ts` - FOUND (detectLanguageTags exported)
- `src/knowledge/wiki-types.ts` - FOUND (languageTags on both types)
- `src/knowledge/wiki-store.ts` - FOUND (language_tags in INSERT and rowToRecord)
- Commit bab4ebdc41 - FOUND
- Commit af06517d3c - FOUND

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
