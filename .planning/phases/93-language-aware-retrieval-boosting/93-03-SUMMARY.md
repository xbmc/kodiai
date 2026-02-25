---
phase: 93-language-aware-retrieval-boosting
plan: 03
subsystem: knowledge
tags: [retrieval, language-detection, rrf, ranking, boost]

# Dependency graph
requires:
  - phase: 93-01
    provides: RELATED_LANGUAGES map, classifyFileLanguageWithContext, LearningMemoryRecord.language field
  - phase: 93-02
    provides: languageTags on WikiPageRecord/WikiPageChunk
provides:
  - Language boosting in unified pipeline step 6e (proportional, boost-only)
  - refactored rerankByLanguage — stored language, no penalty, related language affinity
  - WikiKnowledgeMatch.languageTags field wired through searchWikiPages
  - language field in code chunk metadata (memoryToUnified)
  - languageTags field in wiki chunk metadata (wikiMatchToUnified)
affects: [retrieval-consumers, review-handler-telemetry, retrieval-quality-metrics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Boost-only language policy — non-matching results never penalized, only matching ones boosted
    - Proportional language weighting — build weight map from PR language distribution before boosting
    - Single location for language boosting per pipeline path (legacy findings: rerankByLanguage; unified: step 6e)
    - Related language affinity via RELATED_LANGUAGES map at 50% of exact-match boost

key-files:
  created: []
  modified:
    - src/knowledge/retrieval-rerank.ts
    - src/knowledge/retrieval-rerank.test.ts
    - src/knowledge/retrieval.ts
    - src/knowledge/retrieval.test.ts
    - src/knowledge/wiki-retrieval.ts
    - src/handlers/review.test.ts

key-decisions:
  - "Boost-only policy: non-matching language results keep original score, never penalized (LANG-03/LANG-04)"
  - "Language boosting in two pipeline paths: rerankByLanguage for legacy findings[], step 6e for unified results — no double-boost because memoryToUnified reads original distance"
  - "Proportional multi-language weights: 80% C++ PR boosts C++ results more than 50% C++ PR"
  - "Related language affinity at 50% of exact boost (relatedLanguageRatio = 0.5)"
  - "Stored record.language takes precedence; fallback to classifyFileLanguage(filePath) for old records without language field"

patterns-established:
  - "buildProportionalLanguageWeights: normalize prLanguages to lowercase weight map before boosting"
  - "getChunkLanguage: extracts language from unified chunk — metadata.language for code, metadata.languageTags[0] for wiki, classifyFileLanguage(filePath) for review_comment"

requirements-completed: [LANG-03, LANG-04]

# Metrics
duration: 6min
completed: 2026-02-25
---

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
