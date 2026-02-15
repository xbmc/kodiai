---
phase: 32-multi-language-context-and-localized-output
plan: 02
subsystem: execution
tags: [prompt-engineering, i18n, multi-language, localization, review-prompt, mention-prompt]

# Dependency graph
requires:
  - phase: 31-incremental-re-review-with-retrieval-context
    provides: buildReviewPrompt with incremental and retrieval context sections
provides:
  - buildLanguageGuidanceSection() for injecting language-specific review rules
  - buildOutputLanguageSection() for localizing review prose to configured language
  - outputLanguage support in buildMentionPrompt()
  - LANGUAGE_GUIDANCE data map covering 9 languages
affects:
  - 32-03 (integration and wiring of language detection into review handler)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prompt section builder pattern: exported pure functions returning section strings"
    - "Language cap at 5 to prevent prompt bloat"
    - "Output language section placed last in prompt for recency bias compliance"

key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/execution/review-prompt.test.ts
    - src/execution/mention-prompt.ts
    - src/execution/mention-prompt.test.ts

key-decisions:
  - "TypeScript/JavaScript excluded from LANGUAGE_GUIDANCE -- already covered by base review rules"
  - "Language guidance capped at top 5 by file count to prevent prompt bloat (research Pitfall 3)"
  - "Output language section placed at end of prompt for recency bias compliance"
  - "Mention prompt uses simpler localization instruction (no taxonomy concerns)"

patterns-established:
  - "Language guidance data map: static Record keyed by language name with string[] rules"
  - "Output language preservation list: severity labels, category labels, code identifiers, snippets, file paths, YAML blocks must remain English"

# Metrics
duration: 3min
completed: 2026-02-13
---

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
