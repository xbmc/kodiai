---
phase: 34-structured-review-template
plan: 02
subsystem: api
tags: [sanitizer, validation, review-output, five-section-template, github-comment]

# Dependency graph
requires:
  - phase: 34-structured-review-template
    provides: "Review prompt five-section template instructions (34-01)"
provides:
  - "Server-side five-section template validation in sanitizeKodiaiReviewSummary()"
  - "Section presence, ordering, verdict format, and observations severity validation"
  - "19 test cases covering sanitizer happy and error paths"
affects: [review-prompt, comment-server, review-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Five-section sanitizer: required/optional section validation with canonical ordering"]

key-files:
  created: []
  modified:
    - "src/execution/mcp/comment-server.ts"
    - "src/execution/mcp/comment-server.test.ts"

key-decisions:
  - "Severity sub-headings use ### prefix (### Critical, ### Major, ### Medium, ### Minor) instead of bare text"
  - "Observations validation scopes to content between ## Observations and next ## section boundary"
  - "Strengths content format not validated by sanitizer (prompt-driven, not enforced server-side)"

patterns-established:
  - "Five-section template: What Changed -> Strengths -> Observations -> Suggestions -> Verdict"
  - "buildTestSummary() helper for constructing test review bodies"

# Metrics
duration: 4min
completed: 2026-02-13
---

# Phase 34 Plan 02: Sanitizer Validation Summary

**Rewrote sanitizeKodiaiReviewSummary() to enforce five-section template with required/optional sections, canonical ordering, verdict format validation, and observations severity sub-heading checks**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T21:16:46Z
- **Completed:** 2026-02-13T21:20:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced issues-only sanitizer with five-section template validation (What Changed, Strengths, Observations, Suggestions, Verdict)
- Required sections (What Changed, Observations, Verdict) enforced; optional sections (Strengths, Suggestions) validated when present
- Verdict format validated: must use `:emoji: **Label** -- explanation` pattern with green/yellow/red circle
- Observations validated: must contain severity sub-headings (### Critical/Major/Medium/Minor) with issue lines and explanations
- Extra top-level headings rejected with descriptive error messages
- 12 new comprehensive test cases covering all validation paths

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite sanitizeKodiaiReviewSummary for five-section template** - `4e0f455720` (feat)
2. **Task 2: Add comprehensive sanitizer tests for five-section template** - `a1ebf88d4d` (test)

## Files Created/Modified
- `src/execution/mcp/comment-server.ts` - Rewrote sanitizeKodiaiReviewSummary() with five-section validation (section presence, ordering, verdict format, observations severity, extra heading rejection)
- `src/execution/mcp/comment-server.test.ts` - Updated 2 existing tests for new format; added 12 new test cases in dedicated sanitizeKodiaiReviewSummary describe block with buildTestSummary helper

## Decisions Made
- Severity sub-headings use `###` prefix (e.g., `### Critical`) rather than bare text to differentiate from the old format and align with the `## Observations` parent heading hierarchy
- Observations validation is scoped to content between `## Observations` and the next `##` section, preventing false positives from content in other sections
- Strengths section content format (`:white_check_mark:` prefix) is not validated by the sanitizer -- it is prompt-driven and intentionally left flexible

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing tests to use new five-section format**
- **Found during:** Task 1
- **Issue:** Two existing tests ("strips What changed" and "rejects missing explanation line") used the old issues-only format which is now rejected by the new sanitizer
- **Fix:** Updated test bodies to include five-section structure (## What Changed, ## Observations with ### severity, ## Verdict) while preserving the original test intent
- **Files modified:** src/execution/mcp/comment-server.test.ts
- **Verification:** All 7 original tests pass with updated format
- **Committed in:** 4e0f455720 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary update -- old test format was intentionally replaced by the new template. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Sanitizer fully enforces the five-section template structure server-side
- Ready for integration testing with actual Claude-generated review output
- Prompt template (34-01) and sanitizer (34-02) are aligned on section structure

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 34-structured-review-template*
*Completed: 2026-02-13*
