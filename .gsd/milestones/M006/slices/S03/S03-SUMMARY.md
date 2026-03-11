---
id: S03
parent: M006
milestone: M006
provides:
  - "End-to-end wiring of language classification data from diff analysis into review prompt"
  - "End-to-end wiring of output language config into both review and mention prompts"
  - "Operator-visible detectedLanguages count in diff-analysis log entry"
  - buildLanguageGuidanceSection() for injecting language-specific review rules
  - buildOutputLanguageSection() for localizing review prose to configured language
  - outputLanguage support in buildMentionPrompt()
  - LANGUAGE_GUIDANCE data map covering 9 languages
  - "EXTENSION_LANGUAGE_MAP constant with ~30 file extensions mapped to canonical language names"
  - "classifyFileLanguage() exported utility for single-file language detection"
  - "classifyLanguages() exported utility for batch file language grouping"
  - "DiffAnalysis.filesByLanguage field populated during analyzeDiff()"
  - "review.outputLanguage config field with default 'en'"
requires: []
affects: []
key_files: []
key_decisions:
  - "No new decisions -- wiring follows patterns established in 32-01 and 32-02"
  - "TypeScript/JavaScript excluded from LANGUAGE_GUIDANCE -- already covered by base review rules"
  - "Language guidance capped at top 5 by file count to prevent prompt bloat (research Pitfall 3)"
  - "Output language section placed at end of prompt for recency bias compliance"
  - "Mention prompt uses simpler localization instruction (no taxonomy concerns)"
  - "Extension map covers ~30 extensions across 20 languages; Unknown files omitted from filesByLanguage"
  - "outputLanguage is free-form z.string() not an enum -- LLMs understand both ISO codes and full names"
  - "h files default to C per research decision; C++ guidance also covers C headers"
patterns_established:
  - "Language context fields grouped with other enrichment data (after retrievalContext) in buildReviewPrompt call"
  - "Language guidance data map: static Record keyed by language name with string[] rules"
  - "Output language preservation list: severity labels, category labels, code identifiers, snippets, file paths, YAML blocks must remain English"
  - "Language classification integrated into analyzeDiff() after category loop with zero performance cost"
  - "Config field defaults in both schema definition and .default() object for section-fallback compatibility"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# S03: Multi Language Context And Localized Output

**# Phase 32 Plan 03: Handler Wiring for Language Context and Output Localization Summary**

## What Happened

# Phase 32 Plan 03: Handler Wiring for Language Context and Output Localization Summary

**Wired filesByLanguage from diff analysis and outputLanguage from config into review and mention handler prompt builder calls, completing end-to-end multi-language support**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T17:03:45Z
- **Completed:** 2026-02-13T17:05:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Wired filesByLanguage and outputLanguage into buildReviewPrompt call in review handler
- Wired outputLanguage into buildMentionPrompt call in mention handler
- Added detectedLanguages count to diff-analysis log entry for operator visibility
- All 363 existing tests pass without modification (fully backward compatible)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire filesByLanguage and outputLanguage into review handler** - `910d83d7a6` (feat)
2. **Task 2: Wire outputLanguage into mention handler** - `fb0b3df3b2` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Added filesByLanguage, outputLanguage to buildReviewPrompt call; detectedLanguages to log entry
- `src/handlers/mention.ts` - Added outputLanguage to buildMentionPrompt call

## Decisions Made
None - followed plan as specified. All wiring patterns were straightforward data threading.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 32 (Multi-Language Context and Localized Output) is fully complete
- All three plans delivered: language classification (32-01), prompt guidance (32-02), handler wiring (32-03)
- End-to-end feature: file language detection flows through to review prompts, output language config flows through to both review and mention prompts
- No blockers for next phase

## Self-Check: PASSED

All files verified present. Both task commits verified in git log.

---
*Phase: 32-multi-language-context-and-localized-output*
*Completed: 2026-02-13*

# Phase 32 Plan 02: Prompt Language Guidance and Output Localization Summary

**Language-specific review guidance for 9 languages (Python, Go, Rust, Java, C++, C, Ruby, PHP, Swift) with output language localization preserving canonical severity/category taxonomy in English**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T16:58:15Z
- **Completed:** 2026-02-13T17:01:04Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- LANGUAGE_GUIDANCE data map with idiomatic review rules for 9 languages (3-4 rules each)
- buildLanguageGuidanceSection() sorts by file count, caps at 5 languages, includes taxonomy preservation note
- buildOutputLanguageSection() with explicit English preservation list for severity/category/code/paths/YAML
- outputLanguage param added to buildMentionPrompt() with simpler prose-only localization
- 17 new tests (13 for review-prompt, 4 for mention-prompt) all passing
- Full test suite (363 tests) passes with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add language guidance and output language section builders to review-prompt.ts** - `f937d56d84` (feat)
2. **Task 2: Add outputLanguage support to mention-prompt.ts** - `5a7ab9ec03` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added LANGUAGE_GUIDANCE map, buildLanguageGuidanceSection(), buildOutputLanguageSection(), updated buildReviewPrompt context type and section insertion
- `src/execution/review-prompt.test.ts` - Added 13 tests for language guidance and output language sections
- `src/execution/mention-prompt.ts` - Added outputLanguage optional param with localization instruction
- `src/execution/mention-prompt.test.ts` - Added 4 tests for outputLanguage behavior

## Decisions Made
- TypeScript/JavaScript excluded from LANGUAGE_GUIDANCE since already covered by base review rules
- Language guidance capped at top 5 by file count to prevent prompt bloat (per research Pitfall 3)
- Output language section placed at end of prompt (after custom instructions) for recency bias compliance
- Mention prompt uses simpler localization instruction without taxonomy preservation (no severity/category in mention responses)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Language guidance and output language prompt sections are ready for integration
- Plan 32-03 can wire filesByLanguage and outputLanguage into the review handler call sites
- All exports are available: buildLanguageGuidanceSection, buildOutputLanguageSection, LANGUAGE_GUIDANCE

## Self-Check: PASSED

All 5 files verified on disk. Both task commits (f937d56d84, 5a7ab9ec03) verified in git log.

---
*Phase: 32-multi-language-context-and-localized-output*
*Completed: 2026-02-13*

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
