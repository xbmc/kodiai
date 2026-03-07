---
phase: 125-voice-preserving-updates
plan: 02
subsystem: knowledge
tags: [wiki, voice-preservation, formatting, templates, validation]

requires:
  - phase: 125-01
    provides: Voice analyzer, validator, types foundation
provides:
  - Post-generation template preservation check with retry-once-then-drop
  - Heading level validation between original and suggestion
  - Formatting novelty advisory (non-blocking)
  - Section length advisory at 150%+ threshold
  - Updated generation prompt encouraging formatting improvements and modernization
  - VoicePreservedUpdate type with advisory metadata fields
affects: [wiki-update-generator, publishing-pipeline]

tech-stack:
  added: []
  patterns: [post-generation-validation-checks, advisory-not-blocking-pattern, retry-once-then-drop]

key-files:
  created: []
  modified:
    - src/knowledge/wiki-voice-validator.ts
    - src/knowledge/wiki-voice-validator.test.ts
    - src/knowledge/wiki-voice-analyzer.ts
    - src/knowledge/wiki-voice-analyzer.test.ts
    - src/knowledge/wiki-voice-types.ts

key-decisions:
  - "Template check uses retry-once-then-drop: regenerate once on missing templates, drop suggestion entirely on second failure"
  - "Formatting novelty is advisory-only per CONTEXT.md: novel formatting encouraged, just flagged for visibility"
  - "Heading level check flags mismatches but does not block suggestion"

patterns-established:
  - "Advisory-not-blocking: formatting novelty and section length produce advisory metadata but never reject suggestions"
  - "Retry-once-then-drop: template preservation is a hard requirement with one retry before dropping"

requirements-completed: [VOICE-04, VOICE-05, VOICE-06, VOICE-07]

duration: 8min
completed: 2026-03-05
---

# Phase 125 Plan 02: Formatting Freedom & Post-Generation Validation Summary

**Generation prompt now encourages formatting improvements (code blocks, tables, bold) with post-generation template preservation checks, heading validation, and advisory formatting/length flags**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-05T20:43:13Z
- **Completed:** 2026-03-05T20:51:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added 4 post-generation validation functions: checkTemplatePreservation, checkHeadingLevels, checkFormattingNovelty, checkSectionLength
- Wired template check into generateWithVoicePreservation with retry-once-then-drop logic
- Replaced restrictive "ONLY use existing formatting" prompt with "IMPROVE formatting freely" encouragement
- Added NORMALIZE, REPLACE deprecated, PRESERVE heading levels instructions to generation prompt
- Updated VoicePreservedUpdate type to carry advisory metadata through pipeline
- Pipeline drops suggestions that fail template check twice

## Task Commits

Each task was committed atomically:

1. **Task 1: Post-generation validation checks** - `9ef33c3e00` (feat)
2. **Task 2: Update generation prompt for formatting freedom** - `bea96fea60` (feat)

## Files Created/Modified
- `src/knowledge/wiki-voice-validator.ts` - Added checkTemplatePreservation, checkHeadingLevels, checkFormattingNovelty, checkSectionLength; wired into generateWithVoicePreservation
- `src/knowledge/wiki-voice-validator.test.ts` - Added tests for all 4 new check functions
- `src/knowledge/wiki-voice-analyzer.ts` - Replaced restrictive constraints with formatting freedom prompt; pipeline drops failed template suggestions
- `src/knowledge/wiki-voice-analyzer.test.ts` - Updated prompt constraint tests for new instructions
- `src/knowledge/wiki-voice-types.ts` - Added templateCheckPassed, headingCheckPassed, formattingAdvisory, sectionLengthAdvisory to VoicePreservedUpdate

## Decisions Made
- Template check uses retry-once-then-drop: regenerate once with explicit feedback about missing templates, drop suggestion entirely on second failure
- Formatting novelty is advisory-only per CONTEXT.md: novel formatting (code blocks, tables, bold) encouraged and flagged but never blocks
- Heading level check flags mismatches but does not block (non-blocking like formatting novelty)
- Section length advisory triggers at 150% of original character count

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Voice-preserving pipeline now has complete post-generation validation
- Advisory metadata propagates through VoicePreservedUpdate for future surfacing in published comments
- wiki-update-generator.ts (consumer) is out of scope per plan -- carries new fields through without modification

---
*Phase: 125-voice-preserving-updates*
*Completed: 2026-03-05*
