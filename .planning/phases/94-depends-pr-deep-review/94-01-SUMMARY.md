---
phase: 94-depends-pr-deep-review
plan: 01
subsystem: detection
tags: [regex, title-parsing, kodi, depends, mutual-exclusion]

requires:
  - phase: 54-dep-bump-enrichment
    provides: dep-bump-detector.ts types and detection pattern
provides:
  - detectDependsBump() function for Kodi [depends] PR title detection
  - DependsBumpInfo, DependsBumpPackage, DependsBumpContext types
  - Multi-package extraction with platform awareness
affects: [94-02, 94-03, 94-04, pr-routing]

tech-stack:
  added: []
  patterns: [bracket-prefix-detection, multi-package-slash-separator, mutual-exclusion-gate]

key-files:
  created:
    - src/lib/depends-bump-detector.ts
    - src/lib/depends-bump-detector.test.ts
  modified: []

key-decisions:
  - "Bracket prefix regex matches [depends], [Windows], [android], [ios], [osx], [linux] case-insensitively"
  - "Platform extracted from first bracket content; [depends] yields null platform"
  - "Multi-package split on ' / ' separator, each segment parsed independently"
  - "isGroup=true when no package in the title has a version"
  - "Returns null for non-matching titles enabling Dependabot fallback (mutual exclusion)"

patterns-established:
  - "Bracket prefix detection: DEPENDS_TITLE_RE and TARGET_DEPENDS_PREFIX_RE as sequential gates"
  - "Package segment parsing: name-to-version, name-space-version, name-only (group) patterns"

requirements-completed: [DEPS-01, DEPS-02]

duration: 2min
completed: 2026-02-25
---

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
