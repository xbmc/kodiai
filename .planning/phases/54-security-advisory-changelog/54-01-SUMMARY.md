---
phase: 54-security-advisory-changelog
plan: 01
subsystem: api
tags: [octokit, security-advisories, changelog, npm-registry, pypi, rubygems, tdd]

# Dependency graph
requires:
  - phase: 53-dependency-bump-detection
    provides: "DepBumpContext type, parseSemver, ecosystem detection"
provides:
  - "fetchSecurityAdvisories function for GitHub Advisory API lookup"
  - "fetchChangelog function with three-tier fallback (releases, CHANGELOG.md, compare URL)"
  - "resolveGitHubRepo function for npm/python/ruby package-to-repo resolution"
  - "extractBreakingChanges function for BREAKING CHANGE marker detection"
  - "SecurityContext and ChangelogContext types"
  - "Extended DepBumpContext with optional security and changelog fields"
affects: [54-02, review-prompt, review-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: ["fail-open async enrichment", "ecosystem name mapping", "three-tier changelog fallback", "Promise.allSettled for parallel API calls"]

key-files:
  created:
    - src/lib/dep-bump-enrichment.ts
    - src/lib/dep-bump-enrichment.test.ts
  modified:
    - src/lib/dep-bump-detector.ts

key-decisions:
  - "Breaking change markers ordered most-specific first to prevent duplicate matches from overlapping patterns"
  - "Removed generic BREAKING word marker; kept INCOMPATIBLE, heading, and bold patterns to avoid false positives"
  - "Both advisory API calls failing returns null (fail-open); one failing returns partial data"

patterns-established:
  - "Ecosystem mapping: Phase 53 names -> Advisory API names via ECOSYSTEM_TO_ADVISORY constant"
  - "Registry resolution: npm/python/ruby only in V1; other ecosystems return null"
  - "Character budgets: 500 chars per release body, 1500 chars total changelog"

# Metrics
duration: 4min
completed: 2026-02-15
---

# Phase 54 Plan 01: Dependency Bump Enrichment Module Summary

**Security advisory lookup via GitHub Advisory API, changelog fetching with three-tier fallback (releases/CHANGELOG.md/compare-URL), and package-to-repo resolution for npm/python/ruby ecosystems**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-15T00:32:21Z
- **Completed:** 2026-02-15T00:36:25Z
- **Tasks:** 3 (TDD RED/GREEN + type extension)
- **Files modified:** 3

## Accomplishments
- Created dep-bump-enrichment module with four core functions: fetchSecurityAdvisories, fetchChangelog, resolveGitHubRepo, extractBreakingChanges
- 28 tests covering advisory lookup, repo resolution, changelog fetching tiers, breaking change detection, fail-open behavior, and ecosystem mapping
- Extended DepBumpContext type with optional security and changelog fields (non-breaking change)
- All functions follow fail-open pattern -- return null on any error

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests** - `6e8bd17392` (test)
2. **GREEN: Implementation** - `7f7f303c2f` (feat)
3. **Type extension** - `932f93d777` (feat)

_TDD plan: RED and GREEN phases committed separately._

## Files Created/Modified
- `src/lib/dep-bump-enrichment.ts` - Core enrichment module with advisory lookup, changelog fetching, repo resolution, breaking change detection
- `src/lib/dep-bump-enrichment.test.ts` - 28 unit tests with mocked octokit and fetch responses
- `src/lib/dep-bump-detector.ts` - Extended DepBumpContext type with optional security/changelog fields

## Decisions Made
- Breaking change markers reordered to most-specific-first to prevent duplicate matches (e.g., `## Breaking` was matching both heading and generic word patterns)
- Removed generic `\bBREAKING\b` word pattern; kept `BREAKING CHANGE:`, `## Breaking`, `**Breaking**`, and `INCOMPATIBLE` to reduce false positives
- When both advisory API calls fail (both old and new version queries), return null; when only one fails, return partial data from the successful call

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Breaking change marker ordering caused duplicate matches**
- **Found during:** GREEN phase (test failures)
- **Issue:** Generic `\bBREAKING\b` pattern matched the same text as more specific patterns like `## Breaking` and `**Breaking**`, producing duplicate snippets
- **Fix:** Reordered markers most-specific-first and used break-after-first-match. Removed generic `BREAKING` word pattern; kept `INCOMPATIBLE` separately.
- **Files modified:** src/lib/dep-bump-enrichment.ts
- **Verification:** All 28 tests pass
- **Committed in:** 7f7f303c2f (GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor pattern ordering fix for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Enrichment module ready for wiring into review handler (Plan 54-02)
- SecurityContext and ChangelogContext types exported for use in review-prompt.ts
- DepBumpContext extended -- review.ts can populate security/changelog fields after detection

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 54-security-advisory-changelog*
*Completed: 2026-02-15*
