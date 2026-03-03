---
phase: 16-parse-windows-package-lists-and-harden-p
plan: 01
subsystem: review-pipeline
tags: [depends, windows, version-parsing, enrichment]

requires:
  - phase: depends-bump-enrichment
    provides: VERSION file parsing, changelog fetching, hash verification
provides:
  - parsePackageListDiff function for Windows .list file version extraction
  - .list file fallback in review pipeline when no VERSION file exists
affects: [depends-review, review-handler]

tech-stack:
  added: []
  patterns: [archive-name-parsing, fallback-enrichment]

key-files:
  created: []
  modified:
    - src/lib/depends-bump-enrichment.ts
    - src/lib/depends-bump-enrichment.test.ts
    - src/handlers/review.ts

key-decisions:
  - "Parse archive names by finding first digit-starting segment as version, everything before is package name"
  - "Verified pipeline already posts comment unconditionally (fail-open) -- no changes needed for hardening"

patterns-established:
  - "Fallback enrichment: when primary source (VERSION file) unavailable, try secondary (.list files)"

requirements-completed: [WINLIST-01, HARDEN-01]

duration: 2min
completed: 2026-03-03
---

# Quick Task 16: Parse Windows Package Lists and Harden Pipeline Summary

**parsePackageListDiff extracts versions from Windows .list archive names (e.g., zlib-1.3.2-x64-v143-20260301.7z) with fallback wiring in review pipeline**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T03:30:27Z
- **Completed:** 2026-03-03T03:32:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `parsePackageListDiff` function that parses Windows `0_package.target-*.list` diffs to extract old/new versions from archive filenames
- Handles hyphenated package names (e.g., `libjpeg-turbo`), added-only, and removed-only packages
- Wired .list file fallback into review handler -- when VERSION file yields no versions, pipeline falls back to .list parsing
- Verified pipeline already posts structured comment unconditionally (fail-open) -- no hardening changes needed

## Task Commits

Each task was committed atomically:

1. **Task 1: Add parsePackageListDiff (TDD)** - `da86282faf` (feat)
2. **Task 2: Wire .list fallback into review pipeline** - `04efa1d5d9` (feat)

## Files Created/Modified
- `src/lib/depends-bump-enrichment.ts` - Added PackageListEntry type, parsePackageListDiff function, parseArchiveName helper
- `src/lib/depends-bump-enrichment.test.ts` - 7 new tests for parsePackageListDiff
- `src/handlers/review.ts` - Added parsePackageListDiff import and .list file fallback loop after VERSION file parsing

## Decisions Made
- Archive name parsing strategy: split on `-`, find first segment starting with a digit (version), everything before is the package name. This handles multi-hyphen names like `libjpeg-turbo` correctly.
- Verified the pipeline already posts comments unconditionally within the try block -- no early returns for all-null enrichment data. No code changes needed for the "harden posting" requirement.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Windows [depends] bumps with .list-only diffs will now extract version information
- Pipeline continues to work unchanged for VERSION-file-based enrichment

---
*Phase: 16-parse-windows-package-lists-and-harden-p*
*Completed: 2026-03-03*
