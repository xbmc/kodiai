---
phase: 09-review-ux-improvements
plan: 02
subsystem: execution
tags: [prompt-engineering, github-comments, review-ux, details-tag]

# Dependency graph
requires:
  - phase: 04-pr-auto-review
    provides: review-prompt.ts with buildReviewPrompt() function
provides:
  - Structured PR summary comment (what/why/files) in every auto-review
  - Trivial PR detection for short summaries
  - <details> wrapping for long summaries
affects: [review-ux, pr-auto-review]

# Tech tracking
tech-stack:
  added: []
  patterns: [prompt-driven summary comment, create_comment MCP tool for summaries]

key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts

key-decisions:
  - "Summary comment posted FIRST before inline comments to appear at top of PR conversation"
  - "Trivial PR threshold: fewer than 3 files AND under 50 lines changed"
  - "500-character threshold triggers <details> wrapping for long summaries"

patterns-established:
  - "Review prompt summary section: structured what/why/files format using create_comment MCP tool"

# Metrics
duration: 1min
completed: 2026-02-08
---

# Phase 9 Plan 2: PR Summary Comment Summary

**Review prompt now instructs Claude to post a structured what/why/files summary comment on every PR before inline review comments**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-08T19:25:30Z
- **Completed:** 2026-02-08T19:26:47Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Review prompt instructs Claude to post a structured summary comment (what changed / why / files modified) on every PR review
- Summary is posted BEFORE inline comments using the create_comment MCP tool so it appears at the top of the conversation
- Trivial PRs (fewer than 3 files, under 50 lines) receive a short 2-3 line summary
- Long summaries (over 500 characters) are wrapped in `<details>` tags to reduce noise
- Removed old "Do NOT post a summary comment" prohibition and updated Rules section to allow exactly one summary

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace "no summary" rule with structured summary instructions** - `f011726` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added "Summary comment" section with structured format, updated Rules to allow summary, updated "After review" to reference summary-first flow

## Decisions Made
- Summary posted FIRST (before inline comments) so it appears at the top of the PR conversation timeline
- Trivial PR threshold set at fewer than 3 files AND under 50 lines changed (matching plan spec)
- 500-character threshold for `<details>` wrapping (matching plan spec)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Review prompt complete with summary comment instructions
- No blockers for further UX improvements

## Self-Check: PASSED

- [x] `src/execution/review-prompt.ts` -- FOUND
- [x] Commit `f011726` -- FOUND in git log

---
*Phase: 09-review-ux-improvements*
*Completed: 2026-02-08*
