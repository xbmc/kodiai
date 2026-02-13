---
phase: 35-findings-organization-and-tone
plan: 02
subsystem: api
tags: [sanitizer, validation, impact-preference, severity-tags, observations]

# Dependency graph
requires:
  - phase: 34-structured-review-template
    provides: "Five-section template sanitizer with severity sub-heading validation (34-02)"
provides:
  - "Updated sanitizeKodiaiReviewSummary with Impact/Preference subsection validation"
  - "Severity-tagged finding line regex: [SEVERITY] path (lines): title"
  - "State machine validation for INTRO -> ISSUE -> EXPLANATION flow"
  - "32 test cases covering all sanitizer validation paths"
affects: [review-prompt, comment-server]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Impact/Preference sanitizer: subsection-based finding classification with inline severity tags"]

key-files:
  created: []
  modified:
    - "src/execution/mcp/comment-server.ts"
    - "src/execution/mcp/comment-server.test.ts"

key-decisions:
  - "### Impact required, ### Preference optional -- mirrors prompt-driven classification"
  - "CRITICAL/MAJOR in Preference triggers console.warn (soft check) not rejection"
  - "Bold markers stripped before severity tag matching to handle Claude formatting tendencies"
  - "foundImpactFinding tracking ensures at least one severity-tagged finding exists under Impact"

patterns-established:
  - "State machine validation: INTRO -> ISSUE -> EXPLANATION with blank line rules"
  - "Severity-tagged finding format: [CRITICAL|MAJOR|MEDIUM|MINOR] path (lines): title"

# Metrics
duration: 4min
completed: 2026-02-13
---

# Phase 35 Plan 02: Sanitizer Validation Summary

**Replaced severity sub-heading validation with Impact/Preference subsection validation and severity-tagged finding line regex in sanitizeKodiaiReviewSummary()**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T22:02:37Z
- **Completed:** 2026-02-13T22:06:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced `### Critical/Major/Medium/Minor` subsection validation with `### Impact` (required) and `### Preference` (optional)
- Finding lines now require `[SEVERITY]` prefix: `[CRITICAL] path (lines): title` format
- State machine validates INTRO -> ISSUE -> EXPLANATION flow with strict blank line rules (forbidden between issue and explanation, allowed after explanation)
- CRITICAL/MAJOR findings in Preference section trigger soft warning (console.warn) without rejecting the review
- Bold marker stripping handles `**[CRITICAL]**` formatting from Claude
- 13 new test cases covering all Impact/Preference validation paths
- All 19 existing tests updated to use new format and still passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Update sanitizeKodiaiReviewSummary for Impact/Preference validation** - `c93a19b955` (feat)
2. **Task 2: Add comprehensive sanitizer tests for Impact/Preference validation** - `2685b8e3f7` (test)

## Files Created/Modified
- `src/execution/mcp/comment-server.ts` - Rewrote Observations validation section: validSubsections set, severity-tagged issueLineRe regex, INTRO/ISSUE/EXPLANATION state machine, soft severity cap warning, foundImpactFinding tracking
- `src/execution/mcp/comment-server.test.ts` - Updated 19 existing tests to new format; added 13 new tests for Impact/Preference validation, severity tags, intro text tolerance, bold stripping, soft warnings, and edge cases

## Decisions Made
- `### Impact` required, `### Preference` optional -- the sanitizer enforces that Impact exists with at least one finding; Preference is accepted but not required
- CRITICAL/MAJOR in Preference is a soft check (console.warn) per research recommendation -- hard rejection risks losing valid reviews when Claude makes edge-case classification decisions
- Bold markers (`**`) stripped before regex matching to handle Claude's tendency to bold-format severity tags
- Added `foundImpactFinding` boolean to ensure the `### Impact` section actually contains severity-tagged findings, not just intro text

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added foundImpactFinding tracking to prevent false acceptance**
- **Found during:** Task 2
- **Issue:** Without tracking whether a severity-tagged finding was actually found under ### Impact, the sanitizer would accept ### Impact sections that contained only intro text or untagged lines (treating them as intro text and never transitioning to ISSUE state)
- **Fix:** Added `foundImpactFinding` boolean set to true on INTRO->ISSUE and EXPLANATION->ISSUE transitions when currentSubsection is ### Impact; final check requires this boolean to be true
- **Files modified:** src/execution/mcp/comment-server.ts
- **Verification:** Tests for "rejects finding without severity tag" and "rejects invalid severity tag [HIGH]" now correctly fail validation
- **Committed in:** 2685b8e3f7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential correctness fix -- without it, findings missing severity tags would silently pass validation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Sanitizer fully validates the Impact/Preference Observations structure with severity-tagged finding lines
- Ready for prompt template updates (35-01) that generate the new format
- Five-section template validation (section presence, ordering, verdict format) remains intact from Phase 34

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 35-findings-organization-and-tone*
*Completed: 2026-02-13*
