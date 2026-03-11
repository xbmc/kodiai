---
id: S05
parent: M007
milestone: M007
provides:
  - "Server-side five-section template validation in sanitizeKodiaiReviewSummary()"
  - "Section presence, ordering, verdict format, and observations severity validation"
  - "19 test cases covering sanitizer happy and error paths"
  - buildReviewedCategoriesLine() helper mapping file categories to human labels
  - Five-section summary template (What Changed, Strengths, Observations, Suggestions, Verdict)
  - Severity sub-headings under Observations (Critical, Major, Medium, Minor)
  - Verdict emoji vocabulary (green_circle, yellow_circle, red_circle)
requires: []
affects: []
key_files: []
key_decisions:
  - "Severity sub-headings use ### prefix (### Critical, ### Major, ### Medium, ### Minor) instead of bare text"
  - "Observations validation scopes to content between ## Observations and next ## section boundary"
  - "Strengths content format not validated by sanitizer (prompt-driven, not enforced server-side)"
  - "Used comma-separated text format for reviewed categories instead of checkboxes"
  - "Made Strengths and Suggestions optional, What Changed/Observations/Verdict required"
  - "Unknown category keys fall through to use key name as label for forward compatibility"
patterns_established:
  - "Five-section template: What Changed -> Strengths -> Observations -> Suggestions -> Verdict"
  - "buildTestSummary() helper for constructing test review bodies"
  - "Five-section template: What Changed > Strengths > Observations > Suggestions > Verdict"
  - "Category label mapping: source->core logic, test->tests, config->config, docs->docs, infra->infrastructure"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# S05: Structured Review Template

**# Phase 34 Plan 02: Sanitizer Validation Summary**

## What Happened

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

# Phase 34 Plan 01: Structured Review Template Summary

**Five-section summary comment template with reviewed categories checklist using buildReviewedCategoriesLine from DiffAnalysis filesByCategory**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T21:16:43Z
- **Completed:** 2026-02-13T21:19:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `buildReviewedCategoriesLine()` helper that maps DiffAnalysis file categories to human-readable labels (source -> "core logic", test -> "tests", etc.)
- Rewrote standard-mode summary comment prompt with five ordered sections: What Changed, Strengths, Observations, Suggestions, Verdict
- Added hard requirements for section ordering, severity sub-headings under Observations, :white_check_mark: prefix for Strengths, and emoji verdict vocabulary
- Enhanced-mode prompt remains completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add buildReviewedCategoriesLine helper and rewrite standard-mode summary prompt** - `44cc0f6f2b` (feat)
2. **Task 2: Update review-prompt tests for new template and categories helper** - `4734bfa3cb` (test)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added buildReviewedCategoriesLine() helper and five-section template in standard-mode summary comment section
- `src/execution/review-prompt.test.ts` - Added 7 new tests for categories helper, template presence, and reviewed categories integration

## Decisions Made
- Used comma-separated text format ("Reviewed: core logic, tests, config") instead of checkbox format for the categories line -- simpler and avoids interactive checkbox rendering in GitHub
- Made Strengths and Suggestions sections optional while requiring What Changed, Observations, and Verdict -- follows research recommendation to allow graceful degradation for edge-case PRs
- Unknown category keys use the key itself as the label -- provides forward compatibility if new categories are added to DiffAnalysis without updating the label map

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed conflicting "no What Changed" rule from ## Rules section**
- **Found during:** Task 1
- **Issue:** The existing "## Rules" section contained `'Do NOT include sections like "What changed" or any change summary'` which directly contradicts the new five-section template that includes `## What Changed`
- **Fix:** Replaced the conflicting rule with `"In standard mode, use the five-section template (What Changed, Strengths, Observations, Suggestions, Verdict) for the summary comment"`
- **Files modified:** src/execution/review-prompt.ts
- **Verification:** All 62 tests pass, prompt contains "## What Changed" in standard mode
- **Committed in:** 44cc0f6f2b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix -- the old rule would have contradicted the new template instructions, confusing Claude during review generation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Five-section template is active in the prompt; ready for sanitizer validation updates in Plan 02
- buildReviewedCategoriesLine is exported and available for use by comment-server sanitizer
- All 62 tests pass with zero TypeScript errors in modified files

---
*Phase: 34-structured-review-template*
*Completed: 2026-02-13*
