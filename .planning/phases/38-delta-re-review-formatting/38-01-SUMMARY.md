---
phase: 38-delta-re-review-formatting
plan: 01
subsystem: review-output
tags: [delta-review, prompt-template, re-review, verdict-update, incremental-review]

# Dependency graph
requires:
  - phase: 34-structured-review-template
    provides: five-section summary template in buildReviewPrompt
  - phase: 36-verdict-and-merge-confidence
    provides: buildVerdictLogicSection helper pattern
  - phase: 31-incremental-re-review-with-retrieval-context
    provides: incrementalResult, priorFindings, buildIncrementalReviewSection
provides:
  - DeltaReviewContext type for delta review data threading
  - buildDeltaReviewContext() helper for prior findings context in prompt
  - buildDeltaVerdictLogicSection() helper for transition-based verdict logic
  - Conditional delta template in buildReviewPrompt() (FORMAT-14/15/16)
  - deltaContext parameter threading from review.ts to prompt builder
affects: [38-02 delta sanitizer, comment-server validation]

# Tech tracking
tech-stack:
  added: []
  patterns: [conditional-prompt-template, transition-verdict-logic, delta-review-context-threading]

key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/handlers/review.ts
    - src/execution/review-prompt.test.ts

key-decisions:
  - "Delta template replaces standard five-section template when deltaContext present; existing path completely unchanged"
  - "Delta verdict uses transition states (green=improved, blue=unchanged, yellow=worsened) not absolute states"
  - "Prior findings passed to prompt pre-execution so Claude can classify new/resolved/still-open naturally"
  - "Still-open findings show severity and file path but NOT line numbers (stale after code changes)"

patterns-established:
  - "Conditional prompt template: if (deltaContext) delta-path else standard-path, gate ALL changes on presence of context object"
  - "Transition verdict pattern: green_circle for improved, large_blue_circle for unchanged, yellow_circle for worsened"

# Metrics
duration: 3min
completed: 2026-02-13
---

# Phase 38 Plan 01: Delta Re-Review Template Summary

**Conditional delta re-review prompt template with DeltaReviewContext type, prior findings context builder, transition-based verdict logic, and deltaContext threading from review.ts**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T23:35:53Z
- **Completed:** 2026-02-13T23:39:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- buildReviewPrompt() conditionally produces delta template (Re-review header, What Changed, New Findings, Resolved Findings, Still Open, Verdict Update) when deltaContext is present
- DeltaReviewContext type, buildDeltaReviewContext(), and buildDeltaVerdictLogicSection() exported as standalone helpers
- review.ts hoists priorFindings and threads deltaContext to prompt builder when incremental mode with prior findings
- 6 new tests cover delta template generation, helpers, and non-regression of standard template
- All 442 tests pass across 25 files with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add delta template types, helpers, and conditional template in buildReviewPrompt** - `411e4cd9cd` (feat)
2. **Task 2: Thread deltaContext from review.ts and add prompt tests** - `8d00faec17` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added DeltaReviewContext type, buildDeltaReviewContext(), buildDeltaVerdictLogicSection(), deltaContext parameter, conditional delta template in summary comment section
- `src/handlers/review.ts` - Hoisted priorFindings variable, added deltaContext to buildReviewPrompt() call
- `src/execution/review-prompt.test.ts` - 6 new Phase 38 tests for delta template formatting

## Decisions Made
- Delta template replaces standard five-section template when deltaContext is present; the existing five-section template code remains completely unchanged in the else branch
- Delta verdict uses transition-based states: green_circle for blockers resolved (improved), large_blue_circle for still ready (unchanged), yellow_circle for new blockers found (worsened) -- distinct from initial review's absolute-state verdicts
- Prior findings are passed to the prompt pre-execution so Claude can naturally classify findings as new/resolved/still-open against the prior list
- Still-open findings display severity and file path but NOT line numbers, as line numbers may be stale after surrounding code changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Delta prompt template complete, ready for 38-02 (delta sanitizer validation in comment-server.ts)
- The discriminator for sanitizer routing is `<summary>Kodiai Re-Review Summary</summary>` vs `<summary>Kodiai Review Summary</summary>`

---
*Phase: 38-delta-re-review-formatting*
*Completed: 2026-02-13*

## Self-Check: PASSED

All files and commits verified:
- src/execution/review-prompt.ts: FOUND
- src/handlers/review.ts: FOUND
- src/execution/review-prompt.test.ts: FOUND
- 38-01-SUMMARY.md: FOUND
- Commit 411e4cd9cd: FOUND
- Commit 8d00faec17: FOUND
