---
phase: 51-timeout-resilience
plan: 02
subsystem: execution
tags: [timeout, scope-reduction, error-messages, telemetry, review-handler]

# Dependency graph
requires:
  - phase: 51-timeout-resilience
    provides: estimateTimeoutRisk(), computeLanguageComplexity(), ExecutionContext.dynamicTimeoutSeconds, config.timeout subsection
provides:
  - Pre-review timeout risk estimation integrated into review handler
  - Auto scope reduction for high-risk auto-profile PRs (minimal profile + capped files)
  - Informative timeout messages with PR complexity context (timeout vs timeout_partial)
  - Telemetry distinction between timeout and timeout_partial conclusions
affects: [mention-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [pre-execution risk gating, context-aware error messages, scope reduction with user-choice respect]

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/lib/errors.ts

key-decisions:
  - "Scope reduction only applies when profileSelection.source === 'auto' (respects explicit user choices)"
  - "timeout_partial category used when isTimeout=true AND published=true (inline comments posted before timeout)"
  - "Config gating via config.timeout.autoReduceScope and config.timeout.dynamicScaling (both default enabled)"

patterns-established:
  - "Pre-execution risk gating: estimate risk before execute(), reduce scope proactively"
  - "Context-aware error messages: include PR complexity reasoning in timeout messages"

# Metrics
duration: 3min
completed: 2026-02-14
---

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
