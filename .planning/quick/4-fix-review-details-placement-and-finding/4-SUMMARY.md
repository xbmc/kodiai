---
phase: quick-4
plan: 01
subsystem: review-output
tags: [github-comments, details-nesting, severity-counts]

requires:
  - phase: none
    provides: n/a
provides:
  - "Nested Review Details inside Kodiai Review Summary collapsible block"
  - "Merged finding counts from inline comments and summary body observations"
affects: [review-output, review-details]

tech-stack:
  added: []
  patterns: [lastIndexOf-insert-before, regex-severity-parsing]

key-files:
  created: []
  modified:
    - src/handlers/review.ts

key-decisions:
  - "Use lastIndexOf('</details>') to find summary closing tag for nested insertion"
  - "parseSeverityCountsFromBody uses case-insensitive regex for [SEVERITY] tags"
  - "Annotate findings line with parenthetical when body observations exist"

patterns-established:
  - "Nested details insertion: split at lastIndexOf closing tag, insert before"

duration: 2min
completed: 2026-02-14
---

# Quick Task 4: Fix Review Details Placement and Finding Counts

**Review Details now nests inside Kodiai Review Summary as a single collapsible block, with finding counts merging inline and summary body observations**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-14T23:21:02Z
- **Completed:** 2026-02-14T23:22:43Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Review Details block renders inside the Kodiai Review Summary collapsible (nested `<details>`)
- Finding counts now include `[CRITICAL]`/`[MAJOR]`/`[MEDIUM]`/`[MINOR]` tags from summary body observations
- Added `parseSeverityCountsFromBody()` helper for severity tag extraction

## Task Commits

Each task was committed atomically:

1. **Task 1: Nest Review Details inside Kodiai Review Summary** - `5778eccc03` (fix)
2. **Task 2: Include summary body observations in finding counts** - `144099ff50` (fix)

## Files Created/Modified
- `src/handlers/review.ts` - Fixed `appendReviewDetailsToSummary` nesting logic and added `parseSeverityCountsFromBody` for merged finding counts

## Decisions Made
- Used `lastIndexOf('</details>')` to find the summary block's closing tag, ensuring we insert before the outermost close (not inner nested ones from large PR triage)
- Body severity counts are only merged in the `appendReviewDetailsToSummary` path; standalone `upsertReviewDetailsComment` remains unchanged since there is no summary body to parse
- Added parenthetical annotation "(includes N from summary observations)" only when body counts > 0

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## Next Phase Readiness
- Both bugs fixed, ready for production use
- No further dependencies or blockers

---
*Quick Task: 4-fix-review-details-placement-and-finding*
*Completed: 2026-02-14*
