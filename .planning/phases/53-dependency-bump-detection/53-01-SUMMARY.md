---
phase: 53-dependency-bump-detection
plan: 01
subsystem: api
tags: [dependabot, renovate, semver, dependency-detection, pure-functions]

# Dependency graph
requires: []
provides:
  - "Three-stage dep bump pipeline: detectDepBump, extractDepBumpDetails, classifyDepBump"
  - "Type exports: DepBumpDetection, DepBumpDetails, DepBumpClassification, DepBumpContext"
  - "Ecosystem detection from Dependabot branch segments and manifest file fallback"
  - "Hand-rolled semver parser with v-prefix stripping and pre-release handling"
affects: [53-02-integration-wiring, review-prompt, review-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [two-signal-detection, three-stage-pipeline, fail-open-enrichment]

key-files:
  created:
    - src/lib/dep-bump-detector.ts
    - src/lib/dep-bump-detector.test.ts
  modified: []

key-decisions:
  - "Two-signal requirement for detection prevents false positives on human PRs with bump-like titles"
  - "Hand-rolled semver parser (~15 lines) avoids 376KB semver npm dependency"
  - "Group bumps marked as isGroup: true with ecosystem only, no per-package extraction"
  - "Ecosystem resolved from Dependabot branch segment first, manifest file fallback second"

patterns-established:
  - "Two-signal detection: require 2+ independent signals before classifying a PR type"
  - "Three-stage pipeline: detect -> extract -> classify with null propagation between stages"

# Metrics
duration: 2min
completed: 2026-02-14
---

# Phase 53 Plan 01: Dependency Bump Detection Pipeline Summary

**Three-stage pure-function pipeline (detect/extract/classify) for Dependabot and Renovate PR identification with two-signal false-positive prevention and hand-rolled semver comparison**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-14T23:43:26Z
- **Completed:** 2026-02-14T23:46:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Three exported pipeline functions: detectDepBump, extractDepBumpDetails, classifyDepBump
- Two-signal detection requirement prevents false positives (title alone insufficient)
- Ecosystem detection from 12 Dependabot branch segments + 16 manifest file fallbacks
- Group bump detection for Dependabot groups and Renovate monorepo updates
- Hand-rolled semver parser handles v-prefix, pre-release stripping, calver, unparseable versions
- 42 tests covering all behavior cases with 106 assertions

## Task Commits

Each task was committed atomically:

1. **TDD RED: Failing tests for all three pipeline stages** - `64c5bb68` (test)
2. **TDD GREEN: Implement dep-bump-detector.ts** - `3cc4bb62` (feat)

_TDD REFACTOR: No refactor needed -- code was clean and well-documented from GREEN phase._

## Files Created/Modified
- `src/lib/dep-bump-detector.ts` - Three-stage dependency bump detection pipeline (347 lines)
- `src/lib/dep-bump-detector.test.ts` - Comprehensive tests for all three stages (442 lines)

## Decisions Made
- **Two-signal requirement:** Prevents false positives on human PRs with titles like "Bump minimum Node version to 20" -- requires title match + at least one of: bot sender, dep branch prefix, dep label
- **Hand-rolled semver:** ~15-line parseSemver function instead of 376KB semver npm package -- only need basic X.Y.Z comparison with v-prefix and pre-release stripping
- **Group bumps:** Marked as isGroup: true with ecosystem detection only; individual package extraction deferred to manifest diff parsing in a follow-up
- **Ecosystem resolution order:** Dependabot branch segment (primary, O(1)) then manifest file name fallback (secondary)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Pipeline functions exported and ready for wiring into review.ts handler
- DepBumpContext composite type ready for passing into buildReviewPrompt
- Plan 53-02 can wire detectDepBump into the review handler between intent parsing and prompt building

## Self-Check: PASSED

- [x] src/lib/dep-bump-detector.ts exists (347 lines)
- [x] src/lib/dep-bump-detector.test.ts exists (442 lines)
- [x] Commit 64c5bb68 (RED) verified
- [x] Commit 3cc4bb62 (GREEN) verified
- [x] 42/42 tests passing

---
*Phase: 53-dependency-bump-detection*
*Completed: 2026-02-14*
