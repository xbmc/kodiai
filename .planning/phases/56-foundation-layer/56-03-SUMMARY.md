---
phase: 56-foundation-layer
plan: "03"
subsystem: execution
tags: [intent, prompt, keyword-parsing]

# Dependency graph
requires:
  - phase: 56-02
    provides: "Review handler prompt construction and Review Details keyword parsing output"
provides:
  - "Keyword parsing output renders unrecognized bracket tags as focus hints"
  - "Review prompt includes a Focus Hints section when unrecognized tags are present"
  - "Review handler threads parsedIntent.unrecognized into buildReviewPrompt focusHints"
affects: [intent-ux, review-prompt, review-details]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Normalize focus hints to uppercase bracket-tag vocabulary ([AUTH], [IOS])"

key-files:
  created: []
  modified:
    - src/lib/pr-intent-parser.ts
    - src/execution/review-prompt.ts
    - src/execution/review-prompt.test.ts
    - src/handlers/review.ts
    - src/lib/pr-intent-parser.test.ts

key-decisions:
  - "None - followed plan as specified"

patterns-established:
  - "Unrecognized bracket tags are treated as review focus hints, not ignored metadata"

# Metrics
duration: 4m
completed: 2026-02-15
---

# Phase 56 Plan 03: Focus Hints from Unrecognized Tags Summary

**Unrecognized bracket tags in PR titles/commits are surfaced as Focus Hints in both the prompt and deterministic Review Details output.**

## Performance

- **Duration:** 4m
- **Started:** 2026-02-15T19:17:07Z
- **Completed:** 2026-02-15T19:20:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Updated Review Details keyword parsing UX to render unrecognized bracket tags as `focus hints` (instead of labeling them as ignored)
- Added a first-class `## Focus Hints` section to the review prompt with guardrails to avoid hallucinated context
- Threaded parsed unrecognized tags from `src/handlers/review.ts` into `buildReviewPrompt({ focusHints })`

## Task Commits

Each task was committed atomically:

1. **Task 1: Render unrecognized bracket tags as focus hints (not "ignored")** - `f5d4b514a2` (feat)
2. **Task 2: Add Focus Hints section to buildReviewPrompt and thread through handler** - `13920daf10` (feat)

## Files Created/Modified

- `src/lib/pr-intent-parser.ts` - Renders unrecognized bracket tags as `focus hints: [TAG]` in Review Details keyword parsing
- `src/execution/review-prompt.ts` - Adds optional `focusHints?: string[]` support and a `## Focus Hints` section
- `src/execution/review-prompt.test.ts` - Verifies Focus Hints section is present/absent based on input
- `src/handlers/review.ts` - Passes `parsedIntent.unrecognized` into `buildReviewPrompt({ focusHints })`
- `src/lib/pr-intent-parser.test.ts` - Aligns keyword parsing section expectation with focus hints rendering

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated keyword parsing unit test to match new focus hints rendering**
- **Found during:** Overall verification (`bun test`)
- **Issue:** `src/lib/pr-intent-parser.test.ts` expected the old `ignored [...]` output string
- **Fix:** Updated assertion to expect `focus hints: [FOOBAR]`
- **Files modified:** `src/lib/pr-intent-parser.test.ts`
- **Verification:** `bun test`
- **Committed in:** `c6db12bb78`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal; test-only update to keep suite aligned with the planned output change.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Intent UX improvements are in place for downstream prompt tuning and review behavior work.

---
*Phase: 56-foundation-layer*
*Completed: 2026-02-15*

## Self-Check: PASSED

- Summary file exists
- Task commits `f5d4b514a2`, `13920daf10`, and `c6db12bb78` present in git history
