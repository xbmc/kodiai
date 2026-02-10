---
phase: 09-review-ux-improvements
plan: 04
subsystem: ux
tags: [details-tags, collapsible, review-prompt, mention-prompt, formatting]

# Dependency graph
requires:
  - phase: 09-01
    provides: "wrapInDetails utility with threshold, review/mention prompt foundations"
  - phase: 09-02
    provides: "Summary comment ordering, trivial PR detection"
provides:
  - "Unconditional <details> wrapping for all bot comments"
  - "Conditional review summary (only when issues found)"
  - "Collapsed tracking comment"
affects: [deployment, uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All bot comments wrapped in <details> tags unconditionally"
    - "Review summary only posted when actionable issues exist"

key-files:
  created: []
  modified:
    - src/lib/formatting.ts
    - src/lib/formatting.test.ts
    - src/execution/mention-prompt.ts
    - src/execution/review-prompt.ts
    - src/handlers/mention.ts

key-decisions:
  - "Removed 500-char COLLAPSE_THRESHOLD -- all bot comments now wrapped unconditionally"
  - "Review summary is conditional on finding actionable issues (clean PRs = zero comments)"
  - "Tracking comment uses <details> with 'Kodiai is thinking...' as summary text"

patterns-established:
  - "Always-collapse: every bot comment uses <details> tags regardless of length"
  - "Conditional summary: review prompt only generates summary when issues found"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 9 Plan 4: Conditional Summary and Always-Collapse Details Tags

**Removed length threshold from wrapInDetails, made review summaries conditional on finding issues, and collapsed all bot comments in `<details>` tags**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T20:12:09Z
- **Completed:** 2026-02-08T20:14:09Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- All bot comments (tracking, responses, errors, summaries) now wrapped in `<details>` tags unconditionally
- Review summary only posted when actionable issues are found -- clean PRs produce zero bot comments
- Tracking comment collapsed by default with "Kodiai is thinking..." summary
- Removed 500-character threshold logic from formatting utility and all prompts

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove length threshold from wrapInDetails and update mention prompt** - `1c015a3` (feat)
2. **Task 2: Change review prompt to only post summary when issues found** - `6521640` (feat)

## Files Created/Modified
- `src/lib/formatting.ts` - Removed COLLAPSE_THRESHOLD, wrapInDetails always wraps
- `src/lib/formatting.test.ts` - Updated 9 tests for threshold-free behavior
- `src/execution/mention-prompt.ts` - Changed "if over 500 chars" to "ALWAYS wrap"
- `src/execution/review-prompt.ts` - Conditional summary, removed trivial PR detection
- `src/handlers/mention.ts` - Tracking comment wrapped in `<details>` tags

## Decisions Made
- Removed 500-char COLLAPSE_THRESHOLD entirely -- all bot comments are now always collapsed to reduce noise
- Review summary is conditional on finding actionable issues (clean PRs = silent APPROVE, zero comments)
- Tracking comment uses `<details>` with "Kodiai is thinking..." as the summary line

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All gap closure plans (09-03, 09-04) complete
- Review UX improvements fully shipped: eyes reaction, summary ordering, conditional summary, always-collapse
- Ready for re-deployment to apply updated prompts

## Self-Check: PASSED

- All 5 modified files exist on disk
- Commit `1c015a3` (Task 1) verified in git log
- Commit `6521640` (Task 2) verified in git log
- All 9 formatting tests pass
- No COLLAPSE_THRESHOLD in formatting.ts
- "ONLY post a summary" in review-prompt.ts
- "ALWAYS wrap" in mention-prompt.ts
- `<details>` in mention.ts tracking comment

---
*Phase: 09-review-ux-improvements*
*Completed: 2026-02-08*
