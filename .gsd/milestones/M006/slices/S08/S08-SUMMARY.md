---
id: S08
parent: M006
milestone: M006
provides:
  - Regex-based FORMAT-13 Review Details assertions confirming exact output shape
  - Sanitizer tolerance verification for combined summary + Review Details body
  - Negative assertions proving old format fields are absent
  - FORMAT-13 minimal Review Details output (4 factual lines)
  - appendReviewDetailsToSummary function for embedding Review Details into summary comments
  - Conditional embed-or-standalone handler logic branching on result.published
requires: []
affects: []
key_files: []
key_decisions:
  - "Regex matchers validate FORMAT-13 shape (lines changed +N -N, findings by severity, ISO timestamp) rather than simple toContain"
  - "Negative assertions explicitly guard against old format fields reappearing"
  - "FORMAT-13 output is exactly 4 data lines: files reviewed, lines changed (+/-), findings by severity, review timestamp"
  - "appendReviewDetailsToSummary finds summary comment by buildReviewOutputMarker (same marker executor embeds)"
  - "When append fails (e.g. timing race), fallback to standalone upsertReviewDetailsComment preserves metrics visibility"
patterns_established:
  - "Regex-based format assertions: use toMatch with regex patterns to validate structured output shape"
  - "Embed-or-standalone: branch on result.published to determine Review Details placement"
  - "Fallback pattern: try append, catch and fallback to standalone with warn log"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# S08: Review Details Embedding

**# Phase 37 Plan 02: Test Assertions for FORMAT-13 Review Details Summary**

## What Happened

# Phase 37 Plan 02: Test Assertions for FORMAT-13 Review Details Summary

**Regex-based FORMAT-13 assertions in review.test.ts and sanitizer tolerance test for combined summary+Review Details body**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T23:06:40Z
- **Completed:** 2026-02-13T23:08:14Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Upgraded Review Details assertions from simple toContain to regex-based toMatch patterns validating FORMAT-13 shape (lines changed +N -N, findings by severity, ISO timestamp)
- Added explicit negative assertions for all removed format fields (Lines analyzed, Suppressions applied, Estimated review time saved, Low Confidence Findings)
- Added sanitizer tolerance test confirming combined summary + Review Details body passes without rejection

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Review Details assertions in review.test.ts** - `cd5aef46d4` (test)
2. **Task 2: Add sanitizer tolerance test for appended Review Details** - `cd80dafb0b` (test)

## Files Created/Modified
- `src/handlers/review.test.ts` - Regex-based FORMAT-13 assertions in both "deterministic Review Details" and "published false" test blocks; negative assertions for removed fields
- `src/execution/mcp/comment-server.test.ts` - New tolerance test proving sanitizer accepts summary comments with appended Review Details block

## Decisions Made
- Used regex matchers (`toMatch`) instead of simple `toContain` for structured fields to validate exact FORMAT-13 shape
- Negative assertions added for all four removed fields as explicit regression guards

## Deviations from Plan

None - plan executed exactly as written. (Note: 37-01 had already partially updated the assertions as a Rule 3 deviation, so this plan upgraded them to the full regex-based format specified.)

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All FORMAT-13 Review Details test coverage complete
- Sanitizer verified to tolerate combined body format
- Phase 37 test plans complete; ready for phase verification

---
*Phase: 37-review-details-embedding*
*Completed: 2026-02-13*

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
