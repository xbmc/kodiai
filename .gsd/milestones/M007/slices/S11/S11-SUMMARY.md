---
id: S11
parent: M007
milestone: M007
provides:
  - "Complete end-to-end large PR pipeline integration in review handler"
  - "Risk-based file triage between diff analysis and prompt building"
  - "Post-LLM abbreviated tier enforcement suppressing medium/minor findings"
  - "Coverage disclosure in Review Details for large PRs"
  - "totalFileCount override in triageFilesByRisk for incremental mode correctness"
  - "Per-file risk scoring engine (computeFileRiskScores)"
  - "Three-tier file triage (triageFilesByRisk)"
  - "Per-file numstat parser (parseNumstatPerFile)"
  - "largePR config schema with section fallback"
  - "Types: RiskWeights, FileRiskScore, RiskTier, TieredFiles, PerFileStats"
  - "buildLargePRTriageSection() tiered prompt section builder"
  - "largePRContext parameter in buildReviewPrompt()"
  - "largePRTriage parameter in formatReviewDetailsSummary()"
  - "Collapsible skipped-file listing with risk scores (capped at 100)"
  - "Test coverage for computeFileRiskScores (relative ordering, normalization, boundaries)"
  - "Test coverage for triageFilesByRisk (threshold behavior, tier splitting, empty input)"
  - "Test coverage for parseNumstatPerFile (standard, binary, empty, malformed)"
requires: []
affects: []
key_files: []
key_decisions:
  - "Abbreviated tier enforcement is post-LLM deterministic suppression, not prompt instruction (safety net per research open question 2)"
  - "totalFileCount override added to triageFilesByRisk so incremental mode uses full PR file count for threshold"
  - "promptFiles replaces reviewFiles in buildReviewPrompt changedFiles param only when isLargePR is true"
  - "Log-scale normalization for line counts prevents large files from always dominating scores"
  - "Runtime weight normalization handles user configs that don't sum to 1.0"
  - "Risk weights default: linesChanged=0.3, pathRisk=0.3, fileCategory=0.2, languageRisk=0.1, fileExtension=0.1"
  - "Mention-only files excluded from LLM prompt to avoid token waste; listed only in Review Details"
  - "100-entry cap on skipped file listing to respect GitHub comment size limits (pitfall 7)"
  - "suppressLargePRMessage flag on buildDiffAnalysisSection to avoid duplicate large PR guidance"
  - "Tests written against pre-existing 40-01 implementation; RED+GREEN phases collapsed since code already passed"
  - "Used describe blocks to group related tests (computeFileRiskScores, triageFilesByRisk, parseNumstatPerFile)"
patterns_established:
  - "Post-LLM enforcement layers: language enforcement -> abbreviated tier enforcement -> suppression matching -> dedup"
  - "Large PR triage pipeline: parseNumstatPerFile -> computeFileRiskScores -> triageFilesByRisk -> promptFiles -> buildReviewPrompt"
  - "Composite weighted sum: each dimension scored 0-1, weighted, scaled to 0-100"
  - "Three-tier triage: full/abbreviated/mention-only based on sorted risk scores"
  - "Tiered review depth: full (all categories) vs abbreviated (CRITICAL/MAJOR only)"
  - "Review Details disclosure: transparent coverage reporting with collapsible detail blocks"
  - "Test pattern: makeFakeScores helper for generating mock FileRiskScore arrays"
  - "Threshold boundary testing with exactly N+1 items for off-by-one detection"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# S11: Large Pr Intelligence

**# Phase 40 Plan 04: Pipeline Integration Summary**

## What Happened

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

# Phase 40 Plan 01: Foundation Summary

**Per-file risk scoring engine with composite weighted heuristics, three-tier triage, and configurable largePR schema**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T02:58:38Z
- **Completed:** 2026-02-14T03:01:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Built risk scoring engine computing per-file scores from 5 heuristics: line changes (log-normalized), path risk patterns (auth/secrets/migrations), file category, language risk, and executable extension
- Implemented three-tier file triage splitting scored files into full/abbreviated/mention-only tiers
- Added parseNumstatPerFile() for per-file line count extraction from git numstat output
- Extended config schema with largePR section (fileThreshold, fullReviewCount, abbreviatedCount, riskWeights) with section fallback parsing

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-file numstat parser and risk scoring engine** - `6df3b50c2a` (feat)
2. **Task 2: largePR config schema with section fallback parsing** - `6fc03e829d` (feat)

## Files Created/Modified
- `src/lib/file-risk-scorer.ts` - Risk scoring engine with computeFileRiskScores(), triageFilesByRisk(), types and constants
- `src/execution/diff-analysis.ts` - Added parseNumstatPerFile() and PerFileStats type
- `src/execution/config.ts` - Added riskWeightsSchema, largePRSchema, largePR section fallback in loadRepoConfig()

## Decisions Made
- Used logarithmic scale for line count normalization: `min(1.0, log10(totalLines + 1) / log10(maxLinesInPR + 1))` to prevent large files from dominating
- Runtime weight normalization (divide by sum) so user-provided weights that don't sum to 1.0 still produce correct relative scores
- Separate PATH_RISK_PATTERNS in scorer (weighted 0-1) from existing PATH_RISK_SIGNALS in diff-analysis (boolean signals) to avoid coupling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Risk scoring engine ready for integration in review handler (40-02/40-03)
- Config schema ready for all subsequent plans to read largePR settings
- All existing tests pass (70 config tests, type checking clean for new files)

## Self-Check: PASSED

All files verified present, all commit hashes found in git log.

---
*Phase: 40-large-pr-intelligence*
*Completed: 2026-02-14*

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

# Phase 40 Plan 02: Risk Scoring and Numstat Parsing Tests Summary

**13 TDD tests covering risk score ordering, weight normalization, triage tier splitting, and numstat parsing edge cases**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-14T02:58:38Z
- **Completed:** 2026-02-14T03:00:40Z
- **Tasks:** 1 (TDD -- RED+GREEN collapsed since implementation pre-existed from plan 40-01)
- **Files modified:** 2

## Accomplishments
- 9 tests for computeFileRiskScores and triageFilesByRisk covering auth-vs-test ordering, zero-line scores, 0-100 range, sort order, weight normalization (2.0 sum), threshold below/above/boundary, empty input
- 4 tests for parseNumstatPerFile covering standard numstat lines, binary file handling, empty input, and malformed line graceful skipping
- All 36 tests pass across both test files (23 existing + 13 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Risk scoring and numstat parser tests** - `a01711e2fc` (test)

## Files Created/Modified
- `src/lib/file-risk-scorer.test.ts` - New test file: 9 tests for computeFileRiskScores (5) and triageFilesByRisk (4)
- `src/execution/diff-analysis.test.ts` - Added 4 parseNumstatPerFile tests with describe block

## Decisions Made
- Tests written against pre-existing 40-01 implementation; RED+GREEN phases collapsed since code already passed all assertions on first run
- Used describe blocks (imported from bun:test) to group related test suites for clarity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Test coverage in place for risk scoring engine and numstat parser
- Ready for plan 40-03 (prompt triage section) and 40-04 (review handler integration)

## Self-Check: PASSED

- FOUND: src/lib/file-risk-scorer.test.ts
- FOUND: src/execution/diff-analysis.test.ts
- FOUND: 40-02-SUMMARY.md
- FOUND: commit a01711e2fc

---
*Phase: 40-large-pr-intelligence*
*Completed: 2026-02-14*
