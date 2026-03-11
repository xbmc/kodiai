---
id: S01
parent: M009
milestone: M009
provides:
  - Pre-review timeout risk estimation integrated into review handler
  - Auto scope reduction for high-risk auto-profile PRs (minimal profile + capped files)
  - Informative timeout messages with PR complexity context (timeout vs timeout_partial)
  - Telemetry distinction between timeout and timeout_partial conclusions
  - estimateTimeoutRisk() pure function for timeout risk classification
  - computeLanguageComplexity() pure function for weighted language risk
  - TimeoutEstimate and TimeoutRiskLevel types
  - ExecutionContext.dynamicTimeoutSeconds field
  - RepoConfig.timeout subsection with dynamicScaling and autoReduceScope flags
  - timeout_partial test coverage in errors.test.ts
requires: []
affects: []
key_files: []
key_decisions:
  - "Scope reduction only applies when profileSelection.source === 'auto' (respects explicit user choices)"
  - "timeout_partial category used when isTimeout=true AND published=true (inline comments posted before timeout)"
  - "Config gating via config.timeout.autoReduceScope and config.timeout.dynamicScaling (both default enabled)"
  - "Timeout scales 0.5x-1.5x of base using formula base*(0.5+complexity), clamped [30,1800]"
  - "Scope reduction threshold at 50 files for high-risk PRs"
  - "Dynamic timeout defaults enabled (dynamicScaling=true, autoReduceScope=true)"
  - "Matched formatErrorComment assertion strings to actual SUGGESTIONS content ('partial review', 'inline comments')"
patterns_established:
  - "Pre-execution risk gating: estimate risk before execute(), reduce scope proactively"
  - "Context-aware error messages: include PR complexity reasoning in timeout messages"
  - "Pure function risk estimation: no I/O, deterministic, testable"
  - "Config subsection pattern: zod schema with safeParse fallback defaults"
observability_surfaces: []
drill_down_paths: []
duration: 1min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# S01: Timeout Resilience

**# Phase 51 Plan 02: Timeout Handler Integration Summary**

## What Happened

# Phase 51 Plan 02: Timeout Handler Integration Summary

**Review handler estimates timeout risk pre-execution, auto-reduces scope for high-risk auto-profile PRs, and posts informative timeout messages with PR complexity context**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T22:17:45Z
- **Completed:** 2026-02-14T22:21:05Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Integrated timeout estimation into review handler after profile selection, logging risk level and dynamic timeout
- Auto scope reduction for high-risk PRs: overrides to minimal profile and caps full-review file count when profile was auto-selected
- Replaced generic "timed out" errors with context-aware messages distinguishing partial reviews (published=true) from full timeouts
- Telemetry conclusion now records "timeout_partial" when inline comments were published before timeout

## Task Commits

Each task was committed atomically:

1. **Task 1: Add timeout estimation and scope reduction to review handler** - `ff85a541ac` (feat)
2. **Task 2: Replace generic timeout errors with informative messages** - `c016266348` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Timeout estimation, scope reduction, dynamic timeout passing, informative error messages, telemetry distinction
- `src/lib/errors.ts` - Added timeout_partial error category with header, suggestion, and classifyError published parameter

## Decisions Made
- Scope reduction respects explicit user profile choices (keyword or manual source) -- only auto-selected profiles are overridden
- timeout_partial category triggers when both isTimeout and published are true, giving users a "partial review completed" message instead of an error
- Config flags (autoReduceScope, dynamicScaling) gate features with !== false checks so they default to enabled

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four timeout resilience requirements satisfied: TMO-01 (estimation), TMO-02 (scope reduction), TMO-03 (informative messages), TMO-04 (dynamic timeout)
- Phase 51 complete -- mention handler could adopt the same pattern in a future phase
- Ready for next milestone phase

---
*Phase: 51-timeout-resilience*
*Completed: 2026-02-14*

## Self-Check: PASSED

All files exist. All commits verified.

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

# Phase 51 Plan 03: Timeout Partial Test Coverage Summary

**Added timeout_partial to errors.test.ts categories, expectedHeaders, classifyError, and formatErrorComment test suites**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-14T22:37:35Z
- **Completed:** 2026-02-14T22:38:33Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added timeout_partial to ErrorCategory categories array and expectedHeaders Record (fixes TypeScript compilation)
- Added classifyError test verifying isTimeout=true + published=true returns timeout_partial
- Added formatErrorComment test verifying timeout_partial produces partial review messaging
- All 19 tests pass (up from 17)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add timeout_partial test coverage to errors.test.ts** - `a24e11338a` (test)

## Files Created/Modified
- `src/lib/errors.test.ts` - Added timeout_partial to categories array, expectedHeaders, classifyError test, and formatErrorComment test

## Decisions Made
- Matched formatErrorComment assertion to actual SUGGESTIONS content: "partial review" and "inline comments" (from the timeout_partial suggestion text)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 51 timeout-resilience is fully complete with all test gaps closed
- Ready for Phase 52

---
*Phase: 51-timeout-resilience*
*Completed: 2026-02-14*
