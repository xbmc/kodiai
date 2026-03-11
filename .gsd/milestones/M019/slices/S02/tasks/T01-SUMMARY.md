---
id: T01
parent: S02
milestone: M019
provides:
  - detectDependsBump() function for Kodi [depends] PR title detection
  - DependsBumpInfo, DependsBumpPackage, DependsBumpContext types
  - Multi-package extraction with platform awareness
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# T01: 94-depends-pr-deep-review 01

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
