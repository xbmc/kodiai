---
phase: 40-large-pr-intelligence
plan: 01
subsystem: review
tags: [risk-scoring, large-pr, triage, picomatch, zod]

# Dependency graph
requires:
  - phase: 39-language-aware-enforcement
    provides: "Enforcement pipeline pattern, config schema extension pattern"
provides:
  - "Per-file risk scoring engine (computeFileRiskScores)"
  - "Three-tier file triage (triageFilesByRisk)"
  - "Per-file numstat parser (parseNumstatPerFile)"
  - "largePR config schema with section fallback"
  - "Types: RiskWeights, FileRiskScore, RiskTier, TieredFiles, PerFileStats"
affects: [40-02, 40-03, 40-04, review-prompt, review-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Composite weighted risk scoring with log-normalized line counts", "Runtime weight normalization for user configs"]

key-files:
  created:
    - src/lib/file-risk-scorer.ts
  modified:
    - src/execution/diff-analysis.ts
    - src/execution/config.ts

key-decisions:
  - "Log-scale normalization for line counts prevents large files from always dominating scores"
  - "Runtime weight normalization handles user configs that don't sum to 1.0"
  - "Risk weights default: linesChanged=0.3, pathRisk=0.3, fileCategory=0.2, languageRisk=0.1, fileExtension=0.1"

patterns-established:
  - "Composite weighted sum: each dimension scored 0-1, weighted, scaled to 0-100"
  - "Three-tier triage: full/abbreviated/mention-only based on sorted risk scores"

# Metrics
duration: 3min
completed: 2026-02-14
---

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
