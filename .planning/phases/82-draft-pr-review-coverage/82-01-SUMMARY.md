---
phase: 82-draft-pr-review-coverage
plan: 01
subsystem: review
tags: [draft-pr, review-prompt, tone-adjustment, comment-validation]

# Dependency graph
requires: []
provides:
  - "Draft PR review flow with soft tone and badge indicator"
  - "isDraft parameter threaded from handler to prompt builder"
  - "Comment-server validation for draft review summaries"
affects: [review-prompt, comment-server, review-handler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isDraft conditional in prompt builder for tone/badge switching"
    - "ready_for_review forces isDraft=false regardless of pr.draft payload"

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/execution/review-prompt.ts
    - src/execution/mcp/comment-server.ts
    - src/handlers/review.test.ts
    - src/execution/review-prompt.test.ts
    - src/execution/mcp/comment-server.test.ts

key-decisions:
  - "ready_for_review action forces isDraft=false regardless of pr.draft payload value"
  - "Draft framing only applies to standard template, not delta re-review template"

patterns-established:
  - "isDraft conditional spread in prompt lines array for optional content injection"

requirements-completed: [REV-01, REV-02]

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 82 Plan 01: Draft PR Review Coverage Summary

**Draft PRs now reviewed with soft suggestive tone, memo badge, and draft framing instead of being silently skipped; ready_for_review triggers normal-tone re-review**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T23:08:22Z
- **Completed:** 2026-02-23T23:12:45Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Removed draft PR skip logic; draft PRs now receive reviews with exploratory feedback
- Draft reviews display memo badge and "Draft" framing with suggestive language instructions
- ready_for_review events force normal tone regardless of pr.draft payload state
- Comment-server validates both standard and draft review summary tags
- Full test coverage across handler, prompt builder, and comment-server

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove draft skip, pass isDraft to prompt builder, add draft tone and badge** - `0b9e5504b0` (feat)
2. **Task 2: Add tests for draft PR review behavior** - `460fb8aea3` (test)

## Files Created/Modified
- `src/handlers/review.ts` - Removed draft skip, added isDraft derivation with ready_for_review override, passed isDraft to both prompt builder calls
- `src/execution/review-prompt.ts` - Added isDraft parameter, conditional draft badge/framing/tone instructions in standard template
- `src/execution/mcp/comment-server.ts` - Extended summary tag check to accept draft review summary format
- `src/handlers/review.test.ts` - Integration tests for draft PR review, ready_for_review normal tone, non-draft unchanged
- `src/execution/review-prompt.test.ts` - Unit tests for draft badge, framing, tone; standard mode unchanged; delta takes precedence
- `src/execution/mcp/comment-server.test.ts` - Validation tests for draft summary acceptance and missing-section rejection

## Decisions Made
- ready_for_review action forces isDraft=false regardless of pr.draft payload value (payload may still have draft=true during transition)
- Draft framing only applies to standard template; delta re-review template takes precedence when deltaContext is present

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Draft PR review flow complete and tested
- No blockers for subsequent phases

## Self-Check: PASSED

All 6 modified files verified on disk. Both task commits (0b9e5504b0, 460fb8aea3) verified in git log. All 1123 tests pass with 0 failures.

---
*Phase: 82-draft-pr-review-coverage*
*Completed: 2026-02-23*
