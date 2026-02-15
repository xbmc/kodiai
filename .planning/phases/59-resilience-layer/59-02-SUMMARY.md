---
phase: 59-resilience-layer
plan: 02
subsystem: lib
tags: [partial-review, retry, telemetry, sqlite]

# Dependency graph
requires: []
provides:
  - Partial review disclaimer formatter for timeout + retry outcomes
  - Adaptive retry scope computation excluding already-reviewed files
  - Telemetry chronic timeout query per repo+author (7-day window)
affects: [review-handler, timeout-resilience, retry]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure functions with unit tests, additive sqlite column migration with try/catch]

key-files:
  created:
    - src/lib/partial-review-formatter.ts
    - src/lib/partial-review-formatter.test.ts
    - src/lib/retry-scope-reducer.ts
    - src/lib/retry-scope-reducer.test.ts
  modified:
    - src/telemetry/types.ts
    - src/telemetry/store.ts

key-decisions:
  - "None - followed plan as specified"

patterns-established:
  - "Partial review disclaimers are blockquoted and prepend the draft body"
  - "Retry scope ratio adapts from 50%..100% of remaining based on reviewed fraction"

# Metrics
duration: 1min
completed: 2026-02-15
---

# Phase 59 Plan 02: Partial Formatter + Retry Scope + Chronic Timeout Telemetry Summary

**Pure-function building blocks for timeout resilience: partial review disclaimers, adaptive retry scope reduction, and repo+author chronic timeout detection.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-15T23:48:24Z
- **Completed:** 2026-02-15T23:49:19Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added `formatPartialReviewComment()` for consistent partial review disclaimers (timeout, retry result, retry skipped)
- Added `computeRetryScope()` to select a reduced retry file set based on risk and reviewed fraction
- Extended telemetry to store PR author and query recent timeouts per repo+author (7 days)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create partial review formatter and retry scope reducer with tests** - `af003c5cfc` (feat)
2. **Task 2: Add pr_author column and countRecentTimeouts to telemetry store** - `4d7e44a407` (feat)

## Files Created/Modified
- `src/lib/partial-review-formatter.ts` - Formats partial review disclaimer header and body
- `src/lib/partial-review-formatter.test.ts` - Verifies disclaimer formatting across timeout/retry/skipped cases
- `src/lib/retry-scope-reducer.ts` - Computes reduced retry scope excluding already-reviewed files
- `src/lib/retry-scope-reducer.test.ts` - Verifies exclusion, sorting, and adaptive scope ratio behavior
- `src/telemetry/types.ts` - Adds `prAuthor` field and optional `countRecentTimeouts` method
- `src/telemetry/store.ts` - Adds `pr_author` column migration, records author, and implements `countRecentTimeouts`

## Decisions Made
None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Handler integration can now format partial comments, compute retry file lists, and skip retry when chronic timeouts are detected

## Self-Check: PASSED
- Confirmed summary file exists on disk
- Confirmed task commits `af003c5cfc` and `4d7e44a407` exist in git history

---
*Phase: 59-resilience-layer*
*Completed: 2026-02-15*
