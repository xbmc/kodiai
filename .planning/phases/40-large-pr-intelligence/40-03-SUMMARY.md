---
phase: 40-large-pr-intelligence
plan: 03
subsystem: review
tags: [large-pr, triage, prompt-builder, review-details, risk-scoring]

# Dependency graph
requires:
  - phase: 40-large-pr-intelligence
    plan: 01
    provides: "Risk scoring engine types (FileRiskScore, TieredFiles), triage function"
provides:
  - "buildLargePRTriageSection() tiered prompt section builder"
  - "largePRContext parameter in buildReviewPrompt()"
  - "largePRTriage parameter in formatReviewDetailsSummary()"
  - "Collapsible skipped-file listing with risk scores (capped at 100)"
affects: [40-04, review-handler-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Tiered prompt instructions for differential review depth", "Collapsible disclosure with entry cap for GitHub comment size limits"]

key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/handlers/review.ts

key-decisions:
  - "Mention-only files excluded from LLM prompt to avoid token waste; listed only in Review Details"
  - "100-entry cap on skipped file listing to respect GitHub comment size limits (pitfall 7)"
  - "suppressLargePRMessage flag on buildDiffAnalysisSection to avoid duplicate large PR guidance"

patterns-established:
  - "Tiered review depth: full (all categories) vs abbreviated (CRITICAL/MAJOR only)"
  - "Review Details disclosure: transparent coverage reporting with collapsible detail blocks"

# Metrics
duration: 3min
completed: 2026-02-14
---

# Phase 40 Plan 03: Prompt Triage & Review Details Summary

**Tiered prompt sections for full/abbreviated review depth and Review Details disclosure with skipped file risk scores**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T03:03:46Z
- **Completed:** 2026-02-14T03:07:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Built buildLargePRTriageSection() generating tiered prompt instructions that tell the LLM to review full-tier files thoroughly and abbreviated-tier files for CRITICAL/MAJOR only
- Added largePRContext optional parameter to buildReviewPrompt() with automatic suppression of the old generic "This is a large PR" message
- Extended formatReviewDetailsSummary() with largePRTriage parameter adding "Reviewed X/Y files, prioritized by risk" scope line, tier breakdown, and collapsible skipped-file listing capped at 100 entries

## Task Commits

Each task was committed atomically:

1. **Task 1: Tiered prompt section builder and buildReviewPrompt integration** - `4756b3e405` (feat)
2. **Task 2: Review Details coverage disclosure with skipped file listing** - `971dd44c31` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added buildLargePRTriageSection(), largePRContext parameter in buildReviewPrompt(), suppressLargePRMessage option in buildDiffAnalysisSection()
- `src/handlers/review.ts` - Extended formatReviewDetailsSummary() with largePRTriage parameter for disclosure section

## Decisions Made
- Excluded mention-only file names from the LLM prompt entirely (they go in Review Details only) to avoid wasting tokens per research pitfall 4
- Added suppressLargePRMessage option to buildDiffAnalysisSection() rather than modifying its output unconditionally, preserving backward compatibility cleanly
- Used inline type for largePRTriage parameter rather than importing FileRiskScore to minimize coupling between review handler and scorer module

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Tiered prompt builder ready for integration in review handler orchestration (40-04)
- Review Details disclosure ready for end-to-end testing with actual large PRs
- All 125 existing tests pass (92 review-prompt + 33 review-handler)

## Self-Check: PASSED

All files verified present, all commit hashes found in git log.

---
*Phase: 40-large-pr-intelligence*
*Completed: 2026-02-14*
