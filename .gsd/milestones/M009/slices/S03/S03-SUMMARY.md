---
id: S03
parent: M009
milestone: M009
provides:
  - "Three-stage dep bump pipeline: detectDepBump, extractDepBumpDetails, classifyDepBump"
  - "Type exports: DepBumpDetection, DepBumpDetails, DepBumpClassification, DepBumpContext"
  - "Ecosystem detection from Dependabot branch segments and manifest file fallback"
  - "Hand-rolled semver parser with v-prefix stripping and pre-release handling"
  - "End-to-end dep bump detection wired into review handler with fail-open error handling"
  - "Dependency Bump Context prompt section with major/minor/patch guidance variants"
  - "depBumpContext parameter on buildReviewPrompt for prompt customization"
requires: []
affects: []
key_files: []
key_decisions:
  - "Two-signal requirement for detection prevents false positives on human PRs with bump-like titles"
  - "Hand-rolled semver parser (~15 lines) avoids 376KB semver npm dependency"
  - "Group bumps marked as isGroup: true with ecosystem only, no per-package extraction"
  - "Ecosystem resolved from Dependabot branch segment first, manifest file fallback second"
  - "Dep bump detection placed after diff collection (allChangedFiles needed for ecosystem resolution)"
  - "extractDepBumpDetails requires headBranch parameter for ecosystem detection from branch segment"
  - "Dep bump section injected after author tier, before path instructions in prompt"
patterns_established:
  - "Two-signal detection: require 2+ independent signals before classifying a PR type"
  - "Three-stage pipeline: detect -> extract -> classify with null propagation between stages"
  - "Conditional prompt section: check context field, call section builder, push to lines array"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# S03: Dependency Bump Detection

**# Phase 53 Plan 01: Dependency Bump Detection Pipeline Summary**

## What Happened

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

# Phase 53 Plan 02: Integration Wiring Summary

**Dep bump detection wired into review handler with fail-open pattern and conditional prompt section rendering major/minor/patch review guidance**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-14T23:48:06Z
- **Completed:** 2026-02-14T23:52:23Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Review handler imports and calls three-stage dep bump pipeline between diff collection and prompt building
- buildReviewPrompt accepts optional depBumpContext and renders Dependency Bump Context section
- Major bumps produce breaking change warning with API/migration/test focus areas
- Minor/patch bumps produce low-risk guidance with lockfile/dependency-tree focus
- 5 new tests covering all rendering variants and null/undefined handling
- Full test suite (821 tests) passes with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire dep bump detection into review.ts handler** - `6c38579ae0` (feat)
2. **Task 2: Add depBumpContext to review-prompt.ts and tests** - `903a892e79` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Import and call dep bump pipeline, pass depBumpContext to buildReviewPrompt
- `src/execution/review-prompt.ts` - DepBumpContext type import, buildDepBumpSection helper, conditional section injection
- `src/execution/review-prompt.test.ts` - 5 new tests for dep bump prompt section rendering

## Decisions Made
- **Detection placement:** Placed after `allChangedFiles` is available (post-diff-collection) rather than after parsePRIntent as plan suggested, because extractDepBumpDetails needs the changed files list for ecosystem resolution via manifest file fallback
- **headBranch parameter:** Added `headBranch: pr.head.ref` to extractDepBumpDetails call, which the plan's code snippet omitted but the function signature requires for Dependabot branch ecosystem detection
- **Test assertion specificity:** Used `not.toContain("MAJOR version bump")` instead of `not.toContain("MAJOR")` for patch bump test, since "MAJOR" appears in severity classification guidelines elsewhere in the prompt

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing headBranch parameter in extractDepBumpDetails call**
- **Found during:** Task 1
- **Issue:** Plan's code snippet for extractDepBumpDetails omitted the required `headBranch` parameter
- **Fix:** Added `headBranch: pr.head.ref` to the call
- **Files modified:** src/handlers/review.ts
- **Committed in:** 6c38579ae0

**2. [Rule 3 - Blocking] Moved dep bump detection after allChangedFiles definition**
- **Found during:** Task 1
- **Issue:** Plan placed detection after parsePRIntent (~line 1267), but allChangedFiles is defined later (~line 1380) after diff collection
- **Fix:** Placed detection block after `const allChangedFiles = diffContext.changedFiles` instead
- **Files modified:** src/handlers/review.ts
- **Committed in:** 6c38579ae0

**3. [Rule 1 - Bug] Fixed over-broad assertion in patch bump test**
- **Found during:** Task 2
- **Issue:** `not.toContain("MAJOR")` failed because "MAJOR" appears in severity classification guidelines
- **Fix:** Changed to `not.toContain("MAJOR version bump")` for specificity
- **Files modified:** src/execution/review-prompt.test.ts
- **Committed in:** 903a892e79

---

**Total deviations:** 3 auto-fixed (2 bug fixes, 1 blocking)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 53 (Dependency Bump Detection) is fully complete
- End-to-end pipeline: PR metadata -> detect -> extract -> classify -> prompt section
- Ready for Phase 54 changelog enrichment to add release notes/CVE data to the dep bump context

## Self-Check: PASSED

- [x] src/handlers/review.ts modified with detectDepBump import and usage
- [x] src/execution/review-prompt.ts modified with depBumpContext parameter and buildDepBumpSection
- [x] src/execution/review-prompt.test.ts modified with 5 new depBumpContext tests
- [x] Commit 6c38579ae0 (Task 1) verified
- [x] Commit 903a892e79 (Task 2) verified
- [x] 821/821 tests passing

---
*Phase: 53-dependency-bump-detection*
*Completed: 2026-02-14*
