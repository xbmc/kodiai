# T01: 94-depends-pr-deep-review 01

**Slice:** S02 — **Milestone:** M019

## Description

Create the `[depends]` PR title detection module with comprehensive test coverage.

Purpose: Enable Kodiai to identify Kodi-convention dependency bump PRs by title pattern, strictly mutually exclusive with the existing Dependabot/Renovate detector. This is the routing gate that determines whether a PR enters the deep-review pipeline.

Output: `src/lib/depends-bump-detector.ts` with exported `detectDependsBump()` function and types, plus test suite.

## Must-Haves

- [ ] "A PR titled '[depends] Bump zlib 1.3.2' is detected as a depends bump"
- [ ] "A PR titled '[Windows] Refresh fstrcmp 0.7' is detected as a depends bump"
- [ ] "A Dependabot PR titled 'Bump lodash from 4.17.20 to 4.17.21' is NOT detected as a depends bump"
- [ ] "Multi-dependency titles like '[depends] Bump openssl to 3.0.19 / python3 to 3.14.3' extract both packages"
- [ ] "Detection returns null for non-matching titles, enabling Dependabot fallback"

## Files

- `src/lib/depends-bump-detector.ts`
- `src/lib/depends-bump-detector.test.ts`
