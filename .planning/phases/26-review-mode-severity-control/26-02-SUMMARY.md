---
phase: 26-review-mode-severity-control
plan: 02
subsystem: review-prompt
tags: [prompt-engineering, severity, noise-suppression, focus-areas, review-mode]

# Dependency graph
requires:
  - phase: 26-01
    provides: "Extended reviewSchema with mode, severity, focusAreas, ignoredAreas, maxComments fields"
provides:
  - "Mode-aware buildReviewPrompt() with severity classification, noise suppression, comment cap, focus area, and severity filter sections"
  - "Handler wiring from config fields to prompt builder"
affects: [review-pipeline, enhanced-mode-parsing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prompt-driven review control: all behavior changes via prompt instructions, no post-processing"
    - "Conditional prompt sections with empty-string return for disabled features"

key-files:
  created:
    - src/execution/review-prompt.test.ts
  modified:
    - src/execution/review-prompt.ts
    - src/handlers/review.ts

key-decisions:
  - "All review intelligence lives in prompt instructions, not in post-processing code"
  - "Noise suppression and severity guidelines always included regardless of mode"
  - "Custom instructions override noise suppression rules (user intent takes priority)"

patterns-established:
  - "Helper function per prompt section pattern with empty-string return for conditional inclusion"

# Metrics
duration: 2min
completed: 2026-02-11
---

# Phase 26 Plan 02: Review Prompt Enrichment Summary

**Mode-aware prompt builder with severity classification, noise suppression, comment cap, focus areas, and standard/enhanced format instructions**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-11T22:34:34Z
- **Completed:** 2026-02-11T22:36:49Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Enriched buildReviewPrompt() with 6 new prompt sections: severity classification, mode format, noise suppression, comment cap, severity filter, focus areas
- Standard mode backward compatible with severity prefix format; enhanced mode uses structured YAML metadata
- Enhanced mode suppresses summary comment; standard mode preserves existing behavior
- Handler passes all 5 new config fields (mode, severity.minLevel, focusAreas, ignoredAreas, maxComments) to prompt builder
- 14 new tests covering all prompt enrichment features

## Task Commits

Each task was committed atomically:

1. **Task 1: Add mode-aware prompt sections to buildReviewPrompt()** - `15fefc35bf` (feat)
2. **Task 2: Add tests for review prompt enrichment** - `a3aa624b23` (test)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added 6 helper functions and integrated them into prompt assembly with mode-conditional summary/after-review sections
- `src/handlers/review.ts` - Updated buildReviewPrompt() call site to pass mode, severityMinLevel, focusAreas, ignoredAreas, maxComments from config
- `src/execution/review-prompt.test.ts` - 14 tests covering all prompt enrichment features

## Decisions Made
- All review intelligence is prompt-driven (no post-processing code changes needed)
- Noise suppression and severity classification guidelines are always included in both modes
- Custom instructions section remains last with explicit override precedence over noise suppression

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 26 complete: config schema (plan 01) + prompt enrichment (plan 02) deliver full review mode & severity control
- All 6 FOUND requirements satisfied via prompt instructions
- Enhanced mode parsing (future phase) can build on the YAML code block format established here
- 200 total tests pass (186 existing + 14 new)

## Self-Check: PASSED

All files found, all commits verified.

---
*Phase: 26-review-mode-severity-control*
*Completed: 2026-02-11*
