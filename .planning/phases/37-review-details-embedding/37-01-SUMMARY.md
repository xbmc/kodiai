---
phase: 37-review-details-embedding
plan: 01
subsystem: review-output
tags: [format-11, format-12, format-13, review-details, github-comments]

requires:
  - phase: 34-summary-structure-enforcement
    provides: summary comment template with FORMAT-02 reviewed categories
  - phase: 36-verdict-merge-confidence
    provides: verdict logic section and blocker-driven verdict rules
provides:
  - FORMAT-13 minimal Review Details output (4 factual lines)
  - appendReviewDetailsToSummary function for embedding Review Details into summary comments
  - Conditional embed-or-standalone handler logic branching on result.published
affects: [37-02, review-handler, review-prompt]

tech-stack:
  added: []
  patterns: [embed-or-standalone comment strategy, fallback on append failure]

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/execution/review-prompt.ts
    - src/execution/review-prompt.test.ts
    - src/handlers/review.test.ts

key-decisions:
  - "FORMAT-13 output is exactly 4 data lines: files reviewed, lines changed (+/-), findings by severity, review timestamp"
  - "appendReviewDetailsToSummary finds summary comment by buildReviewOutputMarker (same marker executor embeds)"
  - "When append fails (e.g. timing race), fallback to standalone upsertReviewDetailsComment preserves metrics visibility"

patterns-established:
  - "Embed-or-standalone: branch on result.published to determine Review Details placement"
  - "Fallback pattern: try append, catch and fallback to standalone with warn log"

duration: 4min
completed: 2026-02-13
---

# Phase 37 Plan 01: Review Details Embedding Summary

**Minimal FORMAT-13 Review Details with embed-into-summary logic and buildMetricsInstructions removal**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T23:00:42Z
- **Completed:** 2026-02-13T23:04:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Rewrote formatReviewDetailsSummary to produce exactly 4 factual data lines per FORMAT-13 (files reviewed, lines changed, findings by severity, review timestamp)
- Removed buildMetricsInstructions entirely from review-prompt.ts (function, invocation, export, and all test references)
- Added appendReviewDetailsToSummary function that finds the summary comment by review output marker and appends Review Details
- Updated handler flow to embed Review Details into summary comment when published (FORMAT-11), standalone when clean review (FORMAT-11 exemption)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite formatReviewDetailsSummary and remove buildMetricsInstructions** - `2d004feaf1` (feat)
2. **Task 2: Update handler flow to embed-or-standalone Review Details** - `ef46b1233a` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Rewritten formatReviewDetailsSummary (FORMAT-13), new appendReviewDetailsToSummary, conditional embed/standalone handler logic
- `src/execution/review-prompt.ts` - Removed buildMetricsInstructions function and its invocation
- `src/execution/review-prompt.test.ts` - Removed buildMetricsInstructions import and 2 tests, updated suppression integration test
- `src/handlers/review.test.ts` - Updated Review Details assertions to match new FORMAT-13 output

## Decisions Made
- FORMAT-13 output uses `+N -N` format for lines changed (not combined total) for clarity
- appendReviewDetailsToSummary uses buildReviewOutputMarker (same marker the executor embeds) to find the summary comment
- Fallback from append to standalone preserves metrics visibility when timing races occur

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated review.test.ts assertions for new format**
- **Found during:** Task 2 (handler flow update)
- **Issue:** review.test.ts contained assertions for old format fields (Lines analyzed, Suppressions applied, Estimated review time saved, Low Confidence Findings) that would fail with the new FORMAT-13 output
- **Fix:** Updated 2 test blocks to assert new format fields (Lines changed: +, Findings:, Review completed:)
- **Files modified:** src/handlers/review.test.ts
- **Verification:** `bun test src/handlers/review.test.ts` -- 28 pass, 0 fail
- **Committed in:** ef46b1233a (Task 2 commit)

**2. [Rule 3 - Blocking] Removed buildMetricsInstructions assertions from suppression integration test**
- **Found during:** Task 1 (buildMetricsInstructions removal)
- **Issue:** Suppression integration test at line 396 asserted `## Review Metrics` and `Issue counts grouped by severity` which no longer exist in the prompt
- **Fix:** Removed the 2 assertions from the test
- **Files modified:** src/execution/review-prompt.test.ts
- **Verification:** `bun test src/execution/review-prompt.test.ts` -- 86 pass, 0 fail
- **Committed in:** 2d004feaf1 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes necessary for test correctness after format change. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FORMAT-13 minimal Review Details format is live
- buildMetricsInstructions fully removed from prompt pipeline
- Handler correctly branches on result.published for embed vs standalone
- Ready for 37-02 (any remaining embedding or formatting work)

---
*Phase: 37-review-details-embedding*
*Completed: 2026-02-13*
