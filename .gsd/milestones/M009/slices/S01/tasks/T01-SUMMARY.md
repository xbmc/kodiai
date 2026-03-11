---
id: T01
parent: S01
milestone: M009
provides:
  - estimateTimeoutRisk() pure function for timeout risk classification
  - computeLanguageComplexity() pure function for weighted language risk
  - TimeoutEstimate and TimeoutRiskLevel types
  - ExecutionContext.dynamicTimeoutSeconds field
  - RepoConfig.timeout subsection with dynamicScaling and autoReduceScope flags
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# T01: 51-timeout-resilience 01

**# Phase 51 Plan 01: Timeout Estimation Engine Summary**

## What Happened

# Phase 51 Plan 01: Timeout Estimation Engine Summary

**Pure-function timeout estimator with dynamic scaling (0.5x-1.5x base) using LANGUAGE_RISK weighted complexity, wired into executor via ExecutionContext.dynamicTimeoutSeconds**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T22:12:56Z
- **Completed:** 2026-02-14T22:15:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created timeout estimator module with two pure functions: estimateTimeoutRisk() and computeLanguageComplexity()
- 17 unit tests covering small/medium/large PRs, edge cases, clamping, and proportional scaling
- Extended ExecutionContext with dynamicTimeoutSeconds field, executor uses it when present
- Added timeout config subsection (dynamicScaling, autoReduceScope) with zod validation and fallback defaults

## Task Commits

Each task was committed atomically:

1. **Task 1: Create timeout estimator module with tests** - `ba9c1e4ae3` (feat)
2. **Task 2: Wire dynamic timeout into executor and config** - `fc040359fa` (feat)

## Files Created/Modified
- `src/lib/timeout-estimator.ts` - Pure functions for timeout risk estimation and language complexity
- `src/lib/timeout-estimator.test.ts` - 17 unit tests for timeout estimator
- `src/execution/types.ts` - Added dynamicTimeoutSeconds to ExecutionContext
- `src/execution/executor.ts` - Dynamic timeout override with source logging
- `src/execution/config.ts` - Timeout subsection schema with dynamicScaling and autoReduceScope flags

## Decisions Made
- Timeout formula `base * (0.5 + complexity)` gives natural 0.5x-1.5x range without additional parameters
- Scope reduction cap at 50 files aligns with existing largePR.fileThreshold default
- Both dynamic features default to enabled (opt-out rather than opt-in) since they are safe enhancements

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Timeout estimator ready for Plan 02 to integrate scope reduction and informative timeout messages
- ExecutionContext.dynamicTimeoutSeconds ready for review/mention handlers to populate from estimateTimeoutRisk()
- Config flags (dynamicScaling, autoReduceScope) ready for handler-level gating

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 51-timeout-resilience*
*Completed: 2026-02-14*
