---
phase: 27-context-aware-reviews
plan: 01
subsystem: api
tags: [zod, picomatch, review-config, diff-analysis]
requires:
  - phase: 26-review-mode-severity-control
    provides: review mode and severity/focus config baseline
provides:
  - Extended review schema with path instructions, profile presets, and file category overrides
  - Deterministic diff analysis module with risk signals and metrics
  - Focused test coverage for schema fallback and diff-analysis boundaries
affects: [27-02, review-prompt, review-handler]
tech-stack:
  added: []
  patterns: [section-level config fallback, pure diff analysis function]
key-files:
  created: [src/execution/diff-analysis.ts, src/execution/diff-analysis.test.ts]
  modified: [src/execution/config.ts, src/execution/config.test.ts]
key-decisions:
  - "Path instruction config uses array entries with string|string[] paths and defaults to empty list"
  - "Diff analysis categorizes only first 200 files but always computes metrics across all changed files"
patterns-established:
  - "Pure analysis modules receive git outputs as inputs and perform no shell I/O"
  - "Review schema additions remain additive with section-level fallback preserving resilience"
duration: 3min
completed: 2026-02-12
---

# Phase 27 Plan 01: Context-Aware Reviews Summary

**Review config now supports path-scoped instruction and profile metadata, plus a deterministic diff analyzer that emits category/risk/metric context for prompt enrichment.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T01:52:56Z
- **Completed:** 2026-02-12T01:55:27Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended `reviewSchema` with `pathInstructions`, `profile`, and `fileCategories` while preserving additive defaults and section fallback behavior.
- Added config tests that validate parsing, optional/default behavior, invalid-section fallback, and coexistence with Phase 26 fields.
- Introduced `analyzeDiff()` in a new pure module with capped classification, risk signal detection, numstat metrics, and large-PR detection.
- Added 15 targeted diff-analysis tests for categories, overrides, risk signals, hunk counting, content limits, and analysis caps.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pathInstructions, profile, and fileCategories to config schema** - `710813888c` (feat)
2. **Task 2: Create deterministic diff analysis module** - `9675b9e938` (feat)

## Files Created/Modified
- `src/execution/config.ts` - Added new review schema fields and defaults for path instructions.
- `src/execution/config.test.ts` - Added coverage for new schema parsing, optionality, fallback, and compatibility.
- `src/execution/diff-analysis.ts` - Added pure diff analyzer with categorization, risk signal checks, and metrics.
- `src/execution/diff-analysis.test.ts` - Added comprehensive tests for deterministic diff analysis behavior.

## Decisions Made
- Kept `fileCategories` override behavior additive to default category patterns so existing classification remains stable.
- Implemented fixed performance boundaries (`MAX_ANALYSIS_FILES = 200`, content scan < 50KB) and separated classification scope from global metrics scope.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can now import `analyzeDiff()` and consume stable `review.pathInstructions`/`review.profile`/`review.fileCategories` config inputs.
- Prompt and handler wiring can proceed without additional schema or analysis groundwork.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/27-context-aware-reviews/27-01-SUMMARY.md`.
- Verified task commits `710813888c` and `9675b9e938` exist in git history.

---
*Phase: 27-context-aware-reviews*
*Completed: 2026-02-12*
