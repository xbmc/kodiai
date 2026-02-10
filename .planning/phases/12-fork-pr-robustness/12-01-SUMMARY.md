---
phase: 12-fork-pr-robustness
plan: 01
subsystem: review
tags: [github, git, pull-request, workspace, bun]

# Dependency graph
requires: []
provides:
  - "Fork PR reviews clone base repo and fetch pull/<n>/head (no fork clone required)"
  - "Workspace helper for fetching+checking out PR head refs"
affects: [review-handler, workspace-manager, fork-pr-support]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fork PR checkout strategy: base clone at base ref + fetch pull/<n>/head:pr-review"
    - "Encapsulate PR head ref checkout in workspace module helper"

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/jobs/workspace.ts
    - src/handlers/review.test.ts

key-decisions:
  - "For fork (and deleted-fork) PRs, never clone pr.head.repo; clone base repo and fetch pull/<n>/head instead"

patterns-established:
  - "Log workspaceStrategy for PR reviews to make fork vs non-fork behavior explicit"

# Metrics
duration: 3 min
completed: 2026-02-10
---

# Phase 12 Plan 01: Fork PR Workspace Strategy Summary

**Fork PR review workspaces are now built by cloning the base repo and fetching `pull/<n>/head`, avoiding any dependency on cloning contributor forks.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-10T03:01:52Z
- **Completed:** 2026-02-10T03:05:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Updated review handler to use base-clone + PR ref fetch for fork/deleted-fork PRs
- Added workspace helper for fetch+checkout of PR head refs (`pull/<n>/head`)
- Added regression tests covering fork vs non-fork strategy selection

## Task Commits

Each task was committed atomically:

1. **Task 1: Switch fork PR checkout to base-clone + refs/pull fetch** - `c22fc1066a` (feat)
2. **Task 2: Add regression coverage for fork PR strategy selection** - `8094fbd078` (test)

**Plan metadata:** (docs commit updates SUMMARY + STATE)

## Files Created/Modified
- `src/handlers/review.ts` - Select base-clone + PR ref fetch strategy for fork/deleted-fork PRs; add strategy logging
- `src/jobs/workspace.ts` - Add `fetchAndCheckoutPullRequestHeadRef()` helper with PR number validation
- `src/handlers/review.test.ts` - Tests asserting fork PRs fetch `pull/<n>/head` and non-fork PRs keep direct head-branch clone

## Decisions Made
- For fork and deleted-fork PRs, use the base repo's `pull/<n>/head` ref rather than cloning `pr.head.repo`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `12-02-PLAN.md` (additional robustness coverage)

---
*Phase: 12-fork-pr-robustness*
*Completed: 2026-02-10*

## Self-Check: PASSED

- FOUND: `.planning/phases/12-fork-pr-robustness/12-01-SUMMARY.md`
- FOUND: `c22fc1066a` (Task 1)
- FOUND: `8094fbd078` (Task 2)
