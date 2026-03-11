---
id: S04
parent: M024
milestone: M024
provides:
  - "Severity demotion for primarily-external findings (CRITICAL/MAJOR -> medium)"
  - "preDemotionSeverity audit field on ProcessedFinding"
  - "Structured logging for every demotion event"
requires: []
affects: []
key_files: []
key_decisions:
  - "Used preDemotionSeverity instead of originalSeverity to avoid collision with enforcement's existing originalSeverity field"
  - "Demotion applied via demotionMap lookup in processedFindings construction, ensuring downstream code sees demoted severity"
patterns_established:
  - "Severity demotion as immutable transform: returns new objects, inputs never mutated"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-03-03
blocker_discovered: false
---
# S04: Severity Demotion

**# Phase 118 Plan 01: Severity Demotion Summary**

## What Happened

# Phase 118 Plan 01: Severity Demotion Summary

**Severity demoter module capping primarily-external CRITICAL/MAJOR findings at medium, with structured demotion logging and fail-open on missing classification**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T01:05:57Z
- **Completed:** 2026-03-03T01:09:12Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `severity-demoter.ts` with `demoteExternalClaimSeverities` function using immutable transform pattern
- 14 unit tests covering all severity/label combinations, fail-open, immutability, and logging
- Integrated demoter into review.ts pipeline between claim classification and processedFindings
- Demoted findings have severity="medium" so isFeedbackSuppressionProtected naturally sees medium and does NOT protect them

## Task Commits

Each task was committed atomically:

1. **Task 1a: TDD RED** - `f4b757fe5e` (test: add failing tests for severity demoter)
2. **Task 1b: TDD GREEN** - `07a59fd4cb` (feat: implement severity demoter module)
3. **Task 2: Integration** - `3b6121f1d2` (feat: integrate severity demoter into review pipeline)

## Files Created/Modified
- `src/lib/severity-demoter.ts` - Severity demotion logic: demotes primarily-external CRITICAL/MAJOR to medium
- `src/lib/severity-demoter.test.ts` - 14 unit tests covering all edge cases
- `src/handlers/review.ts` - Import, ProcessedFinding type update, demotion call + map, severity override in processedFindings

## Decisions Made
- Used `preDemotionSeverity` field name instead of `originalSeverity` to avoid collision with enforcement's existing `originalSeverity` on `EnforcedExtractedFinding`
- Demotion applied via demotionMap lookup pattern in processedFindings map callback, consistent with how claimClassificationMap is consumed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Severity demotion complete, findings with primarily-external claims capped at medium
- Phase 119 (Output Filtering) can now build on classified + demoted findings
- `ProcessedFinding` type carries `claimClassification`, `preDemotionSeverity`, `severityDemoted`, and `demotionReason` for downstream filtering decisions

---
*Phase: 118-severity-demotion*
*Completed: 2026-03-03*
