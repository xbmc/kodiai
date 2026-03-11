---
id: T01
parent: S03
milestone: M005
provides:
  - "EXTENSION_LANGUAGE_MAP constant with ~30 file extensions mapped to canonical language names"
  - "classifyFileLanguage() exported utility for single-file language detection"
  - "classifyLanguages() exported utility for batch file language grouping"
  - "DiffAnalysis.filesByLanguage field populated during analyzeDiff()"
  - "review.outputLanguage config field with default 'en'"
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# T01: 32-multi-language-context-and-localized-output 01

**# Phase 32 Plan 01: Language Classification and Output Language Config Summary**

## What Happened

# Phase 32 Plan 01: Language Classification and Output Language Config Summary

**Extension-based language classification on DiffAnalysis and review.outputLanguage config field for localized output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T16:58:11Z
- **Completed:** 2026-02-13T17:00:51Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added EXTENSION_LANGUAGE_MAP covering ~30 extensions across 20 programming languages
- Extended DiffAnalysis interface with filesByLanguage populated during analyzeDiff() at zero I/O cost
- Added review.outputLanguage config field with "en" default and section-fallback support
- Full test coverage: 6 new diff-analysis tests, 4 new config tests, all 363 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Add extension-to-language map and classify functions** - `1ca0a8e655` (feat)
2. **Task 2: Add review.outputLanguage to config schema** - `ea47badd6f` (feat)

**Deviation fix:** `389394f61a` (fix: update review-prompt test mock)

## Files Created/Modified
- `src/execution/diff-analysis.ts` - EXTENSION_LANGUAGE_MAP, classifyFileLanguage(), classifyLanguages(), DiffAnalysis.filesByLanguage
- `src/execution/diff-analysis.test.ts` - Tests for language classification functions and analyzeDiff integration
- `src/execution/config.ts` - review.outputLanguage field in reviewSchema with default "en"
- `src/execution/config.test.ts` - Tests for outputLanguage default, explicit values, and fallback
- `src/execution/review-prompt.test.ts` - Updated baseDiffAnalysis mock to include filesByLanguage

## Decisions Made
- Extension map covers 20 languages with ~30 extensions; "Unknown" files omitted from filesByLanguage (no guidance value)
- outputLanguage is free-form string (not enum) per research recommendation -- LLMs understand both ISO codes ("ja") and full names ("Japanese")
- h files default to C per research decision; C++ guidance also covers C headers

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated review-prompt test mock for DiffAnalysis interface change**
- **Found during:** Overall verification (TypeScript compile check)
- **Issue:** review-prompt.test.ts baseDiffAnalysis mock did not include the new filesByLanguage field, causing TS2322 type error
- **Fix:** Added filesByLanguage property to the baseDiffAnalysis mock function
- **Files modified:** src/execution/review-prompt.test.ts
- **Verification:** bunx tsc --noEmit passes for this file, all 363 tests pass
- **Committed in:** 389394f61a

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for type safety after interface extension. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- filesByLanguage data ready for Plan 02 to consume in language-aware prompt guidance
- outputLanguage config ready for Plan 02/03 to thread through review pipeline
- No blockers for next plan

## Self-Check: PASSED

All 6 files verified present. All 3 commit hashes verified in git log.

---
*Phase: 32-multi-language-context-and-localized-output*
*Completed: 2026-02-13*
