---
phase: 40-large-pr-intelligence
plan: 04
subsystem: review
tags: [large-pr, triage, risk-scoring, pipeline-integration, enforcement]

# Dependency graph
requires:
  - phase: 40-large-pr-intelligence
    plan: 01
    provides: "Risk scoring engine (computeFileRiskScores, triageFilesByRisk, parseNumstatPerFile)"
  - phase: 40-large-pr-intelligence
    plan: 03
    provides: "buildLargePRTriageSection(), largePRContext in buildReviewPrompt(), largePRTriage in formatReviewDetailsSummary()"
provides:
  - "Complete end-to-end large PR pipeline integration in review handler"
  - "Risk-based file triage between diff analysis and prompt building"
  - "Post-LLM abbreviated tier enforcement suppressing medium/minor findings"
  - "Coverage disclosure in Review Details for large PRs"
  - "totalFileCount override in triageFilesByRisk for incremental mode correctness"
affects: [review-handler, large-pr-behavior]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Pipeline insertion pattern: triage between diff analysis and prompt building", "Post-LLM deterministic enforcement for tiered review depth"]

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/lib/file-risk-scorer.ts

key-decisions:
  - "Abbreviated tier enforcement is post-LLM deterministic suppression, not prompt instruction (safety net per research open question 2)"
  - "totalFileCount override added to triageFilesByRisk so incremental mode uses full PR file count for threshold"
  - "promptFiles replaces reviewFiles in buildReviewPrompt changedFiles param only when isLargePR is true"

patterns-established:
  - "Post-LLM enforcement layers: language enforcement -> abbreviated tier enforcement -> suppression matching -> dedup"
  - "Large PR triage pipeline: parseNumstatPerFile -> computeFileRiskScores -> triageFilesByRisk -> promptFiles -> buildReviewPrompt"

# Metrics
duration: 3min
completed: 2026-02-14
---

# Phase 40 Plan 04: Pipeline Integration Summary

**End-to-end large PR file triage wired into review handler with risk scoring, tiered prompt building, post-LLM abbreviated enforcement, and coverage disclosure**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T03:09:00Z
- **Completed:** 2026-02-14T03:11:55Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Wired parseNumstatPerFile, computeFileRiskScores, and triageFilesByRisk into the review handler pipeline between diff analysis and prompt building
- Replaced reviewFiles with promptFiles (full + abbreviated tiers only) in buildReviewPrompt call, with largePRContext for tiered prompt instructions
- Added post-LLM abbreviated tier enforcement that deterministically suppresses medium/minor findings on abbreviated-tier files
- Passed largePRTriage data to formatReviewDetailsSummary for transparent coverage disclosure in Review Details
- Added totalFileCount override to triageFilesByRisk so threshold check uses full PR file count in incremental mode (pitfall 3 fix)
- Added structured logging for large PR triage decisions with file counts and threshold

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire file risk triage into review handler pipeline** - `2150a79315` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Full pipeline integration: imports, risk scoring, triage, prompt file selection, largePRContext, abbreviated tier enforcement, largePRTriage disclosure, structured logging
- `src/lib/file-risk-scorer.ts` - Added optional totalFileCount parameter to triageFilesByRisk for incremental mode threshold correctness

## Decisions Made
- Used post-LLM deterministic enforcement (not prompt instructions) for abbreviated tier depth control -- the LLM may still produce medium/minor findings on abbreviated files, but they get suppressed after extraction as a safety net
- Added totalFileCount parameter to triageFilesByRisk rather than computing the threshold externally, keeping the triage logic encapsulated in the scorer module
- Abbreviated tier enforcement runs in the processedFindings mapping alongside existing suppression/dedup logic, adding minimal complexity

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added totalFileCount override to triageFilesByRisk**
- **Found during:** Task 1 (pipeline wiring)
- **Issue:** triageFilesByRisk used riskScores.length for threshold check, but in incremental mode riskScores is built from reviewFiles (a subset). Per research pitfall 3, the threshold should use the full PR file count (changedFiles.length)
- **Fix:** Added optional totalFileCount parameter to triageFilesByRisk; review handler passes changedFiles.length
- **Files modified:** src/lib/file-risk-scorer.ts, src/handlers/review.ts
- **Verification:** TypeScript compiles, all 578 tests pass
- **Committed in:** 2150a79315 (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Fix ensures correct threshold behavior in incremental mode. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 40 (Large PR Intelligence) is now fully integrated end-to-end
- For PRs with 50+ files: risk scores computed, top 30 get full review, next 20 get abbreviated, rest disclosed in Review Details with scores
- For PRs with <50 files: identical behavior to pre-Phase 40
- All 578 existing tests pass

## Self-Check: PASSED

All files verified present, all commit hashes found in git log.

---
*Phase: 40-large-pr-intelligence*
*Completed: 2026-02-14*
