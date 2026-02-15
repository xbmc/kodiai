---
phase: 28-knowledge-store-explicit-learning
plan: 06
subsystem: api
tags: [review-prompt, metrics, regression-tests, uat-gap]
requires:
  - phase: 28-knowledge-store-explicit-learning
    provides: prompt and handler wiring from plan 28-03
provides:
  - unconditional review metrics/details contract across review modes
  - standard-mode regression coverage for review details quantitative fields
affects: [review-execution, prompt-contract, uat]
tech-stack:
  added: []
  patterns: [shared prompt contract across modes, explicit quantitative output requirements]
key-files:
  created: []
  modified: [src/execution/review-prompt.ts, src/execution/review-prompt.test.ts]
key-decisions:
  - "Review Details metrics requirements must be mode-agnostic because runtime defaults to standard mode"
  - "Tests assert explicit files/lines/severity-count fields to prevent future contract weakening"
patterns-established:
  - "Review metrics instructions are appended unconditionally after confidence instructions"
  - "Standard-mode prompt tests lock quantitative details expectations"
duration: 1 min
completed: 2026-02-12
---

# Phase 28 Plan 06: UAT Gap 2 Metrics Contract Summary

**Review prompts now always require a quantitative collapsible Review Details section (files reviewed, lines analyzed, severity counts) in both standard and enhanced modes.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-12T07:54:22Z
- **Completed:** 2026-02-12T07:55:01Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed enhanced-only gating so metrics instructions are always included in `buildReviewPrompt`
- Strengthened metrics wording to explicitly require collapsible `Review Details` with files, lines, and severity totals
- Added standard-mode regression assertions to fail if quantitative details requirements are removed

## Task Commits

Each task was committed atomically:

1. **Task 1: Make metrics/details prompt contract unconditional** - `5a3073cd20` (feat)
2. **Task 2: Add standard-mode regression tests for metrics/details** - `777d87f315` (test)

## Files Created/Modified
- `src/execution/review-prompt.ts` - made metrics instructions unconditional and expanded required Review Details fields
- `src/execution/review-prompt.test.ts` - added standard-mode contract regression tests and stronger metrics assertions

## Decisions Made
- Unified metrics/details output requirements across modes so default `standard` runtime behavior still enforces quantitative reporting
- Locked prompt contract with explicit assertion text for files reviewed, lines analyzed/changed, and severity-grouped issue counts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adjusted TypeScript verification invocation for Bun TS extension imports**
- **Found during:** Task 1 (Make metrics/details prompt contract unconditional)
- **Issue:** Plan-specified `bunx tsc --noEmit src/execution/review-prompt.ts` failed with TS5097 because this codebase uses `.ts` import extensions and single-file invocation needed explicit allowance.
- **Fix:** Verified with `bunx tsc --noEmit --allowImportingTsExtensions src/execution/review-prompt.ts`.
- **Files modified:** None (verification command adjustment only)
- **Verification:** Command exits successfully; task implementation type-checks.
- **Committed in:** N/A (no file changes)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Verification semantics preserved; no scope creep or behavior change beyond intended contract fix.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Prompt contract now matches UAT expectation for quantitative review details regardless of mode
- Ready to continue remaining phase 28 gap-closure work (plan 28-05)

## Self-Check: PASSED
- Verified `28-06-SUMMARY.md` exists on disk.
- Verified task commit objects `5a3073cd20` and `777d87f315` exist in git history.

---
*Phase: 28-knowledge-store-explicit-learning*
*Completed: 2026-02-12*
