---
id: T02
parent: S01
milestone: M011
provides:
  - Deterministic issue question to code-pointer extraction helper
  - Bounded path and line-anchor prompt context block for issue replies
  - Fail-open behavior for low-signal questions and adapter errors
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 3 min
verification_result: passed
completed_at: 2026-02-16
blocker_discovered: false
---
# T02: 60-issue-q-a 02

**# Phase 60 Plan 02: Issue Code Context Summary**

## What Happened

# Phase 60 Plan 02: Issue Code Context Summary

**Bounded issue question analysis now surfaces deterministic file-path pointers with optional line anchors for mention replies.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T06:03:06Z
- **Completed:** 2026-02-16T06:06:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `buildIssueCodeContext` with bounded tokenization, repo file filtering, and deterministic ranking.
- Added prompt-ready `contextBlock` generation and structured pointer output including optional line anchors.
- Added deterministic tests covering strong signal, weak signal, dedupe/max cap, tie ordering, and fail-open adapter errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement bounded issue code-context extractor** - `d8e496a70f` (feat)
2. **Task 2: Add deterministic tests for code-pointer extraction quality** - `85807077e2` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/execution/issue-code-context.ts` - Pure helper that derives bounded code pointers from issue questions.
- `src/execution/issue-code-context.test.ts` - Deterministic adapter-driven tests for ranking quality and fail-open safety.

## Decisions Made
- Used adapter injection (`globFiles`, `grepInFiles`, `readFile`) to keep extraction testable and deterministic without external services.
- Kept weak-signal threshold conservative (strongest score must be >= 2) so low-context questions degrade to empty output.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `buildIssueCodeContext` is ready to be wired into issue mention handling in Plan 60-03.
- Deterministic tests provide a stable contract for future handler integration.

## Self-Check: PASSED

- FOUND: `src/execution/issue-code-context.ts`
- FOUND: `src/execution/issue-code-context.test.ts`
- FOUND: `d8e496a70f`
- FOUND: `85807077e2`

---
*Phase: 60-issue-q-a*
*Completed: 2026-02-16*
