---
phase: 07-operational-resilience
plan: 02
subsystem: error-handling
tags: [error-reporting, github-comments, error-classification, handler-wiring]

# Dependency graph
requires:
  - phase: 07-01
    provides: "classifyError, formatErrorComment, postOrUpdateErrorComment from src/lib/errors.ts"
  - phase: 04-02
    provides: "Review handler with executor integration"
  - phase: 05-02
    provides: "Mention handler with tracking comment and executor integration"
provides:
  - "Review handler with error comment posting on all failure paths"
  - "Mention handler with classified error reporting via shared errors module"
  - "No more silent failures in either handler"
affects: [08-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Error comment posting on all failure paths", "trackingCommentId passthrough for mention handler updates", "No tracking comment for review handler (review itself is the output)"]

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/handlers/mention.ts

key-decisions:
  - "Review handler creates new error comments (no tracking comment) -- the review itself is the output"
  - "Mention handler passes trackingCommentId to postOrUpdateErrorComment for update-or-create behavior"
  - "Both handlers catch error comment posting failures separately so they never mask the original error"

patterns-established:
  - "Error comment pattern: classifyError -> formatErrorComment -> postOrUpdateErrorComment on all failure paths"
  - "Defense-in-depth: outer catch wraps error comment posting in its own try/catch"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 7 Plan 2: Error Reporting Wiring Summary

**Wired classified error comments into review and mention handlers so every failure path posts an actionable user-visible message**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T16:27:29Z
- **Completed:** 2026-02-08T16:29:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Review handler now posts classified error comments on PR for execution errors, timeouts, clone failures, and unhandled exceptions
- Mention handler replaced hardcoded `trackingError` function with shared `formatErrorComment` from errors module
- Removed "Something went wrong" generic message, replaced with category-specific headers and actionable suggestions
- Both handlers handle failed error comment posting gracefully (catch, log, never mask original error)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire error reporting into review handler** - `47c3594` (feat)
2. **Task 2: Upgrade mention handler error reporting** - `bd35d66` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `src/handlers/review.ts` - Added error imports, executor error path posting, outer catch error comment posting
- `src/handlers/mention.ts` - Replaced trackingError with shared errors module, upgraded both error paths

## Decisions Made
- Review handler does NOT use a tracking comment -- per research, the review itself is the output; only post a comment when something goes wrong
- Mention handler passes `trackingCommentId` through to `postOrUpdateErrorComment` so it updates the existing tracking comment (or creates a new one if tracking comment creation failed)
- Error comment posting failures are caught in their own try/catch blocks to prevent masking the original error (Pitfall 6 from research)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 7 (Operational Resilience) is now complete
- All error paths in both handlers post user-visible, actionable error comments
- Ready for Phase 8 (Deployment) -- Docker packaging and Azure Container Apps
- Blockers for Phase 8: Azure Container Apps not yet provisioned, Claude CLI on Alpine untested

## Self-Check: PASSED

- FOUND: src/handlers/review.ts
- FOUND: src/handlers/mention.ts
- FOUND: commit 47c3594 (Task 1)
- FOUND: commit bd35d66 (Task 2)

---
*Phase: 07-operational-resilience*
*Completed: 2026-02-08*
