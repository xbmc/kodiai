---
phase: 27-context-aware-reviews
plan: 03
subsystem: api
tags: [git, diff-collection, shallow-clone, regression-tests]
requires:
  - phase: 27-02
    provides: prompt enrichment and path-instruction wiring in review handler
provides:
  - Resilient review diff collection that recovers or gracefully falls back when merge-base is unavailable
  - Structured logging for diff strategy outcomes during review execution
  - Regression coverage for no-merge-base flows and backward compatibility without Phase 27 fields
affects: [review-handler, review-prompt, UAT]
tech-stack:
  added: []
  patterns: [adaptive git history recovery before triple-dot diff, deterministic two-dot fallback]
key-files:
  created: [.planning/phases/27-context-aware-reviews/27-03-SUMMARY.md]
  modified: [src/handlers/review.ts, src/handlers/review.test.ts]
key-decisions:
  - "Use adaptive deepen plus unshallow attempts before switching from triple-dot to two-dot diff"
  - "Collect changed files, numstat, and full diff from one resolved diff range so prompt context stays aligned"
patterns-established:
  - "Diff collection logs strategy metadata under gate=diff-collection for operational diagnosis"
  - "No-merge-base review regressions are validated by behavior-based handler tests, not git stderr string matching"
duration: 1 min
completed: 2026-02-12
---

# Phase 27 Plan 03: Context-Aware Reviews Summary

**Review execution now survives no-merge-base shallow ancestry by recovering base history when possible and falling back to deterministic two-dot diff collection without skipping path-aware prompt enrichment.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-12T03:27:30Z
- **Completed:** 2026-02-12T03:27:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added a resilient diff collection helper in the review handler that checks merge-base, deepens fetch history, attempts unshallow recovery, and falls back safely.
- Unified `--name-only`, `--numstat`, and full diff extraction under one chosen range to keep changed-file matching and diff analysis in sync.
- Added structured logs for diff strategy, attempts, and merge-base recovery outcomes.
- Added regression tests proving no-merge-base flows still execute review prompt generation and that path instructions continue to apply.
- Added backward-compatibility coverage for repos that omit Phase 27 review config fields.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden review diff collection for shallow clone merge-base gaps** - `fb980b2191` (feat)
2. **Task 2: Add regression tests for no-merge-base shallow ancestry flow** - `5a0794eafb` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Added adaptive merge-base recovery and deterministic fallback diff strategy with structured logging.
- `src/handlers/review.test.ts` - Added no-merge-base continuation and backward-compat regression tests.

## Decisions Made
- Prioritized continuity of review execution over hard failure when merge-base is unavailable by using bounded recovery attempts plus deterministic fallback.
- Kept fallback behavior deterministic and observable by logging the strategy and retry metadata under a stable log gate key.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 27 UAT blocker is addressed in code and tests; live review can proceed without early exit-128 failures on no-merge-base topology.
- Phase 28 can build on stable review execution and context enrichment flow without additional diff-handling changes.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/27-context-aware-reviews/27-03-SUMMARY.md`.
- Verified task commits `fb980b2191` and `5a0794eafb` exist in git history.
