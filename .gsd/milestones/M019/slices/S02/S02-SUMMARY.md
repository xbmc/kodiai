---
id: S02
parent: M019
milestone: M019
provides:
  - detectDependsBump() function for Kodi [depends] PR title detection
  - DependsBumpInfo, DependsBumpPackage, DependsBumpContext types
  - Multi-package extraction with platform awareness
  - "computeDependsVerdict() heuristic-based safe/needs-attention/risky verdict"
  - "buildDependsReviewComment() structured markdown with TL;DR, version diff, changelog, impact, hash sections"
  - "buildDependsInlineComments() for hash mismatch, patch removal, and new transitive dep findings"
  - "End-to-end [depends] deep-review pipeline wired into review handler"
  - parseVersionFileDiff() for VERSION file diff extraction
  - parseVersionFileContent() with $(VAR) expansion
  - resolveUpstreamRepo() with KODI_LIB_REPO_MAP (~30 C/C++ libraries)
  - fetchDependsChangelog() with GitHub Releases + diff-analysis fallback
  - verifyHash() with SHA512 comparison against upstream tarballs
  - detectPatchChanges() for .patch/.diff file tracking
  - "findDependencyConsumers() for #include and cmake target_link_libraries tracing"
  - "parseCmakeFindModule() for cmake Find module dependency extraction"
  - "checkTransitiveDependencies() for transitive dep detection and circular dep flagging"
requires: []
affects: []
key_files: []
key_decisions:
  - "Bracket prefix regex matches [depends], [Windows], [android], [ios], [osx], [linux] case-insensitively"
  - "Platform extracted from first bracket content; [depends] yields null platform"
  - "Multi-package split on ' / ' separator, each segment parsed independently"
  - "isGroup=true when no package in the title has a version"
  - "Returns null for non-matching titles enabling Dependabot fallback (mutual exclusion)"
  - "Verdict heuristic: risky on hash mismatch/patch removal/breaking+many-consumers; needs-attention on breaking/transitive/many-consumers/hash-unavailable; safe otherwise"
  - "Full pipeline wrapped in try/catch with fail-open: on failure, dependsBumpInfo reset to null so Dependabot detection can still run"
  - "PR files fetched via pulls.listFiles API to get status and patch data for patch detection and inline comments"
  - "Standard Claude review only runs when PR touches source code beyond build config paths (tools/depends/, cmake/modules/, etc)"
  - "Retrieval context fetched via existing retriever dependency injection, formatted as bullet list of top 3 results"
  - "Reuse extractBreakingChanges() from dep-bump-enrichment.ts rather than duplicating breaking change detection"
  - "Case-insensitive repo map lookup via pre-built lowercase index for O(1) resolution"
  - "Three-tier changelog fallback: github-releases -> diff-analysis (synthesized from VERSION file diff) -> unavailable"
  - "Patch detection not restricted to tools/depends/ paths -- any .patch/.diff file in the PR is flagged"
  - "Dual grep pass: first for #include directives, second for cmake target_link_libraries, with filePath dedup"
  - "parseCmakeFindModule uses line-start anchoring to skip commented-out find_dependency lines"
  - "Transitive check fetches cmake/modules/ from GitHub via Octokit getContent, fail-open on missing directory"
patterns_established:
  - "Bracket prefix detection: DEPENDS_TITLE_RE and TARGET_DEPENDS_PREFIX_RE as sequential gates"
  - "Package segment parsing: name-to-version, name-space-version, name-only (group) patterns"
  - "Mutual exclusion guard: detectDependsBump before detectDepBump, wrapped in if (!dependsBumpInfo)"
  - "Pipeline fail-open: entire [depends] block in try/catch, resets to null on failure for graceful fallback"
  - "Inline comment generation: findPatchLineNumber() parses unified diff to locate new-file line numbers for GitHub review API"
  - "VERSION file diff parsing: extract old/new values from unified diff -/+ lines"
  - "Variable expansion: single-pass $(VAR) resolution for Makefile-style VERSION files"
  - "Diff-analysis fallback: synthesize changelog highlights from parsed diff data when upstream is unavailable"
  - "Test-hook injection: __runGrepForTests and __runCmakeGrepForTests for deterministic test control"
  - "withTimeBudget from usage-analyzer reused for timeout handling"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# S02: Depends Pr Deep Review

**# Phase 94 Plan 01: [depends] Title Detection Summary**

## What Happened

# Phase 94 Plan 01: [depends] Title Detection Summary

**detectDependsBump() with regex-based title parsing for Kodi bracket-prefix dependency bumps, multi-package extraction, and platform awareness**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-25T18:47:11Z
- **Completed:** 2026-02-25T18:48:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Regex-based detection for 6 bracket prefixes ([depends], [Windows], [android], [ios], [osx], [linux]) and 2 path prefixes (target/depends:, tools/depends:)
- Multi-package extraction via "/" separator with v-prefix stripping and commit hash version support
- 30 tests covering 17 positive matches, 6 negative matches, and 7 extraction validations
- Mutual exclusion: returns null for Dependabot/Renovate titles (no bracket prefix = no match)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for [depends] title detection** - `e5e71d6e04` (test)
2. **Task 2: Implement detectDependsBump() to pass all tests** - `76f7c12502` (feat)

## Files Created/Modified
- `src/lib/depends-bump-detector.ts` - Detection module with detectDependsBump(), types, and extraction logic
- `src/lib/depends-bump-detector.test.ts` - 30 test cases covering positive/negative matches and extraction

## Decisions Made
- Bracket prefix regex covers [depends], [Windows], [android], [ios], [osx], [linux] case-insensitively with optional nested brackets
- Platform extracted from first bracket content only; "depends" is not a platform (yields null)
- Multi-package titles split on " / " separator; each segment parsed independently for name and version
- isGroup is true when ALL packages lack a version (e.g., "Bump font libraries")
- Function returns null (not false/empty) for non-matching titles, enabling clean mutual exclusion with detectDepBump()

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- detectDependsBump() ready for wiring into PR routing logic (94-02)
- DependsBumpContext type ready for enrichment pipeline (94-03, 94-04)
- Types exported for integration with review generation

---
*Phase: 94-depends-pr-deep-review*
*Completed: 2026-02-25*

# Phase 94 Plan 04: [depends] Deep Review Pipeline Integration Summary

**Structured review comment builder with TL;DR verdict and end-to-end pipeline wiring into review handler for Kodi [depends] dependency bump PRs**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T18:56:14Z
- **Completed:** 2026-02-25T19:01:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Built `depends-review-builder.ts` with verdict computation, structured comment builder, and inline comment generation
- Wired complete [depends] deep-review pipeline into `review.ts` handler: detection, enrichment, impact analysis, retrieval, comment posting
- Enforced mutual exclusivity: detectDependsBump() runs before detectDepBump(), skipping Dependabot path when matched
- Standard Claude review conditionally runs only when PR touches source code beyond build configs
- All 96 tests pass (24 new + 72 existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build structured review comment builder with tests** - `169c76abff` (feat)
2. **Task 2: Wire [depends] deep-review pipeline into review handler** - `36daa12473` (feat)

## Files Created/Modified
- `src/lib/depends-review-builder.ts` - Comment builder with verdict computation, structured markdown output, inline comments
- `src/lib/depends-review-builder.test.ts` - 24 tests covering verdict, comment, multi-package, degradation, inline scenarios
- `src/handlers/review.ts` - Pipeline integration with detection, enrichment, impact, retrieval, posting, mutual exclusion

## Decisions Made
- Verdict heuristic prioritizes risky > needs-attention > safe with clear triggers for each level
- Full pipeline fail-open: on unexpected error, resets dependsBumpInfo to null so Dependabot path can still run
- PR files fetched via GitHub API (pulls.listFiles) to get file status and patch content needed for detectPatchChanges and inline comments
- Retrieval context formatted as simple bullet list of top 3 unified results
- Build config paths for source-change detection: tools/depends/, cmake/modules/, project/BuildDependencies/, project/cmake/

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed detectDependsBump() call signature**
- **Found during:** Task 2
- **Issue:** Plan pseudo-code used `detectDependsBump({ prTitle: pr.title })` but actual function takes plain string
- **Fix:** Called as `detectDependsBump(pr.title)` matching actual API
- **Files modified:** src/handlers/review.ts
- **Verification:** Handler compiles without errors

**2. [Rule 3 - Blocking] Added PR files fetch via GitHub API**
- **Found during:** Task 2
- **Issue:** Handler only had `allChangedFiles` (filename strings), but pipeline needs status and patch data
- **Fix:** Added `pulls.listFiles` API call to fetch PR files with status/patch before enrichment
- **Files modified:** src/handlers/review.ts
- **Verification:** Handler compiles and tests pass

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both adaptations necessary to match actual code interfaces. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 94 complete: all 4 plans executed (detection, enrichment, impact analysis, pipeline integration)
- [depends] deep-review pipeline is end-to-end functional
- Ready for production testing with actual Kodi [depends] PRs

---
*Phase: 94-depends-pr-deep-review*
*Completed: 2026-02-25*

# Phase 94 Plan 02: Depends Bump Enrichment Summary

**VERSION file parsing, upstream changelog fetching with diff-analysis fallback, SHA512 hash verification, and patch detection for Kodi [depends] PRs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-25T18:47:18Z
- **Completed:** 2026-02-25T18:50:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- VERSION file diff parsing extracts old/new version, SHA512, archive, and base URL from unified diffs
- Upstream changelog fetching via GitHub Releases API with three-tier fallback (releases -> diff-analysis -> unavailable)
- SHA512 hash verification against upstream tarballs using node:crypto
- Patch file change detection for .patch/.diff additions/removals in PR files
- 30 tests covering all enrichment functions, all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for enrichment functions** - `76f7c12502` (test)
2. **Task 2: Implement enrichment functions to pass all tests** - `39a418ec25` (feat)

## Files Created/Modified
- `src/lib/depends-bump-enrichment.ts` - Enrichment module: VERSION parsing, changelog fetching, hash verification, patch detection
- `src/lib/depends-bump-enrichment.test.ts` - 30 test cases covering all enrichment functions

## Decisions Made
- Reused `extractBreakingChanges()` from existing `dep-bump-enrichment.ts` to avoid duplication
- Built case-insensitive lookup index at module load for O(1) repo resolution
- Three-tier fallback for changelog: GitHub releases -> diff-analysis (synthesized from VERSION diff) -> unavailable
- Patch detection applies to all .patch/.diff files in PR, not restricted to tools/depends/ paths

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Enrichment functions ready for consumption by 94-03 (review builder) and 94-04 (handler wiring)
- KODI_LIB_REPO_MAP provides ~30 library mappings; unknown libraries degrade gracefully
- All functions are fail-open and safe for production use

---
*Phase: 94-depends-pr-deep-review*
*Completed: 2026-02-25*

# Phase 94 Plan 03: Impact Analysis Summary

**#include tracing, cmake target_link_libraries discovery, and transitive dependency detection for [depends] bumps with fail-open timeout handling**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-25T18:52:04Z
- **Completed:** 2026-02-25T18:54:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- findDependencyConsumers traces both #include directives and cmake target_link_libraries with deduplication
- parseCmakeFindModule extracts find_dependency and find_package calls from cmake modules
- checkTransitiveDependencies identifies dependents, new transitive deps, and circular dependency pairs
- All functions respect time budgets and never throw (fail-open with degradation notes)
- 19 tests passing covering all three exported functions

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests** - `3b043b69f9` (test)
2. **Task 2: Implement impact analysis** - `ad70598214` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `src/lib/depends-impact-analyzer.ts` - Impact analysis module with 3 exported functions + 4 exported types
- `src/lib/depends-impact-analyzer.test.ts` - 19 test cases covering include tracing, cmake parsing, transitive deps

## Decisions Made
- Dual grep pass (include + cmake) with filePath-based deduplication rather than single combined regex
- Line-start regex anchoring (`^\s*find_dependency`) to naturally skip commented-out cmake lines
- Reused `withTimeBudget` from usage-analyzer.ts rather than duplicating timeout logic
- Test hooks (`__runGrepForTests`, `__runCmakeGrepForTests`) for deterministic testing without real git repos

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Impact analysis module ready for consumption by 94-04 (deep review comment formatter)
- All three functions exported and typed for direct import
- Fail-open pattern consistent with existing codebase conventions

---
*Phase: 94-depends-pr-deep-review*
*Completed: 2026-02-25*
